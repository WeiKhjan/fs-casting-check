import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { saveJobAnalytics, calculateCost, type JobAnalytics } from "@/lib/supabase"
import { generateDashboardHtml, type AuditDashboardData } from "@/lib/dashboard-template"
import pdf from "pdf-parse"

// Extract text from PDF to reduce token usage (90k -> ~15-25k tokens)
async function extractPdfText(base64Data: string): Promise<{ text: string; pages: number }> {
  try {
    const buffer = Buffer.from(base64Data, "base64")
    const data = await pdf(buffer)
    return {
      text: data.text,
      pages: data.numpages,
    }
  } catch (error) {
    console.error("PDF text extraction failed:", error)
    throw new Error("Failed to extract text from PDF. Please ensure the PDF is not encrypted or corrupted.")
  }
}

const AUDIT_PROMPT = `You are an experienced external auditor. Your task is to perform complete casting and cross checking of financial statements with full accuracy.

IMPORTANT: Verify ALL arithmetic carefully. Double-check every calculation before recording it. Show your work mentally and ensure sums match stated totals.

Perform these checks:
1. Vertical casting - Recompute every subtotal and total line by line
2. Horizontal casting - Compare current year and prior year, compute variances
3. Cross referencing - Check every number in notes agrees to primary statements
4. Internal consistency - Confirm Balance Sheet balances, opening balances match prior year closing

CRITICAL: Your final response MUST be valid JSON only. No markdown, no explanation text outside the JSON.

Output this exact JSON structure:
{
  "companyName": "COMPANY NAME FROM DOCUMENT",
  "financialYearEnd": "DD Month YYYY",
  "kpi": {
    "testsPassed": number,
    "testsFailed": number,
    "totalTests": number,
    "exceptionsFound": number,
    "highSeverity": number,
    "mediumSeverity": number,
    "lowSeverity": number,
    "passRate": number,
    "horizontalChecks": "X/Y"
  },
  "conclusionSummary": "The financial statements cast correctly subject to X exceptions" or "The financial statements cast correctly with no exceptions",
  "conclusionItems": [
    {
      "priority": "high" | "medium" | "low",
      "note": "Note X or Location",
      "description": "What needs to be corrected"
    }
  ],
  "conclusionNote": "Balance Sheet balances. Summary statement about overall accuracy.",
  "verticalCasting": [
    {
      "section": "SOFP 2024 or SOCI 2024 or Note X",
      "description": "What is being checked",
      "components": [
        {"name": "Line item name", "value": "RM X,XXX,XXX"}
      ],
      "calculated": "RM X,XXX,XXX",
      "stated": "RM X,XXX,XXX",
      "variance": "RM 0 or RM X,XXX",
      "varianceAmount": 0,
      "status": "pass" | "fail"
    }
  ],
  "horizontalCasting": [
    {
      "account": "Account or Balance name",
      "opening": "RM X,XXX,XXX",
      "additions": [
        {"description": "+ Description", "value": "RM X,XXX,XXX"}
      ],
      "deductions": [
        {"description": "- Description", "value": "RM X,XXX,XXX"}
      ],
      "calculatedClosing": "RM X,XXX,XXX",
      "statedClosing": "RM X,XXX,XXX",
      "variance": "RM 0 or RM X,XXX",
      "varianceAmount": 0,
      "status": "pass" | "fail"
    }
  ],
  "exceptions": [
    {
      "id": 1,
      "type": "Casting Error | Note vs Statement Mismatch | Conceptual Error | Presentation Error | Missing Disclosure | Requires Further Inquiry",
      "location": "Note X or Statement location",
      "description": "What is wrong",
      "perStatement": "RM X,XXX,XXX or N/A",
      "perCalculation": "RM X,XXX,XXX or N/A",
      "difference": "RM X,XXX or N/A",
      "severity": "high" | "medium" | "low",
      "recommendation": "What should be done to fix it"
    }
  ]
}

Rules:
- Include ALL vertical casting checks performed (minimum 15-25 checks for typical statements)
- Include ALL horizontal casting checks (movement reconciliations for major accounts)
- Only include actual discrepancies in exceptions array
- If no exceptions, return empty array: "exceptions": []
- Use actual numbers from the document, formatted with RM and commas
- varianceAmount should be the numeric value (positive number)
- Pass rate is percentage rounded to nearest integer
- Format all monetary values consistently as "RM X,XXX,XXX"`

