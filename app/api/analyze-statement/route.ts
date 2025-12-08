import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { saveJobAnalytics, calculateCost, type JobAnalytics } from "@/lib/supabase"
import { generateDashboardHtml, type AuditDashboardData } from "@/lib/dashboard-template"

const AUDIT_PROMPT = `You are an experienced external auditor performing a COMPREHENSIVE and DETAILED casting and cross-checking of financial statements. Be thorough and check EVERY number.

You are viewing the PDF document directly. Carefully examine all tables, numbers, and formatting as they appear in the original document.

IMPORTANT: Verify ALL arithmetic carefully. Double-check every calculation before recording it. Identify even small rounding errors of RM 1 or less.

ALWAYS verify by checking:
1. The note details for each line item
2. The subtotals (individual items must add up to stated subtotal)
3. Prior year amounts for reasonableness

Perform these checks IN DETAIL:

1. VERTICAL CASTING (Be Exhaustive)
   - Recompute EVERY subtotal and total line by line
   - Add up all amounts independently for each section
   - Check: Statement of Financial Position (Assets, Liabilities, Equity sections)
   - Check: Statement of Comprehensive Income (Revenue, Expenses, Profit lines)
   - Check: Statement of Changes in Equity (all columns and rows)
   - Check: Statement of Cash Flows (Operating, Investing, Financing sections)
   - Check: EVERY note that has numerical subtotals or totals
   - Identify ANY differences, including small rounding errors
   - Clearly display all recalculations with component breakdown

2. HORIZONTAL CASTING (Movement Analysis)
   - Compare current year and prior year numbers for all major line items
   - Highlight unusual or inconsistent movements
   - Confirm that year-on-year movements agree to the supporting notes
   - Check note reconciliations: PPE movements, receivables aging, payables aging, borrowings, equity movements
   - Flag any variances that do not reconcile
   - Verify opening balances equal prior year closing balances

3. CROSS REFERENCING TO NOTES (Tie Every Number)
   - Check that EVERY number in the notes agrees EXACTLY to the primary financial statements
   - Tie each note item to its corresponding line in the statements
   - Identify any mismatch, reclassification, rounding difference, or missing linkage
   - Cross-check note totals back to face of financial statements
   - Verify disclosure completeness

4. INTERNAL CONSISTENCY CHECKS
   - Confirm that the Balance Sheet balances (Total Assets = Total Liabilities + Equity)
   - Confirm that opening balances in ALL notes match the prior year closing balances
   - Check that reconciliations for PPE, receivables, payables, equity, and borrowings are mathematically correct
   - Ensure subtotals used in ratios or analysis agree to underlying line items
   - Verify cash flow statement reconciles to cash movement in balance sheet

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
  "crossReferenceChecks": [
    {
      "noteRef": "Note 8",
      "noteDescription": "Other Receivables",
      "lineItem": "Other receivables (SOFP)",
      "perNote": "RM X,XXX,XXX",
      "perStatement": "RM X,XXX,XXX",
      "variance": "RM 0 or RM X",
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

Rules for COMPREHENSIVE checking:
- Include ALL vertical casting checks performed (MINIMUM 30-50 checks for typical statements)
- Check EVERY section: SOFP current assets, non-current assets, current liabilities, non-current liabilities, equity
- Check EVERY section: SOCI revenue, cost of sales, operating expenses, finance costs, tax
- Check ALL notes with numerical data: PPE, intangibles, investments, receivables, payables, borrowings, equity, revenue breakdown, expense breakdown
- Include ALL horizontal casting checks (movement reconciliations for ALL major accounts with movements)
- Include ALL cross-reference checks (MINIMUM 15-25 note-to-statement ties):
  * Every note total MUST be checked against its corresponding SOFP/SOCI line item
  * Check: PPE note total vs SOFP PPE, Inventories note vs SOFP Inventories, Trade receivables note vs SOFP, Other receivables note vs SOFP, Trade payables note vs SOFP, Other payables note vs SOFP, Borrowings note vs SOFP, Revenue note vs SOCI, etc.
  * Flag ANY difference, even RM 1 difference, as this indicates a potential error
- Flag even small rounding differences of RM 1 as low severity exceptions - these MUST be reported
- Only include actual discrepancies in exceptions array
- If no exceptions, return empty array: "exceptions": []
- Use actual numbers from the document, formatted with RM and commas
- varianceAmount should be the numeric value (positive number)
- Pass rate is percentage rounded to nearest integer
- Format all monetary values consistently as "RM X,XXX,XXX"
- BE THOROUGH - it is better to check too much than too little

CRITICAL DATA CONSISTENCY RULES:
- The conclusionItems MUST match the exceptions array - every item in conclusionItems must have a corresponding entry in exceptions with the SAME variance amount
- If you report a variance in conclusionItems (e.g., "difference of RM 20,000"), the corresponding entry in verticalCasting, horizontalCasting, crossReferenceChecks, or exceptions MUST show that SAME variance amount (RM 20,000), NOT RM 0
- status="fail" means there IS a variance - the variance field MUST show the actual difference, never RM 0
- status="pass" means variance is zero - the variance field should be "RM 0"
- NEVER mark an item as "fail" with variance "RM 0" - this is contradictory
- NEVER mark an item as "pass" with a non-zero variance - this is contradictory
- Double-check that ALL numbers in the detailed findings match what you describe in the conclusion`

