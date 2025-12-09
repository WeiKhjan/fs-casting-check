import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { saveJobAnalytics, calculateCost, type JobAnalytics } from "@/lib/supabase"
import { generateDashboardHtml, type AuditDashboardData } from "@/lib/dashboard-template"
import { ExtractionResult } from "@/lib/extraction-types"
import { runVerification, toAuditDashboardData } from "@/lib/verification-engine"
import EXTRACTION_PROMPT from "@/lib/extraction-prompt"

// ============================================================================
// NEW ARCHITECTURE: Phase 1 (LLM Extract) → Phase 2 (Code Verify)
// ============================================================================
// - LLM only extracts data from PDF (what it's good at)
// - Code performs ALL arithmetic verification (100% accurate)
// - No more inconsistent LLM arithmetic errors
// ============================================================================

// Parse JSON from Gemini's response (handles potential markdown wrapping and truncation)
function parseExtractionJson(text: string, wasTruncated: boolean = false): ExtractionResult | null {
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

  // If truncated, try to repair the JSON
  if (wasTruncated) {
    jsonStr = repairTruncatedJson(jsonStr)
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Add extractedAt if not present
    if (!parsed.extractedAt) {
      parsed.extractedAt = new Date().toISOString()
    }

    // Ensure arrays exist
    parsed.statements = parsed.statements || []
    parsed.movements = parsed.movements || []
    parsed.crossReferences = parsed.crossReferences || []
    parsed.castingRelationships = parsed.castingRelationships || []
    parsed.warnings = parsed.warnings || []

    // If truncated, add a warning
    if (wasTruncated) {
      parsed.warnings.push({
        type: 'MISSING_DATA',
        location: 'Entire document',
        description: 'Response was truncated due to length limits. Some data may be missing.',
        confidence: 50,
        pageNumber: 0
      })
    }

    return parsed as ExtractionResult
  } catch (e) {
    console.error("Failed to parse extraction JSON:", e)
    return null
  }
}

// Attempt to repair truncated JSON by closing open brackets/braces
function repairTruncatedJson(jsonStr: string): string {
  let repaired = jsonStr.trim()

  // Remove any trailing incomplete tokens (partial strings, numbers, etc.)
  // Look for the last complete value
  const lastCompletePattern = /,\s*"[^"]*$|,\s*\d+$|,\s*$|:\s*"[^"]*$|:\s*\d+$|:\s*$/
  repaired = repaired.replace(lastCompletePattern, '')

  // Count open brackets and braces
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escape = false

  for (const char of repaired) {
    if (escape) {
      escape = false
      continue
    }
    if (char === '\\') {
      escape = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') openBraces++
    else if (char === '}') openBraces--
    else if (char === '[') openBrackets++
    else if (char === ']') openBrackets--
  }

  // If we're in a string, close it
  if (inString) {
    repaired += '"'
  }

  // Close any open brackets first, then braces
  while (openBrackets > 0) {
    repaired += ']'
    openBrackets--
  }
  while (openBraces > 0) {
    repaired += '}'
    openBraces--
  }

  return repaired
}

