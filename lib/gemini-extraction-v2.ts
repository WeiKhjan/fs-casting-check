// ============================================================================
// GEMINI EXTRACTION V2 - Single-Call JSON with ALL Columns
// ============================================================================
// This approach uses a single API call with structured JSON output.
// Extracts casting relationships for ALL columns (Group/Company × Current/Prior)
// to enable comprehensive verification across all financial statement columns.
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
    columns: string[] // e.g., ["group_current", "group_prior", "company_current", "company_prior"]
  }

  // Balance sheet totals for EACH column
  balanceSheetTotals: Array<{
    column: string // e.g., "group_current"
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
  }>

  // All casting relationships for ALL columns
  castings: Array<{
    column: string // e.g., "group_current", "company_prior"
    section: string
    totalLabel: string
    totalAmount: number
    components: Array<{
      label: string
      amount: number
      noteRef?: string
    }>
  }>

  // Cross-references (note totals matched to statement line items)
  crossReferences: Array<{
    column: string
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

CRITICAL: EXTRACT DATA FOR ALL COLUMNS
Financial statements typically have multiple columns that ALL need to be verified:
- Group/Consolidated columns (for parent companies with subsidiaries)
- Company columns (parent company standalone figures)
- Current year AND Prior year for each

Use these column identifiers:
- "group_current" = Group/Consolidated Current Year
- "group_prior" = Group/Consolidated Prior Year
- "company_current" = Company Current Year
- "company_prior" = Company Prior Year
- If no Group/Company distinction: use "current" and "prior"

IMPORTANT: Extract SEPARATE casting entries for EACH column. Do NOT mix values between columns.
A "-" or blank = 0 for that specific column.

NUMBER RULES:
- Remove commas: "1,234,567" → 1234567
- Brackets mean negative: "(500,000)" → -500000
- If header shows "RM'000", multiply all numbers by 1000
- Blank or "-" = 0

EXTRACT THESE CASTING RELATIONSHIPS FOR EACH COLUMN:

SOFP (Statement of Financial Position) - 7 castings per column:
1. Non-Current Assets: [components] → Total Non-Current Assets
2. Current Assets: [components] → Total Current Assets
3. Total Assets: Total Non-Current Assets + Total Current Assets → Total Assets
4. Non-Current Liabilities: [components] → Total Non-Current Liabilities
5. Current Liabilities: [components] → Total Current Liabilities
6. Total Liabilities: Total Non-Current Liabilities + Total Current Liabilities → Total Liabilities
7. Equity: [components] → Total Equity

SOCI (Statement of Comprehensive Income) - per column:
8. Gross profit: Revenue - Cost of sales
9. Operating profit calculations
10. Profit before tax breakdown
11. Profit for the year

Return ONLY this JSON structure (no markdown):
{
  "companyName": "string",
  "financialYearEnd": "DD Month YYYY",
  "reportingCurrency": "RM",

  "columnStructure": {
    "hasGroupColumns": true,
    "hasCompanyColumns": true,
    "columns": ["group_current", "group_prior", "company_current", "company_prior"]
  },

  "balanceSheetTotals": [
    {"column": "group_current", "totalAssets": 123456, "totalLiabilities": 78901, "totalEquity": 44555},
    {"column": "group_prior", "totalAssets": 100000, "totalLiabilities": 60000, "totalEquity": 40000},
    {"column": "company_current", "totalAssets": 90000, "totalLiabilities": 50000, "totalEquity": 40000},
    {"column": "company_prior", "totalAssets": 80000, "totalLiabilities": 45000, "totalEquity": 35000}
  ],

  "castings": [
    {
      "column": "group_current",
      "section": "SOFP - Non-Current Assets",
      "totalLabel": "TOTAL NON-CURRENT ASSETS",
      "totalAmount": 83864,
      "components": [
        {"label": "Plant and equipment", "amount": 41550, "noteRef": "5"},
        {"label": "Investment in subsidiaries", "amount": 0, "noteRef": "6"},
        {"label": "Goodwill on consolidation", "amount": 42314, "noteRef": "7"}
      ]
    },
    {
      "column": "group_prior",
      "section": "SOFP - Non-Current Assets",
      "totalLabel": "TOTAL NON-CURRENT ASSETS",
      "totalAmount": 75000,
      "components": [
        {"label": "Plant and equipment", "amount": 35000, "noteRef": "5"},
        {"label": "Investment in subsidiaries", "amount": 0, "noteRef": "6"},
        {"label": "Goodwill on consolidation", "amount": 40000, "noteRef": "7"}
      ]
    },
    {
      "column": "company_current",
      "section": "SOFP - Non-Current Assets",
      "totalLabel": "TOTAL NON-CURRENT ASSETS",
      "totalAmount": 680650,
      "components": [
        {"label": "Plant and equipment", "amount": 41550, "noteRef": "5"},
        {"label": "Investment in subsidiaries", "amount": 639100, "noteRef": "6"},
        {"label": "Goodwill on consolidation", "amount": 0, "noteRef": "7"}
      ]
    }
  ],

  "crossReferences": [
    {
      "column": "group_current",
      "noteRef": "Note 5",
      "noteDescription": "Plant and Equipment - Net Book Value",
      "noteTotal": 41550,
      "statementLineItem": "Plant and equipment",
      "statementAmount": 41550,
      "statementType": "SOFP",
      "isExpenseOrDeduction": false
    },
    {
      "column": "company_current",
      "noteRef": "Note 13",
      "noteDescription": "Borrowings - Non-current portion",
      "noteTotal": 322755,
      "statementLineItem": "Borrowings (non-current)",
      "statementAmount": 322755,
      "statementType": "SOFP",
      "isExpenseOrDeduction": false
    },
    {
      "column": "company_current",
      "noteRef": "Note 13",
      "noteDescription": "Borrowings - Current portion",
      "noteTotal": 32057,
      "statementLineItem": "Borrowings (current)",
      "statementAmount": 32057,
      "statementType": "SOFP",
      "isExpenseOrDeduction": false
    }
  ],

  "movements": [
    {
      "accountName": "Property, Plant and Equipment",
      "noteRef": "Note 5",
      "opening": 35000,
      "additions": [{"description": "Additions", "amount": 10000}],
      "deductions": [{"description": "Depreciation", "amount": 3450}],
      "statedClosing": 41550
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

BE THOROUGH:
- Extract ALL 7 SOFP castings for EACH column (up to 28 total if 4 columns)
- Extract SOCI castings for each column
- Keep column values SEPARATE - never mix Group and Company values
- If a column shows "-" for a line item, use 0 for that column

CROSS-REFERENCE RULES:
- Match note SUB-TOTALS to statement line items, not grand totals
- For Borrowings notes: match "Current" sub-total to current borrowings, "Non-current" sub-total to non-current borrowings
- For PPE notes: match the "Net Book Value" or closing balance to the statement amount
- For notes with Current/Non-current splits: create SEPARATE cross-references for each
- noteTotal = the amount shown in the NOTE that should match the statement
- statementAmount = the amount shown on SOFP/SOCI for that line item`

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
    columns: extraction.columnStructure.columns,
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
      columns: ["current"]
    }
    parsed.balanceSheetTotals = parsed.balanceSheetTotals || []

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
  // Convert ALL castings from ALL columns - include column in section name
  const castingRelationships: ExtractedCastingRelationship[] = extraction.castings.map(c => ({
    totalLabel: c.totalLabel,
    totalAmount: c.totalAmount,
    componentLabels: c.components.map(comp => comp.label),
    componentAmounts: c.components.map(comp => comp.amount),
    section: `${c.section} (${c.column})`,
  }))

  // Convert ALL cross-references from ALL columns
  const crossReferences: ExtractedCrossReference[] = extraction.crossReferences.map(cr => ({
    noteRef: cr.noteRef,
    noteDescription: `${cr.noteDescription} (${cr.column})`,
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

  // Get balance sheet totals - prefer group_current, then company_current, then first available
  const bsTotals = extraction.balanceSheetTotals.find(bs => bs.column === 'group_current')
    || extraction.balanceSheetTotals.find(bs => bs.column === 'company_current')
    || extraction.balanceSheetTotals.find(bs => bs.column === 'current')
    || extraction.balanceSheetTotals[0]

  // Build statements array with balance sheet totals
  const statements = bsTotals ? [{
    statementType: "SOFP" as const,
    title: "Statement of Financial Position",
    pageNumbers: [],
    period: {
      current: extraction.financialYearEnd,
    },
    currency: extraction.reportingCurrency,
    sections: [],
    totalAssets: { current: bsTotals.totalAssets },
    totalLiabilities: { current: bsTotals.totalLiabilities },
    totalEquity: { current: bsTotals.totalEquity },
  }] : []

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
