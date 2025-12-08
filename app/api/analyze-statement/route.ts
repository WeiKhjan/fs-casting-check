import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const AUDIT_PROMPT = `You are an experienced external auditor. Your task is to perform complete casting and cross checking of financial statements with full accuracy. Follow all instructions strictly.

1. Vertical casting Recompute every subtotal and total line by line. Add up all amounts independently. Identify any differences, including small rounding errors. Clearly display all recalculations.
2. Horizontal casting Compare current year and prior year numbers. Highlight unusual or inconsistent movements. Confirm that year on year movements agree to the supporting notes. Flag any variances that do not reconcile.
3. Cross referencing to the notes Check that every number in the notes agrees exactly to the primary financial statements. Tie each note item to its corresponding line in the statements. Identify any mismatch, reclassification, rounding difference or missing linkage.
4. Internal consistency checks Confirm that the Balance Sheet balances. Confirm that opening balances in notes match the prior year closing balances. Check that reconciliations such as PPE, receivables, payables, equity and borrowings are mathematically correct. Ensure subtotals used in ratios or analysis agree to underlying line items.
5. Workings Show all workings in full. Do not summarise. Present step by step calculations, comparison tables, variance tables and tie out tables. Make every number traceable to the source figure.
6. Exception reporting Prepare a complete list of discrepancies. Categorise them into casting errors, note vs statement mismatches, prior year vs current year inconsistencies and missing or incomplete disclosures. For each discrepancy, explain the cause and provide the corrected figure when possible.
7. Audit quality requirements Do not assume or invent numbers. Use only the numbers given. Maintain professional scepticism. If something is unclear, state the issue explicitly. Ensure your output can be used directly in audit documentation.

IMPORTANT - Final output format (follow this order strictly):
1. EXECUTIVE SUMMARY OF DISCREPANCIES - Start with a clear, prominent section listing ALL discrepancies found. Use a table or numbered list format. For each discrepancy include: location, nature of error, expected value, actual value, and variance amount. Flag critical errors with [CRITICAL], moderate issues with [MODERATE], and minor issues with [MINOR].
2. CONCLUSION - State whether the financial statements cast correctly overall.
3. DETAILED WORKINGS - Full workings in order: vertical casting, horizontal casting, cross referencing, internal consistency checks. Show all calculations and tie-outs.`

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()
  const logs: string[] = []

  const log = (message: string, data?: unknown) => {
    const timestamp = new Date().toISOString()
    const elapsed = Date.now() - startTime
    const logEntry = `[${timestamp}] [${requestId}] [+${elapsed}ms] ${message}`
    console.log(logEntry, data !== undefined ? JSON.stringify(data, null, 2) : "")
    logs.push(data !== undefined ? `${logEntry} ${JSON.stringify(data)}` : logEntry)
  }

  try {
    const body = await request.json()
    const { pdfBase64, fileName } = body

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

    let cleanBase64 = ""
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

    log("=== CLAUDE API REQUEST ===")
    log("Model", "claude-sonnet-4-20250514")
    log("Max tokens", 16000)
    log("Tools configured", { hasTools: false, toolCount: 0, toolNames: [] })
    log("System prompt length", AUDIT_PROMPT.length)

    const apiStartTime = Date.now()

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      messages: [
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
              text: `${AUDIT_PROMPT}\n\nPlease analyze the financial statement document (${fileName}) and perform a comprehensive casting check following all the requirements above.`,
            },
          ],
        },
      ],
    })

    const apiDuration = Date.now() - apiStartTime

    log("=== CLAUDE API RESPONSE ===")
    log("API call duration", { durationMs: apiDuration, durationSec: (apiDuration / 1000).toFixed(2) })
    log("Response ID", message.id)
    log("Model used", message.model)
    log("Stop reason", message.stop_reason)
    log("Token usage", {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
    })

    // Analyze content blocks
    const contentBlockAnalysis = message.content.map((block, index) => ({
      index,
      type: block.type,
      ...(block.type === "text" && { textLength: block.text.length, preview: block.text.substring(0, 100) + "..." }),
      ...(block.type === "tool_use" && { toolName: (block as { name: string }).name, toolId: (block as { id: string }).id }),
    }))

    log("Content blocks received", { count: message.content.length, blocks: contentBlockAnalysis })

    // Check for tool usage
    const toolUseBlocks = message.content.filter((block) => block.type === "tool_use")
    const textBlocks = message.content.filter((block) => block.type === "text")

    log("=== TOOL USAGE ANALYSIS ===")
    log("Tool calls made by Claude", {
      toolCallCount: toolUseBlocks.length,
      hasToolCalls: toolUseBlocks.length > 0,
      message: toolUseBlocks.length === 0
        ? "No tools were called - Claude performed analysis using built-in reasoning only"
        : `Claude called ${toolUseBlocks.length} tool(s)`,
    })

    if (toolUseBlocks.length > 0) {
      toolUseBlocks.forEach((block, index) => {
        const toolBlock = block as { type: "tool_use"; id: string; name: string; input: unknown }
        log(`Tool call #${index + 1}`, {
          toolName: toolBlock.name,
          toolId: toolBlock.id,
          input: toolBlock.input,
        })
      })
    }

    // Extract the text response
    const analysis = textBlocks
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n\n")

    log("=== RESPONSE SUMMARY ===")
    log("Analysis length", { characters: analysis.length, words: analysis.split(/\s+/).length })
    log("Total request duration", { durationMs: Date.now() - startTime, durationSec: ((Date.now() - startTime) / 1000).toFixed(2) })
    log("=== REQUEST COMPLETED ===")

    return NextResponse.json({
      analysis,
      model: message.model,
      usage: message.usage,
      debug: {
        requestId,
        totalDurationMs: Date.now() - startTime,
        apiDurationMs: apiDuration,
        toolsConfigured: false,
        toolsCalled: toolUseBlocks.length,
        contentBlocks: contentBlockAnalysis,
        stopReason: message.stop_reason,
        logs,
      },
    })
  } catch (error) {
    log("=== ERROR ===")
    log("Error occurred", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

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
