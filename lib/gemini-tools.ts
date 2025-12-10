// ============================================================================
// GEMINI FUNCTION CALLING TOOLS - Column-Aware Extraction
// ============================================================================
// Uses Gemini's function calling to extract financial data with explicit
// column context (Group vs Company, Current vs Prior year).
// This prevents column mixing errors that occur with free-form extraction.
// ============================================================================

import { FunctionDeclaration, SchemaType } from "@google/generative-ai"

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/**
 * Tool to identify the column structure of the financial statement
 */
export const identifyColumnsTool: FunctionDeclaration = {
  name: "identify_columns",
  description: `Identify the column structure of this financial statement.
  Financial statements can have different column layouts:
  - Group/Consolidated and Company/Separate columns (for parent companies with subsidiaries)
  - Only Company columns (for standalone companies)
  - Current year and Prior year columns
  Call this function FIRST to establish the column structure before extracting any values.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      hasGroupColumns: {
        type: SchemaType.BOOLEAN,
        description: "True if the statement has Group/Consolidated columns (typically for parent companies)"
      },
      hasCompanyColumns: {
        type: SchemaType.BOOLEAN,
        description: "True if the statement has separate Company columns (parent company standalone figures)"
      },
      columnOrder: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "Column headers from left to right, e.g. ['Group 2025', 'Group 2024', 'Company 2025', 'Company 2024'] or ['2025 RM', '2024 RM']"
      },
      currentYear: {
        type: SchemaType.STRING,
        description: "The current year shown, e.g. '2025' or '2024'"
      },
      priorYear: {
        type: SchemaType.STRING,
        description: "The prior year shown, e.g. '2024' or '2023'"
      },
      currency: {
        type: SchemaType.STRING,
        description: "Currency used, e.g. 'RM', 'MYR', 'USD'"
      },
      currencyMultiplier: {
        type: SchemaType.NUMBER,
        description: "Multiplier if amounts are in thousands/millions. 1000 if header shows RM'000, 1000000 if RM'mil, 1 otherwise"
      }
    },
    required: ["hasGroupColumns", "hasCompanyColumns", "columnOrder", "currentYear", "currency", "currencyMultiplier"]
  }
}

/**
 * Tool to extract a casting relationship with explicit column context
 */
export const extractCastingTool: FunctionDeclaration = {
  name: "extract_casting",
  description: `Extract a casting relationship (items that should add up to a total).
  CRITICAL: You must specify WHICH COLUMN each value comes from.
  - For Group columns: use columnSource = "group_current" or "group_prior"
  - For Company columns: use columnSource = "company_current" or "company_prior"
  - For single-entity statements: use columnSource = "current" or "prior"

  DO NOT MIX VALUES FROM DIFFERENT COLUMN SOURCES IN THE SAME CASTING.
  Each casting should be for ONE specific column (e.g., all Group 2025 values).`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      section: {
        type: SchemaType.STRING,
        description: "Section name, e.g. 'SOFP - Non-Current Assets', 'SOCI - Operating Expenses'"
      },
      columnSource: {
        type: SchemaType.STRING,
        description: "Which column these values come from: 'group_current', 'group_prior', 'company_current', 'company_prior', 'current', or 'prior'"
      },
      totalLabel: {
        type: SchemaType.STRING,
        description: "The label of the total/subtotal line, exactly as shown in document"
      },
      totalAmount: {
        type: SchemaType.NUMBER,
        description: "The stated total amount from the SAME column as components. Brackets = negative."
      },
      components: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            label: {
              type: SchemaType.STRING,
              description: "Component label exactly as shown"
            },
            amount: {
              type: SchemaType.NUMBER,
              description: "Component amount. Use 0 for '-' or blank. Brackets = negative."
            },
            noteRef: {
              type: SchemaType.STRING,
              description: "Note reference if any, e.g. 'Note 5' or '5'"
            }
          },
          required: ["label", "amount"]
        },
        description: "All component line items that should add up to the total"
      },
      pageNumber: {
        type: SchemaType.NUMBER,
        description: "Page number where this appears"
      }
    },
    required: ["section", "columnSource", "totalLabel", "totalAmount", "components"]
  }
}

/**
 * Tool to extract cross-reference between note and statement
 */
export const extractCrossReferenceTool: FunctionDeclaration = {
  name: "extract_cross_reference",
  description: `Extract a cross-reference between a note disclosure and a statement line item.
  CRITICAL: Match values from the SAME COLUMN.
  - If extracting Group figures, use note total for Group and statement amount for Group
  - If extracting Company figures, use note total for Company and statement amount for Company

  For expenses/costs: Notes typically show positive amounts, statements show in brackets (negative).
  Set isExpenseOrDeduction=true for these items.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      noteRef: {
        type: SchemaType.STRING,
        description: "Note reference, e.g. 'Note 8'"
      },
      noteDescription: {
        type: SchemaType.STRING,
        description: "Description of what the note covers"
      },
      columnSource: {
        type: SchemaType.STRING,
        description: "Which column set this cross-reference is for: 'group_current', 'group_prior', 'company_current', 'company_prior', 'current', or 'prior'"
      },
      noteTotal: {
        type: SchemaType.NUMBER,
        description: "The total amount shown in the note (usually positive for expenses)"
      },
      statementLineItem: {
        type: SchemaType.STRING,
        description: "The corresponding line item label in the statement"
      },
      statementAmount: {
        type: SchemaType.NUMBER,
        description: "Amount shown in the statement for the SAME column. Brackets = negative."
      },
      statementType: {
        type: SchemaType.STRING,
        description: "Which statement: 'SOFP', 'SOCI', 'SCF', 'SOCE'"
      },
      isExpenseOrDeduction: {
        type: SchemaType.BOOLEAN,
        description: "True if this is an expense/cost item (explains sign differences)"
      },
      mappingConfidence: {
        type: SchemaType.NUMBER,
        description: "0-100 confidence that this is the correct mapping"
      },
      mappingType: {
        type: SchemaType.STRING,
        description: "Type of mapping: 'total_to_total' (preferred), 'component_to_component', 'component_to_total' (usually wrong), 'uncertain'"
      }
    },
    required: ["noteRef", "noteDescription", "columnSource", "noteTotal", "statementLineItem", "statementAmount", "statementType", "isExpenseOrDeduction", "mappingConfidence", "mappingType"]
  }
}

