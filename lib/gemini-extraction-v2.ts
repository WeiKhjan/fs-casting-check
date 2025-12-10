// ============================================================================
// GEMINI EXTRACTION V2 - Single-Call JSON with Column Awareness
// ============================================================================
// This approach uses a single API call with structured JSON output.
// The prompt explicitly instructs the model to identify columns first,
// then extract all data for the primary column (Group or Company current year).
// ============================================================================

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { ExtractionResult, ExtractedCastingRelationship, ExtractedMovement, ExtractedCrossReference, ExtractionWarning } from "./extraction-types"

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractionStats {
  inputTokens: number
  outputTokens: number
  toolCallsCount: number
  iterations: number
}

interface ColumnAwareExtractionResult {
  // Metadata
  companyName: string
  financialYearEnd: string
  reportingCurrency: string

  // Column identification
  columnStructure: {
    hasGroupColumns: boolean
    hasCompanyColumns: boolean
    primaryColumn: string // e.g., "Group 2025" or "2025"
    columnHeaders: string[]
  }

  // Balance sheet totals for primary column
  balanceSheetTotals: {
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
  }

  // All casting relationships for primary column
  castings: Array<{
    section: string
    totalLabel: string
    totalAmount: number
    components: Array<{
      label: string
      amount: number
      noteRef?: string
    }>
  }>

  // Cross-references for primary column
  crossReferences: Array<{
    noteRef: string
    noteDescription: string
    noteTotal: number
    statementLineItem: string
    statementAmount: number
    statementType: string
    isExpenseOrDeduction: boolean
  }>

  // Movement reconciliations
  movements: Array<{
    accountName: string
    noteRef?: string
    opening: number
    additions: Array<{ description: string; amount: number }>
    deductions: Array<{ description: string; amount: number }>
    statedClosing: number
  }>

  // Warnings
  warnings: Array<{
    type: string
    location: string
    description: string
    confidence: number
  }>

  overallConfidence: number
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

const EXTRACTION_PROMPT = `You are a financial data extraction assistant for Malaysian financial statements.

CRITICAL: COLUMN IDENTIFICATION FIRST
Financial statements often have multiple columns:
- Group/Consolidated columns (for parent companies with subsidiaries)
- Company columns (parent company standalone figures)
- Current year and Prior year for each

STEP 1: Identify which columns exist and extract data ONLY from the PRIMARY column:
- If Group columns exist: use "Group [Current Year]" as primary
- If only Company columns: use "Company [Current Year]" as primary
- If single entity: use "[Current Year]" as primary

STEP 2: Extract ALL data from the PRIMARY COLUMN ONLY
- Do NOT mix values from different columns
- A "-" or blank in the primary column means 0, not a value from another column

IMPORTANT NUMBER RULES:
- Remove commas: "1,234,567" → 1234567
- Brackets mean negative: "(500,000)" → -500000
- If header shows "RM'000", multiply all numbers by 1000
- Blank or "-" = 0

EXTRACT THESE CASTING RELATIONSHIPS (for primary column):

SOFP (Statement of Financial Position):
1. Non-Current Assets: [components] → Total Non-Current Assets
2. Current Assets: [components] → Total Current Assets
3. Total Assets: Total Non-Current Assets + Total Current Assets → Total Assets
4. Non-Current Liabilities: [components] → Total Non-Current Liabilities
5. Current Liabilities: [components] → Total Current Liabilities
6. Total Liabilities: Total Non-Current Liabilities + Total Current Liabilities → Total Liabilities
7. Equity: [components] → Total Equity

SOCI (Statement of Comprehensive Income):
8. Revenue breakdown if detailed
9. Cost of sales components
10. Operating expenses breakdown
11. Profit calculations

Return ONLY this JSON structure (no markdown):
{
  "companyName": "string",
  "financialYearEnd": "DD Month YYYY",
  "reportingCurrency": "RM",

  "columnStructure": {
    "hasGroupColumns": true/false,
    "hasCompanyColumns": true/false,
    "primaryColumn": "Group 2025" or "Company 2025" or "2025",
    "columnHeaders": ["Group 2025", "Group 2024", "Company 2025", "Company 2024"]
  },

  "balanceSheetTotals": {
    "totalAssets": number,
    "totalLiabilities": number,
    "totalEquity": number
  },

  "castings": [
    {
      "section": "SOFP - Non-Current Assets",
      "totalLabel": "TOTAL NON-CURRENT ASSETS",
      "totalAmount": number,
      "components": [
        {"label": "Plant and equipment", "amount": number, "noteRef": "5"},
        {"label": "Investment in subsidiaries", "amount": 0, "noteRef": "6"}
      ]
    }
  ],

  "crossReferences": [
    {
      "noteRef": "Note 5",
      "noteDescription": "Plant and Equipment",
      "noteTotal": number,
      "statementLineItem": "Plant and equipment",
      "statementAmount": number,
      "statementType": "SOFP",
      "isExpenseOrDeduction": false
    }
  ],

  "movements": [
    {
      "accountName": "Property, Plant and Equipment",
      "noteRef": "Note 5",
      "opening": number,
      "additions": [{"description": "Additions", "amount": number}],
      "deductions": [{"description": "Depreciation", "amount": number}],
      "statedClosing": number
    }
  ],

  "warnings": [
    {
      "type": "AMBIGUOUS_AMOUNT",
      "location": "Note 5",
      "description": "Amount unclear",
      "confidence": 70
    }
  ],

  "overallConfidence": 85
}

BE THOROUGH - Extract ALL casting relationships from SOFP and SOCI.
Remember: Only use values from the PRIMARY column. If a cell shows "-", use 0.`

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

export async function extractWithSingleCall(
  apiKey: string,
  pdfBase64: string,
  log: (message: string, data?: unknown) => void
): Promise<{ result: ExtractionResult; stats: ExtractionStats }> {
  const genAI = new GoogleGenerativeAI(apiKey)

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ]

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      maxOutputTokens: 65536,
      temperature: 0.1,
      // @ts-expect-error - thinkingConfig is valid but not typed
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings,
  })

  log("Starting single-call extraction with column awareness")

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "application/pdf",
        data: pdfBase64,
      },
    },
    { text: EXTRACTION_PROMPT },
  ])

  const response = result.response
  const usageMetadata = response.usageMetadata
  const inputTokens = usageMetadata?.promptTokenCount || 0
  const outputTokens = usageMetadata?.candidatesTokenCount || 0

  log("API call completed", { inputTokens, outputTokens })

  // Parse the response
  let text = ""
  try {
    text = response.text()
  } catch (e) {
    log("Error getting response text", e)
    const candidates = response.candidates
    if (candidates && candidates[0]?.content?.parts) {
      text = candidates[0].content.parts
        .filter((part: { text?: string }) => part.text)
        .map((part: { text?: string }) => part.text)
        .join("")
    }
  }

  log("Response length", text.length)

  // Parse JSON
  const extraction = parseExtractionJson(text)

  if (!extraction) {
    throw new Error("Failed to parse extraction JSON")
  }

  log("Extraction parsed", {
    companyName: extraction.companyName,
    primaryColumn: extraction.columnStructure.primaryColumn,
    castingsCount: extraction.castings.length,
    crossRefsCount: extraction.crossReferences.length,
    movementsCount: extraction.movements.length,
  })

  // Convert to standard ExtractionResult format
  const standardResult = convertToStandardFormat(extraction)

  return {
    result: standardResult,
    stats: {
      inputTokens,
      outputTokens,
      toolCallsCount: 0,
      iterations: 1,
    },
  }
}

