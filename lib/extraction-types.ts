// ============================================================================
// EXTRACTION TYPES - Data structures for LLM extraction output
// ============================================================================
// The LLM extracts data into these structures. Code then verifies the math.
// This separation ensures 100% accurate arithmetic (code) while leveraging
// LLM's strength (document understanding and data extraction).
// ============================================================================

/**
 * Statement types commonly found in Malaysian financial statements
 */
export type StatementType =
  | 'SOFP'  // Statement of Financial Position (Balance Sheet)
  | 'SOCI'  // Statement of Comprehensive Income
  | 'SOCE'  // Statement of Changes in Equity
  | 'SCF'   // Statement of Cash Flows
  | 'NOTE'  // Notes to Financial Statements

/**
 * A monetary amount with current and optionally prior year values
 */
export interface AmountPair {
  current: number      // Current year amount (always as number, no formatting)
  prior?: number       // Prior year amount if available
}

/**
 * A single line item extracted from the financial statements
 */
export interface ExtractedLineItem {
  label: string                    // The label/description as shown in document
  noteRef?: string                 // Note reference (e.g., "Note 5", "5")
  current: number                  // Current year amount (negative if in brackets)
  prior?: number                   // Prior year amount if shown
  isSubtotal: boolean              // True if this is a subtotal line
  isTotal: boolean                 // True if this is a total line
  indent?: number                  // Indentation level (0 = top level)
  pageNumber?: number              // Page where this was found
}

/**
 * A section within a statement (e.g., "Non-Current Assets", "Current Liabilities")
 */
export interface ExtractedSection {
  name: string                     // Section name
  items: ExtractedLineItem[]       // Line items in this section
  subtotal?: AmountPair            // Section subtotal if present
}

/**
 * A complete extracted financial statement
 */
export interface ExtractedStatement {
  statementType: StatementType
  title: string                    // Full title as shown in document
  pageNumbers: number[]            // Pages where this statement appears
  period: {
    current: string                // e.g., "31 December 2024"
    prior?: string                 // e.g., "31 December 2023"
  }
  currency: string                 // e.g., "RM", "MYR"
  sections: ExtractedSection[]

  // For SOFP specifically
  totalAssets?: AmountPair
  totalLiabilities?: AmountPair
  totalEquity?: AmountPair

  // For SOCI specifically
  revenue?: AmountPair
  profitBeforeTax?: AmountPair
  profitAfterTax?: AmountPair
  totalComprehensiveIncome?: AmountPair
}

/**
 * Movement reconciliation data (e.g., PPE movements, equity movements)
 */
export interface ExtractedMovement {
  accountName: string              // e.g., "Property, Plant and Equipment"
  noteRef?: string
  opening: number                  // Opening balance
  additions: Array<{
    description: string
    amount: number
  }>
  deductions: Array<{
    description: string
    amount: number                 // Positive number (will be subtracted)
  }>
  statedClosing: number           // Closing balance as stated in document
  pageNumber?: number
}

/**
 * Cross-reference relationship between a note and statement line
 */
export interface ExtractedCrossReference {
  noteRef: string                  // e.g., "Note 8"
  noteDescription: string          // e.g., "Other Receivables"
  noteTotal: number                // Total per the note (always positive as shown in note)
  statementLineItem: string        // Corresponding line item label in SOFP/SOCI
  statementAmount: number          // Amount per the statement (negative if in brackets)
  statementType: StatementType     // Which statement this relates to
  pageNumberNote?: number
  pageNumberStatement?: number

  // Sign convention handling for expenses
  isExpenseOrDeduction?: boolean   // True if this is an expense/cost/deduction item
  signConventionNote?: 'positive' | 'negative'      // How the note presents it
  signConventionStatement?: 'positive' | 'negative' // How the statement presents it (brackets = negative)

  // Mapping confidence
  mappingConfidence?: number       // 0-100: How confident LLM is this is the right mapping
  mappingType?: 'total_to_total' | 'component_to_component' | 'component_to_total' | 'uncertain'
}

/**
 * A casting relationship - what items should add up to what total
 */
export interface ExtractedCastingRelationship {
  totalLabel: string               // The label of the total/subtotal
  totalAmount: number              // The stated total amount
  componentLabels: string[]        // Labels of items that should add up
  componentAmounts: number[]       // Amounts of those items
  section: string                  // Which section/statement this is from
  pageNumber?: number
}

/**
 * Items flagged as ambiguous or requiring human review
 */
export interface ExtractionWarning {
  type: 'AMBIGUOUS_AMOUNT' | 'UNCLEAR_RELATIONSHIP' | 'POSSIBLE_OCR_ERROR' | 'MISSING_DATA' | 'CONFLICTING_VALUES'
  location: string                 // Where in the document
  description: string              // What the issue is
  confidence: number               // 0-100 confidence in extraction
  suggestedValue?: number          // Best guess if any
  pageNumber?: number
}

