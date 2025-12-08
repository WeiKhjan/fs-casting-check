import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { saveJobAnalytics, calculateCost, type JobAnalytics } from "@/lib/supabase"

const AUDIT_PROMPT = `You are an experienced external auditor. Your task is to perform complete casting and cross checking of financial statements with full accuracy. Follow all instructions strictly.

IMPORTANT: You have access to calculator tools. USE THEM for ALL arithmetic operations to ensure 100% accuracy. Do not perform mental math - always use the calculator tools provided.

1. Vertical casting Recompute every subtotal and total line by line. Add up all amounts independently using the calculator tools. Identify any differences, including small rounding errors. Clearly display all recalculations.
2. Horizontal casting Compare current year and prior year numbers. Use calculator tools to compute variances. Highlight unusual or inconsistent movements. Confirm that year on year movements agree to the supporting notes. Flag any variances that do not reconcile.
3. Cross referencing to the notes Check that every number in the notes agrees exactly to the primary financial statements. Tie each note item to its corresponding line in the statements. Identify any mismatch, reclassification, rounding difference or missing linkage.
4. Internal consistency checks Confirm that the Balance Sheet balances using calculator tools. Confirm that opening balances in notes match the prior year closing balances. Check that reconciliations such as PPE, receivables, payables, equity and borrowings are mathematically correct. Ensure subtotals used in ratios or analysis agree to underlying line items.
5. Workings Show all workings in full. Do not summarise. Present step by step calculations, comparison tables, variance tables and tie out tables. Make every number traceable to the source figure.
6. Exception reporting Prepare a complete list of discrepancies. Categorise them into casting errors, note vs statement mismatches, prior year vs current year inconsistencies and missing or incomplete disclosures. For each discrepancy, explain the cause and provide the corrected figure when possible.
7. Audit quality requirements Do not assume or invent numbers. Use only the numbers given. Maintain professional scepticism. If something is unclear, state the issue explicitly. Ensure your output can be used directly in audit documentation.

IMPORTANT - Final output format (follow this order strictly):

1. EXECUTIVE SUMMARY OF DISCREPANCIES
   - ONLY list items where there is an ACTUAL discrepancy (values do not match, calculations are incorrect, or figures do not reconcile)
   - DO NOT include items that balance correctly or pass verification - those belong in the detailed workings section only
   - If no discrepancies are found, clearly state "NO DISCREPANCIES FOUND" in this section
   - For each REAL discrepancy include:
     * Location (which statement, line item, note reference)
     * Nature of error (what is wrong)
     * Expected value (what it should be)
     * Actual value (what is shown in the document)
     * Variance amount (the difference)
   - Severity tags (use ONLY for actual errors):
     * [CRITICAL] - Material errors that significantly misstate the financial position (e.g., balance sheet doesn't balance, major calculation errors)
     * [MODERATE] - Errors that affect accuracy but are not material (e.g., note doesn't tie to statement, rounding differences > threshold)
     * [MINOR] - Small rounding differences or presentation issues

2. CONCLUSION - State whether the financial statements cast correctly overall. Summarize the number and severity of discrepancies found.

3. DETAILED WORKINGS - Full workings in order: vertical casting, horizontal casting, cross referencing, internal consistency checks. Show all calculations and tie-outs. Include verification of items that PASSED (balance correctly) in this section, not in the discrepancy summary.`

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
      const matches = Math.abs(difference) < 0.01 // Allow for small rounding differences
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
    const { pdfBase64 } = body
    fileName = body.fileName || "unknown"

    log("=== REQUEST STARTED ===")
    log("File received", { fileName, base64Length: pdfBase64?.length || 0 })

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

    // Initial message with PDF
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: cleanBase64,
            },
          },
          {
            type: "text",
            text: `${AUDIT_PROMPT}\n\nPlease analyze the financial statement document (${fileName}) and perform a comprehensive casting check following all the requirements above. USE THE CALCULATOR TOOLS for all arithmetic operations to ensure accuracy.`,
          },
        ],
      },
    ]

    let iteration = 0
    const maxIterations = 50 // Safety limit
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let finalAnalysis = ""
    let lastMessage: Anthropic.Message | null = null

    log("=== STARTING TOOL USE LOOP ===")

    // Tool use loop
    while (iteration < maxIterations) {
      iteration++
      log(`--- Iteration ${iteration} ---`)

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        tools: CALCULATOR_TOOLS,
        messages,
      })

      lastMessage = message
      totalInputTokens += message.usage.input_tokens
      totalOutputTokens += message.usage.output_tokens

      log(`Iteration ${iteration} response`, {
        stopReason: message.stop_reason,
        contentBlocks: message.content.length,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      })

      // Check if we're done (no more tool use)
      if (message.stop_reason === "end_turn") {
        log("=== TOOL USE LOOP COMPLETED ===", { totalIterations: iteration })

        // Extract final text response
        const textBlocks = message.content.filter((block) => block.type === "text")
        finalAnalysis = textBlocks
          .map((block) => ("text" in block ? block.text : ""))
          .join("\n\n")
        break
      }

      // Process tool use blocks
      const toolUseBlocks = message.content.filter((block) => block.type === "tool_use")

      if (toolUseBlocks.length === 0) {
        // No tool use and not end_turn - extract text and break
        const textBlocks = message.content.filter((block) => block.type === "text")
        finalAnalysis = textBlocks
          .map((block) => ("text" in block ? block.text : ""))
          .join("\n\n")
        break
      }

      // Build tool results
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

      // Add assistant message and tool results to conversation
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

    // Analyze tool usage
    const toolUsageSummary = toolCalls.reduce((acc, call) => {
      acc[call.tool] = (acc[call.tool] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    log("=== TOOL USAGE ANALYSIS ===")
    log("Tool calls by type", toolUsageSummary)
    log("Tool calls made by Claude", {
      toolCallCount: toolCalls.length,
      hasToolCalls: toolCalls.length > 0,
      message: toolCalls.length === 0
        ? "No tools were called - Claude performed analysis using built-in reasoning only"
        : `Claude called ${toolCalls.length} tool(s) across ${iteration} iteration(s)`,
    })

    log("=== RESPONSE SUMMARY ===")
    log("Analysis length", { characters: finalAnalysis.length, words: finalAnalysis.split(/\s+/).length })
    log("Total request duration", { durationMs: Date.now() - startTime, durationSec: ((Date.now() - startTime) / 1000).toFixed(2) })

    // Calculate costs
    const modelUsed = lastMessage?.model || "claude-sonnet-4-20250514"
    const costs = calculateCost(modelUsed, totalInputTokens, totalOutputTokens)
    log("Cost calculation", costs)

    // Count discrepancies from analysis
    const criticalCount = (finalAnalysis.match(/\[CRITICAL\]/g) || []).length
    const moderateCount = (finalAnalysis.match(/\[MODERATE\]/g) || []).length
    const minorCount = (finalAnalysis.match(/\[MINOR\]/g) || []).length
    const totalDiscrepancies = criticalCount + moderateCount + minorCount

    // Calculate file size
    const fileSizeBytes = Math.round((cleanBase64.length * 3) / 4)
    const fileSizeMB = Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100

    // Save job analytics to Supabase
    const jobAnalytics: JobAnalytics = {
      request_id: requestId,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      file_size_mb: fileSizeMB,
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
      discrepancies_found: totalDiscrepancies,
      status: "success",
    }

    const saveResult = await saveJobAnalytics(jobAnalytics)
    log("Supabase save result", saveResult)
    log("=== REQUEST COMPLETED ===")

    return NextResponse.json({
      analysis: finalAnalysis,
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
        toolCallDetails: toolCalls,
        stopReason: lastMessage?.stop_reason,
        discrepancies: {
          critical: criticalCount,
          moderate: moderateCount,
          minor: minorCount,
          total: totalDiscrepancies,
        },
        analyticsSaved: saveResult.success,
        logs,
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
