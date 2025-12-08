import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const AUDIT_PROMPT = `You are an experienced external auditor. Your task is to perform complete casting and cross checking of financial statements with full accuracy. Follow all instructions strictly.

1. Vertical casting Recompute every subtotal and total line by line. Add up all amounts independently. Identify any differences, including small rounding errors. Clearly display all recalculations.
1. Horizontal casting Compare current year and prior year numbers. Highlight unusual or inconsistent movements. Confirm that year on year movements agree to the supporting notes. Flag any variances that do not reconcile.
1. Cross referencing to the notes Check that every number in the notes agrees exactly to the primary financial statements. Tie each note item to its corresponding line in the statements. Identify any mismatch, reclassification, rounding difference or missing linkage.
1. Internal consistency checks Confirm that the Balance Sheet balances. Confirm that opening balances in notes match the prior year closing balances. Check that reconciliations such as PPE, receivables, payables, equity and borrowings are mathematically correct. Ensure subtotals used in ratios or analysis agree to underlying line items.
1. Workings Show all workings in full. Do not summarise. Present step by step calculations, comparison tables, variance tables and tie out tables. Make every number traceable to the source figure.
1. Exception reporting Prepare a complete list of discrepancies. Categorise them into casting errors, note vs statement mismatches, prior year vs current year inconsistencies and missing or incomplete disclosures. For each discrepancy, explain the cause and provide the corrected figure when possible.
1. Audit quality requirements Do not assume or invent numbers. Use only the numbers given. Maintain professional scepticism. If something is unclear, state the issue explicitly. Ensure your output can be used directly in audit documentation.
   Final output format: a. Full workings in order: vertical casting, horizontal casting, cross referencing. b. Exception report listing all mismatches. c. Final conclusion stating whether the financial statements cast correctly.`

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pdfBase64, fileName } = body

    console.log("[v0] Request received:", { fileName, hasBase64: !!pdfBase64 })

    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "ANTHROPIC_API_KEY environment variable is not configured. Please add it in the Vercel project settings.",
        },
        { status: 500 },
      )
    }

    if (!pdfBase64) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    let cleanBase64 = ""
    if (typeof pdfBase64 === "string") {
      // Remove data URL prefix if present
      if (pdfBase64.includes(",")) {
        cleanBase64 = pdfBase64.split(",")[1]
      } else {
        cleanBase64 = pdfBase64
      }
      // Remove any whitespace or newlines
      cleanBase64 = cleanBase64.replace(/\s/g, "")
    } else {
      return NextResponse.json({ error: "Invalid PDF data format" }, { status: 400 })
    }

    console.log("[v0] Base64 data cleaned, length:", cleanBase64.length)

    const anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    })

    console.log("[v0] Anthropic client initialized, calling API...")

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

    console.log("[v0] API call successful, processing response...")

    // Extract the text response
    const analysis = message.content
      .filter((block) => block.type === "text")
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n\n")

    return NextResponse.json({
      analysis,
      model: message.model,
      usage: message.usage,
    })
  } catch (error) {
    console.error("[v0] Error analyzing financial statement:", error)

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ error: "Failed to analyze financial statement" }, { status: 500 })
  }
}