// Parse JSON from Claude's response (handles potential markdown wrapping)
function parseAuditJson(text: string): AuditDashboardData | null {
  // Try to extract JSON from the response
  let jsonStr = text.trim()

  // Remove markdown code blocks if present
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7)
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3)
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3)
  }
  jsonStr = jsonStr.trim()

  // Try to find JSON object in the text
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    jsonStr = jsonMatch[0]
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Add report date
    const now = new Date()
    const reportDate = now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    return {
      ...parsed,
      reportDate,
    } as AuditDashboardData
  } catch (e) {
    console.error("Failed to parse audit JSON:", e)
    return null
  }
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()
  const logs: string[] = []
  let fileName = "unknown"
  let cleanBase64 = ""

  const log = (message: string, data?: unknown) => {
    const timestamp = new Date().toISOString()
    const elapsed = Date.now() - startTime
    const logEntry = `[${timestamp}] [${requestId}] [+${elapsed}ms] ${message}`
    console.log(logEntry, data !== undefined ? JSON.stringify(data, null, 2) : "")
    logs.push(data !== undefined ? `${logEntry} ${JSON.stringify(data)}` : logEntry)
  }

  try {
    const body = await request.json()
    const { pdfBase64, outputFormat = "html" } = body
    fileName = body.fileName || "unknown"

    log("=== REQUEST STARTED ===")
    log("File received", { fileName, base64Length: pdfBase64?.length || 0, outputFormat })

    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      log("ERROR: Missing API key")
      return NextResponse.json(
        {
          error:
            "ANTHROPIC_API_KEY environment variable is not configured. Please add it in the Vercel project settings.",
          logs,
        },
        { status: 500 },
      )
    }

    if (!pdfBase64) {
      log("ERROR: No PDF provided")
      return NextResponse.json({ error: "PDF file is required", logs }, { status: 400 })
    }

    if (typeof pdfBase64 === "string") {
      if (pdfBase64.includes(",")) {
        cleanBase64 = pdfBase64.split(",")[1]
      } else {
        cleanBase64 = pdfBase64
      }
      cleanBase64 = cleanBase64.replace(/\s/g, "")
    } else {
      log("ERROR: Invalid PDF format")
      return NextResponse.json({ error: "Invalid PDF data format", logs }, { status: 400 })
    }

    const pdfSizeKB = Math.round((cleanBase64.length * 3) / 4 / 1024)
    log("PDF processed", { base64Length: cleanBase64.length, estimatedSizeKB: pdfSizeKB })

    // Extract text from PDF to reduce token usage (90k -> ~15-25k tokens)
    log("=== EXTRACTING PDF TEXT ===")
    const { text: pdfText, pages: pdfPages } = await extractPdfText(cleanBase64)
    const textLength = pdfText.length
    const estimatedTokens = Math.round(textLength / 4) // Rough estimate: 4 chars per token
    log("PDF text extracted", {
      pages: pdfPages,
      textLength,
      estimatedTokens,
      tokenReduction: `~${Math.round((1 - estimatedTokens / 90000) * 100)}% reduction from raw PDF`,
    })

    const anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    })

    log("=== CLAUDE API REQUEST ===")
    log("Model", "claude-sonnet-4-20250514")
    log("Max tokens", 16000)
    log("System prompt length", AUDIT_PROMPT.length)

    const apiStartTime = Date.now()

    // Helper function to call API with retry on rate limit
    const callWithRetry = async (retryCount = 0): Promise<Anthropic.Message> => {
      try {
        return await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          messages: [
            {
              role: "user",
              content: `${AUDIT_PROMPT}\n\n=== FINANCIAL STATEMENT DOCUMENT: ${fileName} (${pdfPages} pages) ===\n\n${pdfText}\n\n=== END OF DOCUMENT ===\n\nAnalyze the financial statement above and perform a comprehensive casting check. Return ONLY the JSON structure specified above.`,
            },
          ],
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes("rate_limit") && retryCount < 3) {
          const waitTime = Math.pow(2, retryCount) * 30000 // 30s, 60s, 120s
          log(`Rate limit hit, waiting ${waitTime / 1000}s before retry ${retryCount + 1}/3`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
          return callWithRetry(retryCount + 1)
        }
        throw error
      }
    }

    log("=== CALLING CLAUDE API (single request) ===")
    const message = await callWithRetry()

    const apiDuration = Date.now() - apiStartTime
    const totalInputTokens = message.usage.input_tokens
    const totalOutputTokens = message.usage.output_tokens

    // Extract text response
    const textBlocks = message.content.filter((block) => block.type === "text")
    const finalAnalysis = textBlocks
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n\n")

    log("=== CLAUDE API RESPONSE SUMMARY ===")
    log("API call duration", { durationMs: apiDuration, durationSec: (apiDuration / 1000).toFixed(2) })
    log("Token usage", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    })
    log("Stop reason", message.stop_reason)

    // Calculate costs
    const modelUsed = message.model || "claude-sonnet-4-20250514"
    const costs = calculateCost(modelUsed, totalInputTokens, totalOutputTokens)
    log("Cost calculation", costs)

    // Calculate file size
    const fileSizeBytes = Math.round((cleanBase64.length * 3) / 4)
    const fileSizeMB = Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100

    // Parse the JSON response and generate HTML dashboard
    const auditData = parseAuditJson(finalAnalysis)
    let htmlDashboard = ""
    let discrepanciesFound = 0

    if (auditData) {
      htmlDashboard = generateDashboardHtml(auditData)
      discrepanciesFound = auditData.kpi.exceptionsFound
      log("Dashboard generated successfully", {
        testsPassed: auditData.kpi.testsPassed,
        testsFailed: auditData.kpi.testsFailed,
        exceptionsFound: auditData.kpi.exceptionsFound,
      })
    } else {
      log("WARNING: Could not parse audit JSON, returning raw analysis")
      // Count discrepancies from raw text as fallback
      const criticalCount = (finalAnalysis.match(/\[CRITICAL\]/gi) || []).length
      const moderateCount = (finalAnalysis.match(/\[MODERATE\]/gi) || []).length
      const minorCount = (finalAnalysis.match(/\[MINOR\]/gi) || []).length
      discrepanciesFound = criticalCount + moderateCount + minorCount
    }

    // Save job analytics to Supabase
    const jobAnalytics: JobAnalytics = {
      request_id: requestId,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      file_size_mb: fileSizeMB,
      pdf_pages: pdfPages,
      model: modelUsed,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      input_cost_usd: costs.inputCost,
      output_cost_usd: costs.outputCost,
      total_cost_usd: costs.totalCost,
      tools_configured: false,
      tools_called: 0,
      tool_usage_summary: {},
      iterations: 1,
      api_duration_ms: apiDuration,
      total_duration_ms: Date.now() - startTime,
      stop_reason: message.stop_reason || "unknown",
      analysis_length_chars: finalAnalysis.length,
      analysis_length_words: finalAnalysis.split(/\s+/).length,
      discrepancies_found: discrepanciesFound,
      status: "success",
    }

    const saveResult = await saveJobAnalytics(jobAnalytics)
    log("Supabase save result", saveResult)
    log("=== REQUEST COMPLETED ===")

    // Return response based on output format
    if (outputFormat === "json") {
      return NextResponse.json({
        data: auditData,
        rawAnalysis: finalAnalysis,
        model: modelUsed,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        costs: {
          input_cost_usd: costs.inputCost,
          output_cost_usd: costs.outputCost,
          total_cost_usd: costs.totalCost,
        },
        debug: {
          requestId,
          totalDurationMs: Date.now() - startTime,
          apiDurationMs: apiDuration,
          fileSizeBytes,
          fileSizeMB,
          stopReason: message.stop_reason,
          analyticsSaved: saveResult.success,
        },
      })
    }

    // Default: return HTML dashboard
    return NextResponse.json({
      html: htmlDashboard || `<html><body><h1>Analysis Complete</h1><pre>${finalAnalysis}</pre></body></html>`,
      data: auditData,
      model: modelUsed,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      costs: {
        input_cost_usd: costs.inputCost,
        output_cost_usd: costs.outputCost,
        total_cost_usd: costs.totalCost,
      },
      debug: {
        requestId,
        totalDurationMs: Date.now() - startTime,
        apiDurationMs: apiDuration,
        fileSizeBytes,
        fileSizeMB,
        stopReason: message.stop_reason,
        discrepanciesFound,
        analyticsSaved: saveResult.success,
      },
    })
  } catch (error) {
    log("=== ERROR ===")
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("Error occurred", {
      name: error instanceof Error ? error.name : "Unknown",
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Try to save error job to Supabase
    try {
      const fileSizeBytes = cleanBase64 ? Math.round((cleanBase64.length * 3) / 4) : 0
      const fileSizeMB = Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100
      const errorJobAnalytics: JobAnalytics = {
        request_id: requestId,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        file_size_mb: fileSizeMB,
        model: "claude-sonnet-4-20250514",
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_cost_usd: 0,
        output_cost_usd: 0,
        total_cost_usd: 0,
        tools_configured: false,
        tools_called: 0,
        tool_usage_summary: {},
        iterations: 0,
        api_duration_ms: 0,
        total_duration_ms: Date.now() - startTime,
        stop_reason: "error",
        analysis_length_chars: 0,
        analysis_length_words: 0,
        status: "error",
        error_message: errorMessage,
      }
      await saveJobAnalytics(errorJobAnalytics)
    } catch (saveError) {
      log("Failed to save error analytics", saveError)
    }

    if (error instanceof Error) {
      return NextResponse.json({
        error: error.message,
        debug: { requestId, logs, durationMs: Date.now() - startTime }
      }, { status: 500 })
    }

    return NextResponse.json({
      error: "Failed to analyze financial statement",
      debug: { requestId, logs, durationMs: Date.now() - startTime }
    }, { status: 500 })
  }
}
