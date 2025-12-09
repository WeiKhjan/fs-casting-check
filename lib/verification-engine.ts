// ============================================================================
// VERIFICATION ENGINE - 100% Deterministic Arithmetic Verification
// ============================================================================
// This module performs ALL mathematical verification using code.
// NO arithmetic is done by the LLM - only extraction.
// This ensures 100% accuracy for all casting checks.
// ============================================================================

import {
  ExtractionResult,
  ExtractedStatement,
  ExtractedMovement,
  ExtractedCrossReference,
  ExtractedCastingRelationship,
  ExtractionWarning,
  VerificationResult,
  CastingVerificationResult,
  BalanceSheetVerificationResult,
  MovementVerificationResult,
  CrossReferenceVerificationResult,
  VerificationException,
  VerificationStatus,
} from './extraction-types'

// ============================================================================
// CORE ARITHMETIC FUNCTIONS - These are the building blocks
// ============================================================================

/**
 * Precisely sum an array of numbers
 * Uses integer arithmetic to avoid floating point errors
 */
export function preciseSum(numbers: number[]): number {
  // Convert to cents/smallest unit to avoid floating point issues
  const sum = numbers.reduce((acc, num) => {
    // Round to 2 decimal places to handle floating point representation
    return acc + Math.round(num * 100)
  }, 0)
  return sum / 100
}

/**
 * Calculate absolute variance between two numbers
 */
export function calculateVariance(calculated: number, stated: number): number {
  return Math.abs(Math.round((calculated - stated) * 100) / 100)
}

/**
 * Calculate variance as percentage of stated amount
 */
export function calculateVariancePercentage(variance: number, stated: number): number {
  if (stated === 0) return variance === 0 ? 0 : 100
  return Math.round((variance / Math.abs(stated)) * 10000) / 100
}

/**
 * Determine verification status based on variance
 * For financial statements, even RM 1 difference is a fail
 */
export function determineStatus(variance: number): VerificationStatus {
  if (variance === 0) return 'pass'
  return 'fail'  // Any non-zero variance is a failure
}

/**
 * Determine severity based on variance amount
 */
export function determineSeverity(variance: number): 'high' | 'medium' | 'low' {
  const absVariance = Math.abs(variance)
  if (absVariance >= 10000) return 'high'      // RM 10,000 or more
  if (absVariance >= 1000) return 'medium'     // RM 1,000 - 9,999
  return 'low'                                  // Less than RM 1,000 (includes RM 1 errors)
}

/**
 * Format amount as RM string for display
 */