// Parse JSON from Gemini's response (handles potential markdown wrapping)
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

    const apiKey = process.env.GOOGLE_API_KEY

    if (!apiKey) {
      log("ERROR: Missing API key")
      return NextResponse.json(
        {
          error:
            "GOOGLE_API_KEY environment variable is not configured. Please add it in the Vercel project settings.",
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

    const genAI = new GoogleGenerativeAI(apiKey)

    // Safety settings to prevent content blocking
    const safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ]

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        maxOutputTokens: 65536, // Increased to accommodate thinking tokens + output
        temperature: 0.1,
      },
      safetySettings,
    })

    log("=== GEMINI API REQUEST (Direct PDF Vision) ===")
    log("Model", "gemini-2.5-flash")
    log("Max tokens", 65536)
    log("PDF Size", `${pdfSizeKB} KB`)

    const apiStartTime = Date.now()

    // Helper function to call API with retry on rate limit
    const callWithRetry = async (retryCount = 0): Promise<{ text: string; inputTokens: number; outputTokens: number }> => {
      try {
        const prompt = `${AUDIT_PROMPT}\n\nAnalyze the financial statement document above and perform a comprehensive casting check. Return ONLY the JSON structure specified above.`

        // Send PDF directly to Gemini Vision
        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: "application/pdf",
              data: cleanBase64,
            },
          },
          { text: prompt },
        ])
        const response = result.response

        // Log response details for debugging
        const candidates = response.candidates
        log("Response candidates count", candidates?.length || 0)

        if (candidates && candidates.length > 0) {
          const candidate = candidates[0]
          log("Candidate finish reason", candidate.finishReason)
          log("Candidate safety ratings", candidate.safetyRatings)

          // Check if blocked
          if (candidate.finishReason === "SAFETY") {
            log("ERROR: Response blocked by safety filters")
            throw new Error("Response blocked by safety filters. The content may have triggered safety restrictions.")
          }

          if (candidate.finishReason === "RECITATION") {
            log("ERROR: Response blocked due to recitation")
            throw new Error("Response blocked due to recitation policy.")
          }
        }

        // Get text - handle potential empty response
        let text = ""
        try {
          text = response.text()
        } catch (textError) {
          log("ERROR: Failed to get response text", textError)
          // Try to get text from candidates directly
          if (candidates && candidates[0]?.content?.parts) {
            text = candidates[0].content.parts
              .filter((part: { text?: string }) => part.text)
              .map((part: { text?: string }) => part.text)
              .join("")
          }
        }

        log("Response text length", text.length)
        if (text.length === 0) {
          log("WARNING: Empty response from Gemini")
          log("Full response object", JSON.stringify(response, null, 2))
        }

        // Get token counts from usage metadata
        const usageMetadata = response.usageMetadata
        const inputTokens = usageMetadata?.promptTokenCount || 0
        const outputTokens = usageMetadata?.candidatesTokenCount || 0

        return { text, inputTokens, outputTokens }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if ((errorMessage.includes("429") || errorMessage.includes("rate") || errorMessage.includes("quota")) && retryCount < 3) {
          const waitTime = Math.pow(2, retryCount) * 30000 // 30s, 60s, 120s
          log(`Rate limit hit, waiting ${waitTime / 1000}s before retry ${retryCount + 1}/3`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
          return callWithRetry(retryCount + 1)
        }
        throw error
      }
    }

    log("=== CALLING GEMINI API (Direct PDF Vision) ===")
    const { text: finalAnalysis, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } = await callWithRetry()

    const apiDuration = Date.now() - apiStartTime

    log("=== GEMINI API RESPONSE SUMMARY ===")
    log("API call duration", { durationMs: apiDuration, durationSec: (apiDuration / 1000).toFixed(2) })
    log("Token usage", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    })
    log("Stop reason", "completed")

    // Calculate costs
    const modelUsed = "gemini-2.5-flash"
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
      pdf_pages: undefined, // Page count not available with direct PDF vision
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
      stop_reason: "completed",
      analysis_length_chars: finalAnalysis.length,
      analysis_length_words: finalAnalysis.split(/\s+/).length,
      discrepancies_found: discrepanciesFound,
      status: "success",
    }

    const saveResult = await saveJobAnalytics(jobAnalytics)
    log("Supabase save result", saveResult)
    log("HTML dashboard length", { htmlLength: htmlDashboard.length })
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
          stopReason: "completed",
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
        stopReason: "completed",
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
        model: "gemini-2.5-flash",
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
