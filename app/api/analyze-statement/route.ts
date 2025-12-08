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

IMPORTANT: You have access to calculator tools. USE THEM for ALL arithmetic operations to ensure 100% accuracy. Do not perform mental math.

Perform these checks:
1. Vertical casting - Recompute every subtotal and total line by line using calculator tools
2. Horizontal casting - Compare current year and prior year, compute variances using calculator tools
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

// Define calculator tools
const CALCULATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "add",
    description: "Add two numbers together. Use this for any addition operation.",
    input_schema: {
      type: "object" as const,
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "subtract",
    description: "Subtract the second number from the first. Use this for any subtraction operation.",
    input_schema: {
      type: "object" as const,
      properties: {
        a: { type: "number", description: "Number to subtract from" },
        b: { type: "number", description: "Number to subtract" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "multiply",
    description: "Multiply two numbers together. Use this for any multiplication operation.",
    input_schema: {
      type: "object" as const,
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "divide",
    description: "Divide the first number by the second. Use this for any division operation.",
    input_schema: {
      type: "object" as const,
      properties: {
        a: { type: "number", description: "Dividend (number to be divided)" },
        b: { type: "number", description: "Divisor (number to divide by)" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "sum",
    description: "Add multiple numbers together. Use this when you need to sum a list of values (e.g., adding up line items in a financial statement).",
    input_schema: {
      type: "object" as const,
      properties: {
        numbers: {
          type: "array",
          items: { type: "number" },
          description: "Array of numbers to sum",
        },
      },
      required: ["numbers"],
    },
  },
  {
    name: "compare",
    description: "Compare two numbers and return the difference. Use this to check if two values match and calculate any variance.",
    input_schema: {
      type: "object" as const,
      properties: {
        expected: { type: "number", description: "Expected value" },
        actual: { type: "number", description: "Actual value" },
      },
      required: ["expected", "actual"],
    },
  },
  {
    name: "percentage",
    description: "Calculate percentage change or percentage of a value.",
    input_schema: {
      type: "object" as const,
      properties: {
        value: { type: "number", description: "The value" },
        base: { type: "number", description: "The base value (for percentage of) or previous value (for percentage change)" },
        type: { type: "string", enum: ["of", "change"], description: "'of' for percentage of base, 'change' for percentage change from base" },
      },
      required: ["value", "base", "type"],
    },
  },
  {
    name: "round",
    description: "Round a number to specified decimal places.",
    input_schema: {
      type: "object" as const,
      properties: {
        value: { type: "number", description: "The number to round" },
        decimals: { type: "number", description: "Number of decimal places (default 2)" },
      },
      required: ["value"],
    },
  },
]

// Execute calculator tool
function executeCalculatorTool(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "add": {
      const a = input.a as number
      const b = input.b as number
      const result = a + b
      return JSON.stringify({ result, calculation: `${a} + ${b} = ${result}` })
    }
    case "subtract": {
      const a = input.a as number
      const b = input.b as number
      const result = a - b
      return JSON.stringify({ result, calculation: `${a} - ${b} = ${result}` })
    }
    case "multiply": {
      const a = input.a as number
      const b = input.b as number
      const result = a * b
      return JSON.stringify({ result, calculation: `${a} × ${b} = ${result}` })
    }
    case "divide": {
      const a = input.a as number
      const b = input.b as number
      if (b === 0) {
        return JSON.stringify({ error: "Division by zero", result: null })
      }
      const result = a / b
      return JSON.stringify({ result, calculation: `${a} ÷ ${b} = ${result}` })
    }
    case "sum": {
      const numbers = input.numbers as number[]
      const result = numbers.reduce((acc, n) => acc + n, 0)
      return JSON.stringify({
        result,
        calculation: `${numbers.join(" + ")} = ${result}`,
        count: numbers.length,
      })
    }
    case "compare": {
      const expected = input.expected as number
      const actual = input.actual as number
      const difference = actual - expected
      const matches = Math.abs(difference) < 0.01
      return JSON.stringify({
        expected,
        actual,
        difference,
        absoluteDifference: Math.abs(difference),
        matches,
        status: matches ? "MATCH" : "DISCREPANCY",
      })
    }
    case "percentage": {
      const value = input.value as number
      const base = input.base as number
      const type = input.type as string
      if (base === 0) {
        return JSON.stringify({ error: "Base cannot be zero", result: null })
      }
      if (type === "of") {
        const result = (value / base) * 100
        return JSON.stringify({ result, calculation: `${value} is ${result.toFixed(2)}% of ${base}` })
      } else {
        const result = ((value - base) / base) * 100
        return JSON.stringify({
          result,
          calculation: `Change from ${base} to ${value} = ${result.toFixed(2)}%`,
          direction: result > 0 ? "increase" : result < 0 ? "decrease" : "no change",
        })
      }
    }
    case "round": {
      const value = input.value as number
      const decimals = (input.decimals as number) ?? 2
      const result = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
      return JSON.stringify({ result, original: value, decimals })
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}

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
  const toolCalls: Array<{ tool: string; input: unknown; output: string; iteration: number }> = []
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

    const toolNames = CALCULATOR_TOOLS.map((t) => t.name)
    log("=== CLAUDE API REQUEST ===")
    log("Model", "claude-sonnet-4-20250514")
    log("Max tokens", 16000)
    log("Tools configured", { hasTools: true, toolCount: CALCULATOR_TOOLS.length, toolNames })
    log("System prompt length", AUDIT_PROMPT.length)

    const apiStartTime = Date.now()

    // Initial message with extracted text (instead of raw PDF to reduce tokens)
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${AUDIT_PROMPT}\n\n=== FINANCIAL STATEMENT DOCUMENT: ${fileName} (${pdfPages} pages) ===\n\n${pdfText}\n\n=== END OF DOCUMENT ===\n\nAnalyze the financial statement above and perform a comprehensive casting check. USE THE CALCULATOR TOOLS for all arithmetic. Return ONLY the JSON structure specified above.`,
          },
        ],
      },
    ]

    let iteration = 0
    const maxIterations = 50
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let finalAnalysis = ""
    let lastMessage: Anthropic.Message | null = null

    log("=== STARTING TOOL USE LOOP ===")

    // Helper function to call API with retry on rate limit
    const callWithRetry = async (retryCount = 0): Promise<Anthropic.Message> => {
      try {
        return await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          tools: CALCULATOR_TOOLS,
          messages,
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

    // Tool use loop
    while (iteration < maxIterations) {
      iteration++
      log(`--- Iteration ${iteration} ---`)

      const message = await callWithRetry()

      lastMessage = message
      totalInputTokens += message.usage.input_tokens
      totalOutputTokens += message.usage.output_tokens

      log(`Iteration ${iteration} response`, {
        stopReason: message.stop_reason,
        contentBlocks: message.content.length,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      })

      if (message.stop_reason === "end_turn") {
        log("=== TOOL USE LOOP COMPLETED ===", { totalIterations: iteration })
        const textBlocks = message.content.filter((block) => block.type === "text")
        finalAnalysis = textBlocks
          .map((block) => ("text" in block ? block.text : ""))
          .join("\n\n")
        break
      }

      const toolUseBlocks = message.content.filter((block) => block.type === "tool_use")

      if (toolUseBlocks.length === 0) {
        const textBlocks = message.content.filter((block) => block.type === "text")
        finalAnalysis = textBlocks
          .map((block) => ("text" in block ? block.text : ""))
          .join("\n\n")
        break
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of toolUseBlocks) {
        if (block.type === "tool_use") {
          const toolInput = block.input as Record<string, unknown>
          const toolOutput = executeCalculatorTool(block.name, toolInput)

          toolCalls.push({
            tool: block.name,
            input: toolInput,
            output: toolOutput,
            iteration,
          })

          log(`Tool call: ${block.name}`, { input: toolInput, output: JSON.parse(toolOutput) })

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: toolOutput,
          })
        }
      }

      messages.push({
        role: "assistant",
        content: message.content,
      })

      messages.push({
        role: "user",
        content: toolResults,
      })
    }

    const apiDuration = Date.now() - apiStartTime

    log("=== CLAUDE API RESPONSE SUMMARY ===")
    log("API call duration", { durationMs: apiDuration, durationSec: (apiDuration / 1000).toFixed(2) })
    log("Total iterations", iteration)
    log("Total tool calls", toolCalls.length)
    log("Token usage", {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    })

    const toolUsageSummary = toolCalls.reduce((acc, call) => {
      acc[call.tool] = (acc[call.tool] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    log("=== TOOL USAGE ANALYSIS ===")
    log("Tool calls by type", toolUsageSummary)

    // Calculate costs
    const modelUsed = lastMessage?.model || "claude-sonnet-4-20250514"
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
      tools_configured: true,
      tools_called: toolCalls.length,
      tool_usage_summary: toolUsageSummary,
      iterations: iteration,
      api_duration_ms: apiDuration,
      total_duration_ms: Date.now() - startTime,
      stop_reason: lastMessage?.stop_reason || "unknown",
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
          toolsConfigured: true,
          toolsAvailable: toolNames,
          toolsCalled: toolCalls.length,
          toolUsageSummary,
          iterations: iteration,
          stopReason: lastMessage?.stop_reason,
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
        toolsConfigured: true,
        toolsAvailable: toolNames,
        toolsCalled: toolCalls.length,
        toolUsageSummary,
        iterations: iteration,
        stopReason: lastMessage?.stop_reason,
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
        tools_configured: true,
        tools_called: toolCalls.length,
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
        debug: { requestId, logs, toolCalls, durationMs: Date.now() - startTime }
      }, { status: 500 })
    }

    return NextResponse.json({
      error: "Failed to analyze financial statement",
      debug: { requestId, logs, toolCalls, durationMs: Date.now() - startTime }
    }, { status: 500 })
  }
}