// ============================================================================
// JSON PARSING
// ============================================================================

function parseExtractionJson(text: string): ColumnAwareExtractionResult | null {
  let jsonStr = text.trim()

  // Remove markdown code blocks
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7)
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3)
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3)
  }
  jsonStr = jsonStr.trim()

  // Find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    jsonStr = jsonMatch[0]
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Ensure required fields exist
    parsed.castings = parsed.castings || []
    parsed.crossReferences = parsed.crossReferences || []
    parsed.movements = parsed.movements || []
    parsed.warnings = parsed.warnings || []
    parsed.columnStructure = parsed.columnStructure || {
      hasGroupColumns: false,
      hasCompanyColumns: true,
      primaryColumn: "current",
      columnHeaders: []
    }
    parsed.balanceSheetTotals = parsed.balanceSheetTotals || {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0
    }

    return parsed as ColumnAwareExtractionResult
  } catch (e) {
    console.error("JSON parse error:", e)
    return null
  }
}

// ============================================================================
// CONVERT TO STANDARD FORMAT
// ============================================================================

function convertToStandardFormat(extraction: ColumnAwareExtractionResult): ExtractionResult {
  const columnSource = extraction.columnStructure.primaryColumn

  // Convert castings
  const castingRelationships: ExtractedCastingRelationship[] = extraction.castings.map(c => ({
    totalLabel: c.totalLabel,
    totalAmount: c.totalAmount,
    componentLabels: c.components.map(comp => comp.label),
    componentAmounts: c.components.map(comp => comp.amount),
    section: `${c.section} (${columnSource})`,
  }))

  // Convert cross-references
  const crossReferences: ExtractedCrossReference[] = extraction.crossReferences.map(cr => ({
    noteRef: cr.noteRef,
    noteDescription: cr.noteDescription,
    noteTotal: cr.noteTotal,
    statementLineItem: cr.statementLineItem,
    statementAmount: cr.statementAmount,
    statementType: cr.statementType as "SOFP" | "SOCI" | "SOCE" | "SCF" | "NOTE",
    isExpenseOrDeduction: cr.isExpenseOrDeduction,
  }))

  // Convert movements
  const movements: ExtractedMovement[] = extraction.movements.map(m => ({
    accountName: m.accountName,
    noteRef: m.noteRef,
    opening: m.opening,
    additions: m.additions,
    deductions: m.deductions,
    statedClosing: m.statedClosing,
  }))

  // Convert warnings
  const warnings: ExtractionWarning[] = extraction.warnings.map(w => ({
    type: w.type as ExtractionWarning["type"],
    location: w.location,
    description: w.description,
    confidence: w.confidence,
  }))

  // Build statements array
  const statements = [{
    statementType: "SOFP" as const,
    title: "Statement of Financial Position",
    pageNumbers: [],
    period: {
      current: extraction.financialYearEnd,
    },
    currency: extraction.reportingCurrency,
    sections: [],
    totalAssets: { current: extraction.balanceSheetTotals.totalAssets },
    totalLiabilities: { current: extraction.balanceSheetTotals.totalLiabilities },
    totalEquity: { current: extraction.balanceSheetTotals.totalEquity },
  }]

  return {
    companyName: extraction.companyName,
    financialYearEnd: extraction.financialYearEnd,
    reportingCurrency: extraction.reportingCurrency,
    extractedAt: new Date().toISOString(),
    statements,
    movements,
    crossReferences,
    castingRelationships,
    warnings,
    overallConfidence: extraction.overallConfidence,
  }
}

// ============================================================================
// RETRY HELPER
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