/**
 * Tool to extract movement reconciliation
 */
export const extractMovementTool: FunctionDeclaration = {
  name: "extract_movement",
  description: `Extract a movement/reconciliation table (opening + additions - deductions = closing).
  These are typically found in notes for PPE, intangibles, receivables, etc.
  All values should be from the same column context.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      accountName: {
        type: SchemaType.STRING,
        description: "Account name, e.g. 'Property, Plant and Equipment'"
      },
      noteRef: {
        type: SchemaType.STRING,
        description: "Note reference if applicable"
      },
      columnSource: {
        type: SchemaType.STRING,
        description: "Which column: 'group_current', 'company_current', 'current', etc."
      },
      opening: {
        type: SchemaType.NUMBER,
        description: "Opening balance"
      },
      additions: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            description: { type: SchemaType.STRING },
            amount: { type: SchemaType.NUMBER }
          },
          required: ["description", "amount"]
        },
        description: "All additions during the period"
      },
      deductions: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            description: { type: SchemaType.STRING },
            amount: { type: SchemaType.NUMBER }
          },
          required: ["description", "amount"]
        },
        description: "All deductions/disposals/depreciation during the period (as positive numbers)"
      },
      statedClosing: {
        type: SchemaType.NUMBER,
        description: "The closing balance as stated in the document"
      },
      pageNumber: {
        type: SchemaType.NUMBER,
        description: "Page number"
      }
    },
    required: ["accountName", "columnSource", "opening", "additions", "deductions", "statedClosing"]
  }
}

/**
 * Tool to extract company metadata
 */
export const extractMetadataTool: FunctionDeclaration = {
  name: "extract_metadata",
  description: "Extract basic metadata about the financial statements",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      companyName: {
        type: SchemaType.STRING,
        description: "Full company name as shown in the document"
      },
      financialYearEnd: {
        type: SchemaType.STRING,
        description: "Financial year end date, e.g. '30 April 2025'"
      },
      reportingCurrency: {
        type: SchemaType.STRING,
        description: "Reporting currency, e.g. 'RM', 'MYR'"
      },
      isGroupStatement: {
        type: SchemaType.BOOLEAN,
        description: "True if these are consolidated/group financial statements"
      }
    },
    required: ["companyName", "financialYearEnd", "reportingCurrency"]
  }
}

/**
 * Tool to extract balance sheet totals
 */
export const extractBalanceSheetTotalsTool: FunctionDeclaration = {
  name: "extract_balance_sheet_totals",
  description: `Extract the key balance sheet totals for verification.
  Extract for EACH column separately (Group current, Group prior, Company current, Company prior).
  Call this function once per column that exists.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      columnSource: {
        type: SchemaType.STRING,
        description: "Which column: 'group_current', 'group_prior', 'company_current', 'company_prior', 'current', or 'prior'"
      },
      totalAssets: {
        type: SchemaType.NUMBER,
        description: "Total Assets figure"
      },
      totalLiabilities: {
        type: SchemaType.NUMBER,
        description: "Total Liabilities figure"
      },
      totalEquity: {
        type: SchemaType.NUMBER,
        description: "Total Equity figure"
      },
      pageNumber: {
        type: SchemaType.NUMBER,
        description: "Page number of SOFP"
      }
    },
    required: ["columnSource", "totalAssets", "totalLiabilities", "totalEquity"]
  }
}