/**
 * Complete extraction result from a financial statement document
 */
export interface ExtractionResult {
  // Metadata
  companyName: string
  financialYearEnd: string
  reportingCurrency: string
  extractedAt: string              // ISO timestamp

  // Extracted statements
  statements: ExtractedStatement[]

  // Movement reconciliations found in notes
  movements: ExtractedMovement[]

  // Cross-reference relationships
  crossReferences: ExtractedCrossReference[]

  // Casting relationships (what adds up to what)
  castingRelationships: ExtractedCastingRelationship[]

  // Warnings and items needing human review
  warnings: ExtractionWarning[]

  // Raw extraction confidence
  overallConfidence: number        // 0-100
}

// ============================================================================
// VERIFICATION RESULT TYPES - Output from code-based verification
// ============================================================================

export type VerificationStatus = 'pass' | 'fail' | 'warning' | 'needs_review'

/**
 * Result of a single casting verification
 */
export interface CastingVerificationResult {
  id: string                       // Unique ID for this check
  checkType: 'vertical' | 'horizontal' | 'cross_reference' | 'balance_equation'
  section: string                  // What was checked
  description: string              // Human-readable description

  // The calculation
  components: Array<{
    label: string
    amount: number
  }>
  calculatedTotal: number          // Sum computed by code
  statedTotal: number              // Total as stated in document

  // Result
  variance: number                 // Absolute difference
  variancePercentage: number       // As percentage of stated total
  status: VerificationStatus

  // Audit trail
  verifiedBy: 'code'               // Always 'code' - never 'llm'
  timestamp: string
}

/**
 * Result of balance sheet equation verification
 */
export interface BalanceSheetVerificationResult {
  id: string
  checkType: 'balance_equation'

  totalAssets: number
  totalLiabilities: number
  totalEquity: number

  // Assets should equal Liabilities + Equity
  calculatedLiabilitiesPlusEquity: number
  variance: number
  status: VerificationStatus

  verifiedBy: 'code'
  timestamp: string
}

/**
 * Result of movement reconciliation verification
 */
export interface MovementVerificationResult {
  id: string
  checkType: 'horizontal'
  accountName: string

  opening: number
  totalAdditions: number
  totalDeductions: number
  calculatedClosing: number
  statedClosing: number

  variance: number
  status: VerificationStatus

  verifiedBy: 'code'
  timestamp: string
}

/**
 * Result of cross-reference verification
 */
export interface CrossReferenceVerificationResult {
  id: string
  checkType: 'cross_reference'
  noteRef: string
  noteDescription: string

  noteAmount: number
  statementAmount: number

  variance: number
  status: VerificationStatus

  // Sign-aware comparison results
  isSignDifferenceOnly?: boolean     // True if amounts match but signs differ (expense convention)
  absoluteVariance?: number          // Variance when comparing absolute values
  signExplanation?: string           // Explanation of why signs differ

  // Mapping quality indicators
  mappingConfidence?: number         // From LLM extraction
  mappingType?: string               // From LLM extraction
  isPossibleWrongMapping?: boolean   // True if variance suggests wrong mapping

  verifiedBy: 'code'
  timestamp: string
}

/**
 * Exception/issue found during verification
 */
export interface VerificationException {
  id: number
  type: 'Casting Error' | 'Cross Reference Mismatch' | 'Balance Sheet Imbalance' | 'Movement Reconciliation Error' | 'Requires Human Review'
  location: string
  description: string
  statedAmount: number
  calculatedAmount: number
  difference: number
  severity: 'high' | 'medium' | 'low'
  recommendation: string
  relatedCheckId: string           // Links to the verification result
}

/**
 * Complete verification result
 */
export interface VerificationResult {
  // Summary KPIs
  kpi: {
    totalChecks: number
    passed: number
    failed: number
    warnings: number
    needsReview: number
    passRate: number               // Percentage
    exceptionsCount: number
    highSeverity: number
    mediumSeverity: number
    lowSeverity: number
  }

  // Detailed results
  castingResults: CastingVerificationResult[]
  balanceSheetResult?: BalanceSheetVerificationResult
  movementResults: MovementVerificationResult[]
  crossReferenceResults: CrossReferenceVerificationResult[]

  // Exceptions found
  exceptions: VerificationException[]

  // Human review items
  needsHumanReview: ExtractionWarning[]

  // Audit conclusion
  conclusionSummary: string
  conclusionItems: Array<{
    priority: 'high' | 'medium' | 'low'
    note: string
    description: string
  }>
  conclusionNote: string

  // Metadata
  verifiedAt: string
  verificationMethod: 'deterministic_code'
}
