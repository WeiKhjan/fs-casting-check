// ============================================================================
// GEMINI TOOL-CALLING EXTRACTION - Process function calls from Gemini
// ============================================================================

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, FunctionCallingMode, Part } from "@google/generative-ai"
import {
  ALL_EXTRACTION_TOOLS,
  TOOL_CALLING_PROMPT,
  ToolCallExtractionResult,
  ExtractedCastingWithColumn,
  ExtractedCrossReferenceWithColumn,
  ExtractedMovementWithColumn,
  ExtractedBalanceSheetTotals,
  ExtractedWarning,
  ExtractedMetadata,
  ColumnIdentification,
  ExtractionCompletionInfo,
} from "./gemini-tools"
import { ExtractionResult, ExtractedCastingRelationship, ExtractedMovement, ExtractedCrossReference, ExtractionWarning } from "./extraction-types"

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

export interface ExtractionStats {
  inputTokens: number
  outputTokens: number
  toolCallsCount: number
  iterations: number
}

export async function extractWithToolCalling(
  apiKey: string,
  pdfBase64: string,
  log: (message: string, data?: unknown) => void
): Promise<{ result: ExtractionResult; stats: ExtractionStats }> {
  const genAI = new GoogleGenerativeAI(apiKey)

  // Safety settings
  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ]

  // Create model with tools
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      maxOutputTokens: 65536,
      temperature: 0.1,
      // @ts-expect-error - thinkingConfig is valid but not typed
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings,
    tools: [{ functionDeclarations: ALL_EXTRACTION_TOOLS }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.AUTO,
      },
    },
  })

  // Initialize extraction result
  const toolCallResult: ToolCallExtractionResult = {
    metadata: null,
    columns: null,
    balanceSheetTotals: [],
    castings: [],
    crossReferences: [],
    movements: [],
    warnings: [],
    completionInfo: null,
  }

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let toolCallsCount = 0
  let iterations = 0
  const maxIterations = 20 // Safety limit

  // Start chat with PDF and prompt
  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          { text: TOOL_CALLING_PROMPT },
        ],
      },
    ],
  })

  log("Starting tool-calling extraction")

  // Loop until model stops calling tools or we hit limit
  let continueLoop = true
  let lastResponse = await chat.sendMessage("Begin extraction. Start by identifying the column structure.")

  while (continueLoop && iterations < maxIterations) {
    iterations++

    const response = lastResponse
    const usageMetadata = response.response.usageMetadata
    totalInputTokens += usageMetadata?.promptTokenCount || 0
    totalOutputTokens += usageMetadata?.candidatesTokenCount || 0

    const candidate = response.response.candidates?.[0]
    if (!candidate) {
      log("No candidate in response")
      break
    }

    // Check for function calls
    const functionCalls = candidate.content?.parts?.filter(
      (part): part is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in part && part.functionCall !== undefined
    )

    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls - model is done or wants to respond with text
      log("No more function calls, extraction complete")
      continueLoop = false
      break
    }

    // Process each function call
    const functionResponses: Part[] = []

    for (const part of functionCalls) {
      const { name, args } = part.functionCall
      toolCallsCount++
      log(`Tool call #${toolCallsCount}: ${name}`, args)

      // Handle each tool type
      try {
        switch (name) {
          case "identify_columns":
            toolCallResult.columns = args as unknown as ColumnIdentification
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: "Column structure identified. Now extract metadata." },
              },
            })
            break

          case "extract_metadata":
            toolCallResult.metadata = args as unknown as ExtractedMetadata
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: "Metadata extracted. Now extract balance sheet totals for each column." },
              },
            })
            break

          case "extract_balance_sheet_totals":
            toolCallResult.balanceSheetTotals.push(args as unknown as ExtractedBalanceSheetTotals)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: `Balance sheet totals for ${(args as { columnSource: string }).columnSource} recorded. Continue with other columns or proceed to casting relationships.` },
              },
            })
            break

          case "extract_casting":
            toolCallResult.castings.push(args as unknown as ExtractedCastingWithColumn)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: `Casting for ${(args as { section: string }).section} (${(args as { columnSource: string }).columnSource}) recorded. Continue extracting more castings.` },
              },
            })
            break

          case "extract_cross_reference":
            toolCallResult.crossReferences.push(args as unknown as ExtractedCrossReferenceWithColumn)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: `Cross-reference for ${(args as { noteRef: string }).noteRef} recorded. Continue extracting more cross-references.` },
              },
            })
            break

          case "extract_movement":
            toolCallResult.movements.push(args as unknown as ExtractedMovementWithColumn)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: `Movement for ${(args as { accountName: string }).accountName} recorded. Continue extracting more movements.` },
              },
            })
            break

          case "flag_warning":
            toolCallResult.warnings.push(args as unknown as ExtractedWarning)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: "Warning recorded. Continue extraction." },
              },
            })
            break

          case "extraction_complete":
            toolCallResult.completionInfo = args as unknown as ExtractionCompletionInfo
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: true, message: "Extraction complete. Thank you." },
              },
            })
            continueLoop = false
            break

          default:
            log(`Unknown tool: ${name}`)
            functionResponses.push({
              functionResponse: {
                name,
                response: { success: false, error: `Unknown tool: ${name}` },
              },
            })
        }
      } catch (error) {
        log(`Error processing tool ${name}:`, error)
        functionResponses.push({
          functionResponse: {
            name,
            response: { success: false, error: String(error) },
          },
        })
      }
    }

    // Send function responses back to continue the conversation
    if (continueLoop && functionResponses.length > 0) {
      lastResponse = await chat.sendMessage(functionResponses)
    }
  }

  log("Tool calling extraction finished", {
    iterations,
    toolCallsCount,
    castingsExtracted: toolCallResult.castings.length,
    crossRefsExtracted: toolCallResult.crossReferences.length,
    movementsExtracted: toolCallResult.movements.length,
    warningsExtracted: toolCallResult.warnings.length,
  })

  // Convert tool call result to ExtractionResult format
  const extractionResult = convertToExtractionResult(toolCallResult, log)

  return {
    result: extractionResult,
    stats: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolCallsCount,
      iterations,
    },
  }
}