/**
 * Tool to flag warnings/uncertainties
 */
export const flagWarningTool: FunctionDeclaration = {
  name: "flag_warning",
  description: "Flag any ambiguous amounts, unclear relationships, or extraction uncertainties",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      type: {
        type: SchemaType.STRING,
        description: "Warning type: 'AMBIGUOUS_AMOUNT', 'UNCLEAR_RELATIONSHIP', 'POSSIBLE_OCR_ERROR', 'MISSING_DATA', 'CONFLICTING_VALUES'"
      },
      location: {
        type: SchemaType.STRING,
        description: "Where in the document"
      },
      description: {
        type: SchemaType.STRING,
        description: "What the issue is"
      },
      confidence: {
        type: SchemaType.NUMBER,
        description: "0-100 confidence in the extraction"
      },
      suggestedValue: {
        type: SchemaType.NUMBER,
        description: "Best guess if applicable"
      },
      pageNumber: {
        type: SchemaType.NUMBER,
        description: "Page number"
      }
    },
    required: ["type", "location", "description", "confidence"]
  }
}

/**
 * Tool to signal extraction is complete
 */
export const extractionCompleteTool: FunctionDeclaration = {
  name: "extraction_complete",
  description: "Call this when you have finished extracting all data from the document",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      totalCastingsExtracted: {
        type: SchemaType.NUMBER,
        description: "Number of casting relationships extracted"
      },
      totalCrossReferencesExtracted: {
        type: SchemaType.NUMBER,
        description: "Number of cross-references extracted"
      },
      totalMovementsExtracted: {
        type: SchemaType.NUMBER,
        description: "Number of movement reconciliations extracted"
      },
      overallConfidence: {
        type: SchemaType.NUMBER,
        description: "0-100 overall confidence in the extraction"
      },
      notes: {
        type: SchemaType.STRING,
        description: "Any notes about the extraction"
      }
    },
    required: ["totalCastingsExtracted", "totalCrossReferencesExtracted", "totalMovementsExtracted", "overallConfidence"]
  }
}

// ============================================================================
// ALL TOOLS ARRAY
// ============================================================================

export const ALL_EXTRACTION_TOOLS: FunctionDeclaration[] = [
  identifyColumnsTool,
  extractMetadataTool,
  extractBalanceSheetTotalsTool,
  extractCastingTool,
  extractCrossReferenceTool,
  extractMovementTool,
  flagWarningTool,
  extractionCompleteTool,
]

// ============================================================================
// EXTRACTION PROMPT FOR TOOL CALLING
// ============================================================================

