import { type NextRequest, NextResponse } from "next/server"
import { saveJobAnalytics, calculateCost, type JobAnalytics } from "@/lib/supabase"
import { generateDashboardHtml, type AuditDashboardData } from "@/lib/dashboard-template"
import { ExtractionResult } from "@/lib/extraction-types"
import { runVerification, toAuditDashboardData } from "@/lib/verification-engine"
import { extractWithSingleCall, withRetry } from "@/lib/gemini-extraction-v2"

// Note: Vercel's free tier has a 4.5MB limit, Pro has 5MB limit
// For App Router, use route segment config instead of config object

// For App Router, we also need to export runtime config
export const maxDuration = 300 // 5 minutes for large PDF processing

// ============================================================================
// NEW ARCHITECTURE: Gemini Tool Calling for Column-Aware Extraction
// ============================================================================
// - Uses Gemini function calling to extract data with explicit column context
// - Prevents column mixing (Group vs Company, Current vs Prior)
// - Code performs ALL arithmetic verification (100% accurate)
// ============================================================================

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

    log("=== PHASE 1: SINGLE-CALL COLUMN-AWARE EXTRACTION ===")
    log("Model", "gemini-2.5-flash")
    log("Purpose", "Single API call with column-aware JSON extraction (handles many tables efficiently)")

    const apiStartTime = Date.now()

    // Use single API call for efficient extraction
    const { result: extraction, stats } = await withRetry(
      () => extractWithSingleCall(apiKey, cleanBase64, log),
      3,
      log
    )

    const extractionDuration = Date.now() - apiStartTime
    const totalInputTokens = stats.inputTokens
    const totalOutputTokens = stats.outputTokens

    log("Single-call extraction completed", {
      durationMs: extractionDuration,
      iterations: stats.iterations,
    })

    log("Extraction results", {
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
        extraction_method: 'single_call_json',
        castings_extracted: extraction.castingRelationships.length,
        cross_refs_extracted: extraction.crossReferences.length,
        movements_extracted: extraction.movements.length,
      },
      iterations: 1,
      api_duration_ms: apiDuration,
      total_duration_ms: totalDuration,
      stop_reason: "completed",
      analysis_length_chars: 0,
      analysis_length_words: 0,
      discrepancies_found: verification.kpi.exceptionsCount,
      status: "success",
    }

    const saveResult = await saveJobAnalytics(jobAnalytics)
    log("Supabase save result", saveResult)

    log("=== REQUEST COMPLETED ===")
    log("Summary", {
      architecture: "Single-Call Extraction → Code Verify",
      extractionMethod: "column-aware single JSON call",
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
          architecture: "single_call_extraction",
          extractionMethod: "column-aware JSON",
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
        architecture: "single_call_extraction",
        extractionMethod: "column-aware JSON",
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