export function formatRM(amount: number): string {
  const absAmount = Math.abs(amount)
  const formatted = absAmount.toLocaleString('en-MY', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  if (amount < 0) {
    return `(RM ${formatted})`
  }
  return `RM ${formatted}`
}

/**
 * Generate unique ID for verification results
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
}

// ============================================================================
// VERTICAL CASTING VERIFICATION
// ============================================================================

/**
 * Verify that components add up to stated total
 */
export function verifyCasting(
  section: string,
  description: string,
  components: Array<{ label: string; amount: number }>,
  statedTotal: number
): CastingVerificationResult {
  const amounts = components.map(c => c.amount)
  const calculatedTotal = preciseSum(amounts)
  const variance = calculateVariance(calculatedTotal, statedTotal)
  const variancePercentage = calculateVariancePercentage(variance, statedTotal)
  const status = determineStatus(variance)

  return {
    id: generateId('cast'),
    checkType: 'vertical',
    section,
    description,
    components,
    calculatedTotal,
    statedTotal,
    variance,
    variancePercentage,
    status,
    verifiedBy: 'code',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Process all casting relationships from extraction
 */
export function verifyAllCastings(
  castingRelationships: ExtractedCastingRelationship[]
): CastingVerificationResult[] {
  return castingRelationships.map(rel => {
    const components = rel.componentLabels.map((label, i) => ({
      label,
      amount: rel.componentAmounts[i] || 0,
    }))

    return verifyCasting(
      rel.section,
      `${rel.totalLabel} calculation`,
      components,
      rel.totalAmount
    )
  })
}

// ============================================================================
// BALANCE SHEET VERIFICATION
// ============================================================================

/**
 * Verify balance sheet equation: Assets = Liabilities + Equity
 */
export function verifyBalanceSheet(
  totalAssets: number,
  totalLiabilities: number,
  totalEquity: number
): BalanceSheetVerificationResult {
  const calculatedLiabilitiesPlusEquity = preciseSum([totalLiabilities, totalEquity])
  const variance = calculateVariance(totalAssets, calculatedLiabilitiesPlusEquity)
  const status = determineStatus(variance)

  return {
    id: generateId('bs'),
    checkType: 'balance_equation',
    totalAssets,
    totalLiabilities,
    totalEquity,
    calculatedLiabilitiesPlusEquity,
    variance,
    status,
    verifiedBy: 'code',
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// HORIZONTAL CASTING (MOVEMENT RECONCILIATION) VERIFICATION
// ============================================================================

/**
 * Verify movement reconciliation: Opening + Additions - Deductions = Closing
 */
export function verifyMovement(
  movement: ExtractedMovement
): MovementVerificationResult {
  const totalAdditions = preciseSum(movement.additions.map(a => a.amount))
  const totalDeductions = preciseSum(movement.deductions.map(d => d.amount))

  // Opening + Additions - Deductions = Closing
  const calculatedClosing = preciseSum([
    movement.opening,
    totalAdditions,
    -totalDeductions,
  ])

  const variance = calculateVariance(calculatedClosing, movement.statedClosing)
  const status = determineStatus(variance)

  return {
    id: generateId('mov'),
    checkType: 'horizontal',
    accountName: movement.accountName,
    opening: movement.opening,
    totalAdditions,
    totalDeductions,
    calculatedClosing,
    statedClosing: movement.statedClosing,
    variance,
    status,
    verifiedBy: 'code',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Process all movement reconciliations
 */
export function verifyAllMovements(
  movements: ExtractedMovement[]
): MovementVerificationResult[] {
  return movements.map(verifyMovement)
}

// ============================================================================
// CROSS-REFERENCE VERIFICATION
// ============================================================================

/**
 * Verify that note total matches statement line item
 */
export function verifyCrossReference(
  crossRef: ExtractedCrossReference
): CrossReferenceVerificationResult {
  const variance = calculateVariance(crossRef.noteTotal, crossRef.statementAmount)
  const status = determineStatus(variance)

  return {
    id: generateId('xref'),
    checkType: 'cross_reference',
    noteRef: crossRef.noteRef,
    noteDescription: crossRef.noteDescription,
    noteAmount: crossRef.noteTotal,
    statementAmount: crossRef.statementAmount,
    variance,
    status,
    verifiedBy: 'code',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Process all cross-references
 */
export function verifyAllCrossReferences(
  crossReferences: ExtractedCrossReference[]
): CrossReferenceVerificationResult[] {
  return crossReferences.map(verifyCrossReference)
}

// ============================================================================
// EXCEPTION GENERATION
// ============================================================================

/**
 * Generate exception from failed casting result
 */
function castingToException(
  result: CastingVerificationResult,
  exceptionId: number
): VerificationException | null {
  if (result.status === 'pass') return null

  return {
    id: exceptionId,
    type: 'Casting Error',
    location: result.section,
    description: `${result.description}: Components sum to ${formatRM(result.calculatedTotal)} but stated as ${formatRM(result.statedTotal)}`,
    statedAmount: result.statedTotal,
    calculatedAmount: result.calculatedTotal,
    difference: result.variance,
    severity: determineSeverity(result.variance),
    recommendation: 'Verify the arithmetic in the source document and correct if necessary.',
    relatedCheckId: result.id,
  }
}

/**
 * Generate exception from failed balance sheet result
 */
function balanceSheetToException(
  result: BalanceSheetVerificationResult,
  exceptionId: number
): VerificationException | null {
  if (result.status === 'pass') return null

  return {
    id: exceptionId,
    type: 'Balance Sheet Imbalance',
    location: 'Statement of Financial Position',
    description: `Balance sheet does not balance: Assets ${formatRM(result.totalAssets)} ≠ Liabilities ${formatRM(result.totalLiabilities)} + Equity ${formatRM(result.totalEquity)}`,
    statedAmount: result.totalAssets,
    calculatedAmount: result.calculatedLiabilitiesPlusEquity,
    difference: result.variance,
    severity: 'high',  // Balance sheet imbalance is always high severity
    recommendation: 'Urgent: Balance sheet must balance. Review all totals for errors.',
    relatedCheckId: result.id,
  }
}

/**
 * Generate exception from failed movement result
 */
function movementToException(
  result: MovementVerificationResult,
  exceptionId: number
): VerificationException | null {
  if (result.status === 'pass') return null

  return {
    id: exceptionId,
    type: 'Movement Reconciliation Error',
    location: `${result.accountName} Movement`,
    description: `Movement does not reconcile: Opening ${formatRM(result.opening)} + Additions ${formatRM(result.totalAdditions)} - Deductions ${formatRM(result.totalDeductions)} = ${formatRM(result.calculatedClosing)}, but stated closing is ${formatRM(result.statedClosing)}`,
    statedAmount: result.statedClosing,
    calculatedAmount: result.calculatedClosing,
    difference: result.variance,
    severity: determineSeverity(result.variance),
    recommendation: 'Review the movement schedule and verify all additions and deductions are captured.',
    relatedCheckId: result.id,
  }
}

/**
 * Generate exception from failed cross-reference result
 */
function crossRefToException(
  result: CrossReferenceVerificationResult,
  exceptionId: number
): VerificationException | null {
  if (result.status === 'pass') return null

  return {
    id: exceptionId,
    type: 'Cross Reference Mismatch',
    location: result.noteRef,
    description: `${result.noteDescription}: Note shows ${formatRM(result.noteAmount)} but statement shows ${formatRM(result.statementAmount)}`,
    statedAmount: result.statementAmount,
    calculatedAmount: result.noteAmount,
    difference: result.variance,
    severity: determineSeverity(result.variance),
    recommendation: 'Verify that the note total agrees with the statement line item. May be a presentation or disclosure error.',
    relatedCheckId: result.id,
  }
}

// ============================================================================
// MAIN VERIFICATION ORCHESTRATOR
// ============================================================================

/**
 * Run complete verification on extracted data
 * This is the main entry point for verification
 */
export function runVerification(extraction: ExtractionResult): VerificationResult {
  const verifiedAt = new Date().toISOString()

  // Run all verifications
  const castingResults = verifyAllCastings(extraction.castingRelationships)
  const movementResults = verifyAllMovements(extraction.movements)
  const crossReferenceResults = verifyAllCrossReferences(extraction.crossReferences)

  // Find SOFP for balance sheet verification
  const sofp = extraction.statements.find(s => s.statementType === 'SOFP')
  let balanceSheetResult: BalanceSheetVerificationResult | undefined

  if (sofp?.totalAssets && sofp?.totalLiabilities && sofp?.totalEquity) {
    balanceSheetResult = verifyBalanceSheet(
      sofp.totalAssets.current,
      sofp.totalLiabilities.current,
      sofp.totalEquity.current
    )
  }

  // Collect all exceptions
  const exceptions: VerificationException[] = []
  let exceptionId = 1

  for (const result of castingResults) {
    const ex = castingToException(result, exceptionId)
    if (ex) {
      exceptions.push(ex)
      exceptionId++
    }
  }

  if (balanceSheetResult) {
    const ex = balanceSheetToException(balanceSheetResult, exceptionId)
    if (ex) {
      exceptions.push(ex)
      exceptionId++
    }
  }

  for (const result of movementResults) {
    const ex = movementToException(result, exceptionId)
    if (ex) {
      exceptions.push(ex)
      exceptionId++
    }
  }

  for (const result of crossReferenceResults) {
    const ex = crossRefToException(result, exceptionId)
    if (ex) {
      exceptions.push(ex)
      exceptionId++
    }
  }

  // Calculate KPIs
  const allResults = [
    ...castingResults,
    ...movementResults,
    ...crossReferenceResults,
    ...(balanceSheetResult ? [balanceSheetResult] : []),
  ]

  const totalChecks = allResults.length
  const passed = allResults.filter(r => r.status === 'pass').length
  const failed = allResults.filter(r => r.status === 'fail').length
  const warnings = allResults.filter(r => r.status === 'warning').length
  const needsReview = allResults.filter(r => r.status === 'needs_review').length
  const passRate = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 100

  const highSeverity = exceptions.filter(e => e.severity === 'high').length
  const mediumSeverity = exceptions.filter(e => e.severity === 'medium').length
  const lowSeverity = exceptions.filter(e => e.severity === 'low').length

  // Generate conclusion
  const conclusionSummary = generateConclusionSummary(exceptions, totalChecks, passed)
  const conclusionItems = generateConclusionItems(exceptions)
  const conclusionNote = generateConclusionNote(balanceSheetResult, passed, totalChecks)

  return {
    kpi: {
      totalChecks,
      passed,
      failed,
      warnings,
      needsReview,
      passRate,
      exceptionsCount: exceptions.length,
      highSeverity,
      mediumSeverity,
      lowSeverity,
    },
    castingResults,
    balanceSheetResult,
    movementResults,
    crossReferenceResults,
    exceptions,
    needsHumanReview: extraction.warnings,
    conclusionSummary,
    conclusionItems,
    conclusionNote,
    verifiedAt,
    verificationMethod: 'deterministic_code',
  }
}

// ============================================================================
// CONCLUSION GENERATION
// ============================================================================

function generateConclusionSummary(
  exceptions: VerificationException[],
  totalChecks: number,
  passed: number
): string {
  if (exceptions.length === 0) {
    return `The financial statements cast correctly with no exceptions. All ${totalChecks} checks passed.`
  }

  const highCount = exceptions.filter(e => e.severity === 'high').length
  const mediumCount = exceptions.filter(e => e.severity === 'medium').length
  const lowCount = exceptions.filter(e => e.severity === 'low').length

  let summary = `The financial statements cast correctly subject to ${exceptions.length} exception(s)`

  const parts: string[] = []
  if (highCount > 0) parts.push(`${highCount} high`)
  if (mediumCount > 0) parts.push(`${mediumCount} medium`)
  if (lowCount > 0) parts.push(`${lowCount} low`)

  if (parts.length > 0) {
    summary += ` (${parts.join(', ')} severity)`
  }

  summary += `. ${passed}/${totalChecks} checks passed.`

  return summary
}

function generateConclusionItems(
  exceptions: VerificationException[]
): Array<{ priority: 'high' | 'medium' | 'low'; note: string; description: string }> {
  // Sort by severity (high first)
  const sorted = [...exceptions].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.severity] - order[b.severity]
  })

  return sorted.map(ex => ({
    priority: ex.severity,
    note: ex.location,
    description: `Stated ${formatRM(ex.statedAmount)} vs Calculated ${formatRM(ex.calculatedAmount)} → Δ ${formatRM(ex.difference)}`,
  }))
}

function generateConclusionNote(
  balanceSheetResult: BalanceSheetVerificationResult | undefined,
  passed: number,
  totalChecks: number
): string {
  const parts: string[] = []

  if (balanceSheetResult) {
    if (balanceSheetResult.status === 'pass') {
      parts.push('Balance Sheet balances correctly (Assets = Liabilities + Equity).')
    } else {
      parts.push(`WARNING: Balance Sheet does not balance - variance of ${formatRM(balanceSheetResult.variance)}.`)
    }
  }

  if (passed === totalChecks) {
    parts.push('All arithmetic has been verified by deterministic code with 100% accuracy.')
  } else {
    parts.push(`${passed} of ${totalChecks} checks passed. Exceptions should be investigated.`)
  }

  return parts.join(' ')
}

// ============================================================================
// UTILITY: Convert verification result to dashboard format
// ============================================================================

/**
 * Convert verification result to the format expected by dashboard-template.ts
 * This ensures backward compatibility with existing dashboard
 */
export function toAuditDashboardData(
  extraction: ExtractionResult,
  verification: VerificationResult
): {
  companyName: string
  reportDate: string
  financialYearEnd: string
  kpi: {
    testsPassed: number
    testsFailed: number
    totalTests: number
    exceptionsFound: number
    highSeverity: number
    mediumSeverity: number
    lowSeverity: number
    passRate: number
    horizontalChecks: string
  }
  conclusionSummary: string
  conclusionItems: Array<{ priority: 'high' | 'medium' | 'low'; note: string; description: string }>
  conclusionNote: string
  verticalCasting: Array<{
    section: string
    description: string
    components: Array<{ name: string; value: string }>
    calculated: string
    stated: string
    variance: string
    varianceAmount: number
    status: 'pass' | 'fail'
  }>
  horizontalCasting: Array<{
    account: string
    opening: string
    additions: Array<{ description: string; value: string }>
    deductions: Array<{ description: string; value: string }>
    calculatedClosing: string
    statedClosing: string
    variance: string
    varianceAmount: number
    status: 'pass' | 'fail'
  }>
  crossReferenceChecks: Array<{
    noteRef: string
    noteDescription: string
    lineItem: string
    perNote: string
    perStatement: string
    variance: string
    varianceAmount: number
    status: 'pass' | 'fail'
  }>
  exceptions: Array<{
    id: number
    type: string
    location: string
    description: string
    perStatement: string
    perCalculation: string
    difference: string
    severity: 'high' | 'medium' | 'low'
    recommendation: string
  }>
  warnings: Array<{
    type: string
    location: string
    description: string
    confidence: number
    suggestedValue?: number
    pageNumber?: number
  }>
} {
  const now = new Date()
  const reportDate = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  // Calculate horizontal checks summary
  const horizontalPassed = verification.movementResults.filter(r => r.status === 'pass').length
  const horizontalTotal = verification.movementResults.length
  const horizontalChecks = `${horizontalPassed}/${horizontalTotal}`

  // Convert casting results
  const verticalCasting = verification.castingResults.map(r => ({
    section: r.section,
    description: r.description,
    components: r.components.map(c => ({
      name: c.label,
      value: formatRM(c.amount),
    })),
    calculated: formatRM(r.calculatedTotal),
    stated: formatRM(r.statedTotal),
    variance: r.variance === 0 ? 'RM 0' : formatRM(r.variance),
    varianceAmount: r.variance,
    status: r.status === 'pass' ? 'pass' as const : 'fail' as const,
  }))

  // Convert movement results
  const horizontalCasting = verification.movementResults.map(r => {
    // Find original movement data for additions/deductions breakdown
    const originalMovement = extraction.movements.find(m => m.accountName === r.accountName)

    return {
      account: r.accountName,
      opening: formatRM(r.opening),
      additions: originalMovement?.additions.map(a => ({
        description: `+ ${a.description}`,
        value: formatRM(a.amount),
      })) || [{ description: '+ Total Additions', value: formatRM(r.totalAdditions) }],
      deductions: originalMovement?.deductions.map(d => ({
        description: `- ${d.description}`,
        value: formatRM(d.amount),
      })) || [{ description: '- Total Deductions', value: formatRM(r.totalDeductions) }],
      calculatedClosing: formatRM(r.calculatedClosing),
      statedClosing: formatRM(r.statedClosing),
      variance: r.variance === 0 ? 'RM 0' : formatRM(r.variance),
      varianceAmount: r.variance,
      status: r.status === 'pass' ? 'pass' as const : 'fail' as const,
    }
  })

  // Convert cross-reference results
  const crossReferenceChecks = verification.crossReferenceResults.map(r => {
    // Find original cross-ref for line item
    const originalCrossRef = extraction.crossReferences.find(
      c => c.noteRef === r.noteRef && c.noteDescription === r.noteDescription
    )

    return {
      noteRef: r.noteRef,
      noteDescription: r.noteDescription,
      lineItem: originalCrossRef?.statementLineItem || r.noteDescription,
      perNote: formatRM(r.noteAmount),
      perStatement: formatRM(r.statementAmount),
      variance: r.variance === 0 ? 'RM 0' : formatRM(r.variance),
      varianceAmount: r.variance,
      status: r.status === 'pass' ? 'pass' as const : 'fail' as const,
    }
  })

  // Convert exceptions
  const exceptions = verification.exceptions.map(ex => ({
    id: ex.id,
    type: ex.type,
    location: ex.location,
    description: ex.description,
    perStatement: formatRM(ex.statedAmount),
    perCalculation: formatRM(ex.calculatedAmount),
    difference: formatRM(ex.difference),
    severity: ex.severity,
    recommendation: ex.recommendation,
  }))

  return {
    companyName: extraction.companyName,
    reportDate,
    financialYearEnd: extraction.financialYearEnd,
    kpi: {
      testsPassed: verification.kpi.passed,
      testsFailed: verification.kpi.failed,
      totalTests: verification.kpi.totalChecks,
      exceptionsFound: verification.kpi.exceptionsCount,
      highSeverity: verification.kpi.highSeverity,
      mediumSeverity: verification.kpi.mediumSeverity,
      lowSeverity: verification.kpi.lowSeverity,
      passRate: verification.kpi.passRate,
      horizontalChecks,
    },
    conclusionSummary: verification.conclusionSummary,
    conclusionItems: verification.conclusionItems,
    conclusionNote: verification.conclusionNote,
    verticalCasting,
    horizontalCasting,
    crossReferenceChecks,
    exceptions,
    warnings: extraction.warnings.map(w => ({
      type: w.type,
      location: w.location,
      description: w.description,
      confidence: w.confidence,
      suggestedValue: w.suggestedValue,
      pageNumber: w.pageNumber,
    })),
  }
}