// ============================================================================
// CONVERT TOOL CALL RESULT TO EXTRACTION RESULT
// ============================================================================

function convertToExtractionResult(
  toolResult: ToolCallExtractionResult,
  log: (message: string, data?: unknown) => void
): ExtractionResult {
  // Determine which column to use for verification
  // Priority: group_current > company_current > current
  const preferredColumn = toolResult.columns?.hasGroupColumns
    ? "group_current"
    : toolResult.columns?.hasCompanyColumns
      ? "company_current"
      : "current"

  log("Converting to extraction result", { preferredColumn })

  // Filter castings for preferred column only
  const filteredCastings = toolResult.castings.filter(
    c => c.columnSource === preferredColumn
  )

  // Convert castings
  const castingRelationships: ExtractedCastingRelationship[] = filteredCastings.map(c => ({
    totalLabel: c.totalLabel,
    totalAmount: c.totalAmount,
    componentLabels: c.components.map(comp => comp.label),
    componentAmounts: c.components.map(comp => comp.amount),
    section: `${c.section} (${c.columnSource})`,
    pageNumber: c.pageNumber,
  }))

  // Filter cross-references for preferred column
  const filteredCrossRefs = toolResult.crossReferences.filter(
    cr => cr.columnSource === preferredColumn
  )

  // Convert cross-references
  const crossReferences: ExtractedCrossReference[] = filteredCrossRefs.map(cr => ({
    noteRef: cr.noteRef,
    noteDescription: cr.noteDescription,
    noteTotal: cr.noteTotal,
    statementLineItem: cr.statementLineItem,
    statementAmount: cr.statementAmount,
    statementType: cr.statementType as "SOFP" | "SOCI" | "SOCE" | "SCF" | "NOTE",
    isExpenseOrDeduction: cr.isExpenseOrDeduction,
    mappingConfidence: cr.mappingConfidence,
    mappingType: cr.mappingType as "total_to_total" | "component_to_component" | "component_to_total" | "uncertain",
  }))

  // Filter movements for preferred column
  const filteredMovements = toolResult.movements.filter(
    m => m.columnSource === preferredColumn
  )

  // Convert movements
  const movements: ExtractedMovement[] = filteredMovements.map(m => ({
    accountName: m.accountName,
    noteRef: m.noteRef,
    opening: m.opening,
    additions: m.additions,
    deductions: m.deductions,
    statedClosing: m.statedClosing,
    pageNumber: m.pageNumber,
  }))

  // Convert warnings
  const warnings: ExtractionWarning[] = toolResult.warnings.map(w => ({
    type: w.type as ExtractionWarning["type"],
    location: w.location,
    description: w.description,
    confidence: w.confidence,
    suggestedValue: w.suggestedValue,
    pageNumber: w.pageNumber,
  }))

  // Get balance sheet totals for preferred column
  const bsTotals = toolResult.balanceSheetTotals.find(bs => bs.columnSource === preferredColumn)

  // Build statement with totals if available
  const statements = bsTotals
    ? [
        {
          statementType: "SOFP" as const,
          title: "Statement of Financial Position",
          pageNumbers: bsTotals.pageNumber ? [bsTotals.pageNumber] : [],
          period: {
            current: toolResult.metadata?.financialYearEnd || "",
          },
          currency: toolResult.metadata?.reportingCurrency || "RM",
          sections: [],
          totalAssets: { current: bsTotals.totalAssets },
          totalLiabilities: { current: bsTotals.totalLiabilities },
          totalEquity: { current: bsTotals.totalEquity },
        },
      ]
    : []

  return {
    companyName: toolResult.metadata?.companyName || "Unknown",
    financialYearEnd: toolResult.metadata?.financialYearEnd || "",
    reportingCurrency: toolResult.metadata?.reportingCurrency || "RM",
    extractedAt: new Date().toISOString(),
    statements,
    movements,
    crossReferences,
    castingRelationships,
    warnings,
    overallConfidence: toolResult.completionInfo?.overallConfidence || 80,
  }
}

// ============================================================================
// HELPER: Retry logic with exponential backoff
// ============================================================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  log: (message: string, data?: unknown) => void = console.log
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const errorMessage = lastError.message

      if (
        (errorMessage.includes("429") ||
          errorMessage.includes("rate") ||
          errorMessage.includes("quota")) &&
        attempt < maxRetries
      ) {
        const waitTime = Math.pow(2, attempt) * 30000
        log(`Rate limit hit, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      } else {
        throw lastError
      }
    }
  }

  throw lastError
}