export const TOOL_CALLING_PROMPT = `You are a financial data extraction assistant. Your task is to extract data from this Malaysian financial statement using the provided tools.

CRITICAL RULES:

1. COLUMN AWARENESS IS ESSENTIAL
   - Financial statements often have multiple columns: Group (consolidated) and Company (standalone)
   - FIRST call identify_columns to understand the column structure
   - When extracting values, ALWAYS use the correct columnSource
   - NEVER mix values from different columns in the same extraction

2. CALL TOOLS IN THIS ORDER:
   a) identify_columns - to understand the column structure
   b) extract_metadata - company name, year end, currency
   c) extract_balance_sheet_totals - for EACH column (group_current, group_prior, company_current, company_prior)
   d) extract_casting - for EACH subtotal/total relationship in EACH column
   e) extract_cross_reference - for note-to-statement links
   f) extract_movement - for movement tables in notes
   g) flag_warning - for any uncertainties
   h) extraction_complete - when done

3. EXTRACTING CASTING RELATIONSHIPS
   - For each section total, identify what items add up to it
   - Create SEPARATE casting calls for each column (Group 2025, Group 2024, Company 2025, Company 2024)
   - If a line shows "-" or is blank, use 0 as the amount
   - Example: Total Non-Current Assets for Group 2025 column:
     * Extract ALL components from Group 2025 column only
     * Extract the total from Group 2025 column only

4. NUMBER HANDLING
   - Remove commas: "1,234,567" → 1234567
   - Brackets mean negative: "(500,000)" → -500000
   - Apply currency multiplier if header shows RM'000 or RM'mil
   - Blank or "-" = 0

5. BE THOROUGH
   - Extract ALL casting relationships for ALL columns
   - Extract ALL cross-references
   - Extract ALL movement tables
   - Flag ANY uncertainties

Start by calling identify_columns, then proceed systematically through the document.`

// ============================================================================
// TYPE DEFINITIONS FOR TOOL CALL RESULTS
// ============================================================================

export interface ColumnIdentification {
  hasGroupColumns: boolean
  hasCompanyColumns: boolean
  columnOrder: string[]
  currentYear: string
  priorYear?: string
  currency: string
  currencyMultiplier: number
}

export interface ExtractedCastingWithColumn {
  section: string
  columnSource: string
  totalLabel: string
  totalAmount: number
  components: Array<{
    label: string
    amount: number
    noteRef?: string
  }>
  pageNumber?: number
}

export interface ExtractedCrossReferenceWithColumn {
  noteRef: string
  noteDescription: string
  columnSource: string
  noteTotal: number
  statementLineItem: string
  statementAmount: number
  statementType: string
  isExpenseOrDeduction: boolean
  mappingConfidence: number
  mappingType: string
}

export interface ExtractedMovementWithColumn {
  accountName: string
  noteRef?: string
  columnSource: string
  opening: number
  additions: Array<{ description: string; amount: number }>
  deductions: Array<{ description: string; amount: number }>
  statedClosing: number
  pageNumber?: number
}

export interface ExtractedBalanceSheetTotals {
  columnSource: string
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  pageNumber?: number
}

export interface ExtractedWarning {
  type: string
  location: string
  description: string
  confidence: number
  suggestedValue?: number
  pageNumber?: number
}

export interface ExtractedMetadata {
  companyName: string
  financialYearEnd: string
  reportingCurrency: string
  isGroupStatement?: boolean
}

export interface ExtractionCompletionInfo {
  totalCastingsExtracted: number
  totalCrossReferencesExtracted: number
  totalMovementsExtracted: number
  overallConfidence: number
  notes?: string
}

export interface ToolCallExtractionResult {
  metadata: ExtractedMetadata | null
  columns: ColumnIdentification | null
  balanceSheetTotals: ExtractedBalanceSheetTotals[]
  castings: ExtractedCastingWithColumn[]
  crossReferences: ExtractedCrossReferenceWithColumn[]
  movements: ExtractedMovementWithColumn[]
  warnings: ExtractedWarning[]
  completionInfo: ExtractionCompletionInfo | null
}