// Convert extraction + verification to legacy AuditDashboardData format
function toLegacyFormat(extraction: ExtractionResult, verification: ReturnType<typeof runVerification>): AuditDashboardData {
  const dashboardData = toAuditDashboardData(extraction, verification)

  return {
    companyName: dashboardData.companyName,
    reportDate: dashboardData.reportDate,
    financialYearEnd: dashboardData.financialYearEnd,
    kpi: dashboardData.kpi,
    conclusionSummary: dashboardData.conclusionSummary,
    conclusionItems: dashboardData.conclusionItems,
    conclusionNote: dashboardData.conclusionNote,
    verticalCasting: dashboardData.verticalCasting,
    horizontalCasting: dashboardData.horizontalCasting,
    crossReferenceChecks: dashboardData.crossReferenceChecks,
    exceptions: dashboardData.exceptions,
    warnings: dashboardData.warnings,
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

    log("=== REQUEST STARTED (New Architecture: Extract → Verify) ===")
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
        maxOutputTokens: 1000000,
        temperature: 0.1, // Low temperature for consistent extraction
      },
      safetySettings,
    })

    log("=== PHASE 1: LLM EXTRACTION (No arithmetic) ===")
    log("Model", "gemini-2.5-flash")
    log("Purpose", "Extract data only - verification done by code")

    const apiStartTime = Date.now()

    // Helper function to call API with retry on rate limit
    const callWithRetry = async (retryCount = 0): Promise<{ text: string; inputTokens: number; outputTokens: number; wasTruncated: boolean }> => {
      try {
        const prompt = `${EXTRACTION_PROMPT}\n\nExtract all financial data from this document. Remember: EXTRACT ONLY, do not verify or calculate anything.\n\nIMPORTANT: Be CONCISE. Only include key totals and subtotals. Skip minor line items that don't affect totals.`

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

        let wasTruncated = false
        if (candidates && candidates.length > 0) {
          const candidate = candidates[0]
          log("Candidate finish reason", candidate.finishReason)

          if (candidate.finishReason === "SAFETY") {
            log("ERROR: Response blocked by safety filters")
            throw new Error("Response blocked by safety filters. The content may have triggered safety restrictions.")
          }

          if (candidate.finishReason === "RECITATION") {
            log("ERROR: Response blocked due to recitation")
            throw new Error("Response blocked due to recitation policy.")
          }

          if (candidate.finishReason === "MAX_TOKENS") {
            log("WARNING: Response truncated due to MAX_TOKENS - will attempt to repair JSON")
            wasTruncated = true
          }
        }

        // Get text
        let text = ""
        try {
          text = response.text()
        } catch (textError) {
          log("ERROR: Failed to get response text", textError)
          if (candidates && candidates[0]?.content?.parts) {
            text = candidates[0].content.parts
              .filter((part: { text?: string }) => part.text)
              .map((part: { text?: string }) => part.text)
              .join("")
          }
        }

        log("Extraction response length", text.length)

        const usageMetadata = response.usageMetadata
        const inputTokens = usageMetadata?.promptTokenCount || 0
        const outputTokens = usageMetadata?.candidatesTokenCount || 0

        return { text, inputTokens, outputTokens, wasTruncated }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if ((errorMessage.includes("429") || errorMessage.includes("rate") || errorMessage.includes("quota")) && retryCount < 3) {
          const waitTime = Math.pow(2, retryCount) * 30000
          log(`Rate limit hit, waiting ${waitTime / 1000}s before retry ${retryCount + 1}/3`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
          return callWithRetry(retryCount + 1)
        }
        throw error
      }
    }

    const { text: extractionText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, wasTruncated } = await callWithRetry()

    const extractionDuration = Date.now() - apiStartTime
    log("Extraction completed", { durationMs: extractionDuration, wasTruncated })

    // Parse extraction result (with truncation repair if needed)
    const extraction = parseExtractionJson(extractionText, wasTruncated)

    if (!extraction) {
      log("ERROR: Failed to parse extraction result")
      return NextResponse.json({
        error: "Failed to parse extraction result from LLM",
        rawResponse: extractionText.substring(0, 1000),
        debug: { requestId, logs, durationMs: Date.now() - startTime }
      }, { status: 500 })
    }

    log("Extraction parsed successfully", {
      companyName: extraction.companyName,
      statements: extraction.statements.length,
      movements: extraction.movements.length,
      crossReferences: extraction.crossReferences.length,
      castingRelationships: extraction.castingRelationships.length,
      warnings: extraction.warnings.length,
      confidence: extraction.overallConfidence,
    })

    // =========================================================================
    // PHASE 2: CODE-BASED VERIFICATION (100% Accurate Arithmetic)
    // =========================================================================
    log("=== PHASE 2: CODE VERIFICATION (Deterministic arithmetic) ===")

    const verificationStartTime = Date.now()
    const verification = runVerification(extraction)
    const verificationDuration = Date.now() - verificationStartTime

    log("Verification completed", {
      durationMs: verificationDuration,
      totalChecks: verification.kpi.totalChecks,
      passed: verification.kpi.passed,
      failed: verification.kpi.failed,
      exceptionsFound: verification.kpi.exceptionsCount,
      passRate: verification.kpi.passRate,
    })

    // Convert to dashboard format
    const auditData = toLegacyFormat(extraction, verification)

    // Generate HTML dashboard
    const htmlDashboard = generateDashboardHtml(auditData)
    log("Dashboard generated", { htmlLength: htmlDashboard.length })

    // Calculate total duration
    const totalDuration = Date.now() - startTime
    const apiDuration = extractionDuration

    // Calculate costs
    const modelUsed = "gemini-2.5-flash"
    const costs = calculateCost(modelUsed, totalInputTokens, totalOutputTokens)
    log("Cost calculation", costs)

    // Calculate file size
    const fileSizeBytes = Math.round((cleanBase64.length * 3) / 4)
    const fileSizeMB = Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100

    // Save job analytics to Supabase
    const jobAnalytics: JobAnalytics = {
      request_id: requestId,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      file_size_mb: fileSizeMB,
      pdf_pages: undefined,
      model: modelUsed,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      input_cost_usd: costs.inputCost,
      output_cost_usd: costs.outputCost,
      total_cost_usd: costs.totalCost,
      tools_configured: false,
      tools_called: 0,
      tool_usage_summary: {
        extraction_confidence: extraction.overallConfidence,
        verification_method: 'deterministic_code',
      },
      iterations: 1,
      api_duration_ms: apiDuration,
      total_duration_ms: totalDuration,
      stop_reason: "completed",
      analysis_length_chars: extractionText.length,
      analysis_length_words: extractionText.split(/\s+/).length,
      discrepancies_found: verification.kpi.exceptionsCount,
      status: "success",
    }

    const saveResult = await saveJobAnalytics(jobAnalytics)
    log("Supabase save result", saveResult)

    log("=== REQUEST COMPLETED ===")
    log("Summary", {
      architecture: "Extract (LLM) → Verify (Code)",
      extractionDurationMs: extractionDuration,
      verificationDurationMs: verificationDuration,
      totalDurationMs: totalDuration,
      checksPerformed: verification.kpi.totalChecks,
      accuracy: "100% (deterministic code verification)",
    })

    // Return response based on output format
    if (outputFormat === "json") {
      return NextResponse.json({
        data: auditData,
        extraction: extraction,
        verification: {
          kpi: verification.kpi,
          method: verification.verificationMethod,
          exceptionsCount: verification.kpi.exceptionsCount,
        },
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
          architecture: "extract_then_verify",
          extractionDurationMs: extractionDuration,
          verificationDurationMs: verificationDuration,
          totalDurationMs: totalDuration,
          fileSizeBytes,
          fileSizeMB,
          stopReason: "completed",
          analyticsSaved: saveResult.success,
        },
      })
    }

    // Default: return HTML dashboard
    return NextResponse.json({
      html: htmlDashboard,
      data: auditData,
      verification: {
        method: verification.verificationMethod,
        totalChecks: verification.kpi.totalChecks,
        passRate: verification.kpi.passRate,
      },
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
        architecture: "extract_then_verify",
        extractionDurationMs: extractionDuration,
        verificationDurationMs: verificationDuration,
        totalDurationMs: totalDuration,
        fileSizeBytes,
        fileSizeMB,
        stopReason: "completed",
        discrepanciesFound: verification.kpi.exceptionsCount,
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
