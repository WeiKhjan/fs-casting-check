// Types for structured audit data
export interface AuditKPI {
  testsPassed: number
  testsFailed: number
  totalTests: number
  exceptionsFound: number
  highSeverity: number
  mediumSeverity: number
  lowSeverity: number
  passRate: number
  horizontalChecks: string // e.g., "9/9"
}

export interface ConclusionItem {
  priority: "high" | "medium" | "low"
  note: string
  description: string
}

export interface VerticalCastingResult {
  section: string
  description: string
  components: { name: string; value: string }[]
  calculated: string
  stated: string
  variance: string
  varianceAmount: number
  status: "pass" | "fail"
}

export interface HorizontalCastingResult {
  account: string
  opening: string
  additions: { description: string; value: string }[]
  deductions: { description: string; value: string }[]
  calculatedClosing: string
  statedClosing: string
  variance: string
  varianceAmount: number
  status: "pass" | "fail"
}

export interface ExceptionItem {
  id: number
  type: string
  location: string
  description: string
  perStatement: string
  perCalculation: string
  difference: string
  severity: "high" | "medium" | "low"
  recommendation: string
}

export interface AuditDashboardData {
  companyName: string
  reportDate: string
  financialYearEnd: string
  kpi: AuditKPI
  conclusionSummary: string
  conclusionItems: ConclusionItem[]
  conclusionNote: string
  verticalCasting: VerticalCastingResult[]
  horizontalCasting: HorizontalCastingResult[]
  exceptions: ExceptionItem[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function formatComponents(components: { name: string; value: string }[]): string {
  return components.map(c => `${escapeHtml(c.name)}: ${escapeHtml(c.value)}`).join("<br>")
}

function formatAdditionsDeductions(items: { description: string; value: string }[]): string {
  if (items.length === 0) return "-"
  return items.map(i => `${escapeHtml(i.description)}: ${escapeHtml(i.value)}`).join("<br>")
}

export function generateDashboardHtml(data: AuditDashboardData): string {
  const verticalCastingRows = data.verticalCasting.map(row => `
        <tr class="${row.status === 'fail' ? 'row-error' : ''}">
            <td>${escapeHtml(row.section)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td class="items-cell">${formatComponents(row.components)}</td>
            <td class="number">${escapeHtml(row.calculated)}</td>
            <td class="number">${escapeHtml(row.stated)}</td>
            <td class="number ${row.varianceAmount !== 0 ? 'variance-error' : ''}">${escapeHtml(row.variance)}</td>
            <td class="${row.status === 'pass' ? 'status-pass' : 'status-fail'}">${row.status === 'pass' ? '✓ PASS' : '✗ FAIL'}</td>
        </tr>`).join("\n")

  const horizontalCastingRows = data.horizontalCasting.map(row => `
        <tr class="${row.status === 'fail' ? 'row-error' : ''}">
            <td>${escapeHtml(row.account)}</td>
            <td class="number">${escapeHtml(row.opening)}</td>
            <td class="items-cell">${formatAdditionsDeductions(row.additions)}</td>
            <td class="items-cell">${formatAdditionsDeductions(row.deductions)}</td>
            <td class="number">${escapeHtml(row.calculatedClosing)}</td>
            <td class="number">${escapeHtml(row.statedClosing)}</td>
            <td class="number ${row.varianceAmount !== 0 ? 'variance-error' : ''}">${escapeHtml(row.variance)}</td>
            <td class="${row.status === 'pass' ? 'status-pass' : 'status-fail'}">${row.status === 'pass' ? '✓ PASS' : '✗ FAIL'}</td>
        </tr>`).join("\n")

  const exceptionRows = data.exceptions.map(ex => `
        <tr>
            <td>${ex.id}</td>
            <td><span class="exception-type">${escapeHtml(ex.type)}</span></td>
            <td>${escapeHtml(ex.location)}</td>
            <td>${escapeHtml(ex.description)}</td>
            <td class="number">${escapeHtml(ex.perStatement)}</td>
            <td class="number">${escapeHtml(ex.perCalculation)}</td>
            <td class="number">${escapeHtml(ex.difference)}</td>
            <td class="severity-${ex.severity}">${ex.severity.charAt(0).toUpperCase() + ex.severity.slice(1)}</td>
            <td class="recommendation">${escapeHtml(ex.recommendation)}</td>
        </tr>`).join("\n")

  const conclusionItemsHtml = data.conclusionItems.map(item =>
    `<li><strong>${escapeHtml(item.note)} (${item.priority.charAt(0).toUpperCase() + item.priority.slice(1)} Priority):</strong> ${escapeHtml(item.description)}</li>`
  ).join("\n")

  const verticalBadgeClass = data.kpi.testsFailed === 0 ? 'badge-success' : 'badge-warning'
  const horizontalBadgeClass = 'badge-success'
  const exceptionBadgeClass = data.exceptionsFound === 0 ? 'badge-success' : 'badge-danger'

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audit Casting Dashboard - ${escapeHtml(data.companyName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root, [data-theme="dark"] {
            --bg-primary: #0a0e17;
            --bg-secondary: #111827;
            --bg-card: #1a2234;
            --bg-card-hover: #1f2a40;
            --border-color: #2d3a4f;
            --text-primary: #e5e7eb;
            --text-secondary: #9ca3af;
            --text-muted: #6b7280;
            --accent-blue: #3b82f6;
            --accent-cyan: #06b6d4;
            --accent-green: #10b981;
            --accent-yellow: #f59e0b;
            --accent-red: #ef4444;
            --accent-purple: #8b5cf6;
            --gradient-primary: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            --gradient-success: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
            --gradient-danger: linear-gradient(135deg, #ef4444 0%, #f59e0b 100%);
            --shadow-glow: 0 0 40px rgba(59, 130, 246, 0.15);
            --table-header-bg: #1f2937;
            --table-row-hover: rgba(59, 130, 246, 0.1);
            --table-row-alt: rgba(255, 255, 255, 0.02);
        }

        [data-theme="light"] {
            --bg-primary: #f8fafc;
            --bg-secondary: #ffffff;
            --bg-card: #ffffff;
            --bg-card-hover: #f1f5f9;
            --border-color: #e2e8f0;
            --text-primary: #1e293b;
            --text-secondary: #64748b;
            --text-muted: #94a3b8;
            --accent-blue: #2563eb;
            --accent-cyan: #0891b2;
            --accent-green: #059669;
            --accent-yellow: #d97706;
            --accent-red: #dc2626;
            --accent-purple: #7c3aed;
            --gradient-primary: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
            --gradient-success: linear-gradient(135deg, #059669 0%, #0891b2 100%);
            --gradient-danger: linear-gradient(135deg, #dc2626 0%, #d97706 100%);
            --shadow-glow: 0 4px 20px rgba(0, 0, 0, 0.08);
            --table-header-bg: #f1f5f9;
            --table-row-hover: rgba(37, 99, 235, 0.08);
            --table-row-alt: rgba(0, 0, 0, 0.02);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        .dashboard { max-width: 1800px; margin: 0 auto; padding: 2rem; }

        .header {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 2rem 3rem;
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: var(--shadow-glow);
            transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .header-left h1 {
            font-size: 1.75rem;
            font-weight: 700;
            background: var(--gradient-primary);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
        }

        .header-left .subtitle { color: var(--text-secondary); font-size: 0.95rem; }
        .header-left .company { color: var(--accent-cyan); font-weight: 600; font-size: 1.1rem; margin-top: 0.5rem; }
        .header-right { text-align: right; }
        .header-right .date { font-family: 'JetBrains Mono', monospace; color: var(--text-secondary); font-size: 0.9rem; }

        .header-right .status {
            display: inline-block;
            padding: 0.5rem 1.5rem;
            border-radius: 30px;
            font-weight: 600;
            margin-top: 0.75rem;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-complete { background: var(--gradient-success); color: white; }

        .theme-toggle { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }

        .theme-toggle-btn {
            position: relative;
            width: 60px;
            height: 30px;
            background: var(--bg-secondary);
            border: 2px solid var(--border-color);
            border-radius: 30px;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .theme-toggle-btn::after {
            content: '';
            position: absolute;
            top: 3px;
            left: 3px;
            width: 20px;
            height: 20px;
            background: var(--accent-yellow);
            border-radius: 50%;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        [data-theme="light"] .theme-toggle-btn::after {
            left: calc(100% - 23px);
            background: var(--accent-blue);
        }

        .theme-toggle-label { font-size: 0.85rem; color: var(--text-secondary); font-weight: 500; }
        .theme-icon { font-size: 1.1rem; }

        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 1.25rem;
            margin-bottom: 2rem;
        }

        .kpi-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
            transition: all 0.3s ease;
        }

        .kpi-card:hover {
            transform: translateY(-2px);
            border-color: var(--accent-blue);
            box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
        }

        .kpi-card .value {
            font-size: 2.5rem;
            font-weight: 800;
            font-family: 'JetBrains Mono', monospace;
            margin-bottom: 0.5rem;
        }

        .kpi-card .label {
            color: var(--text-secondary);
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 500;
        }

        .kpi-card.success .value { color: var(--accent-green); }
        .kpi-card.danger .value { color: var(--accent-red); }
        .kpi-card.warning .value { color: var(--accent-yellow); }
        .kpi-card.info .value { color: var(--accent-blue); }
        .kpi-card.purple .value { color: var(--accent-purple); }
        .kpi-card.cyan .value { color: var(--accent-cyan); }

        .section {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            margin-bottom: 2rem;
            overflow: hidden;
            transition: background-color 0.3s ease, border-color 0.3s ease;
        }

        .section-header {
            background: var(--bg-secondary);
            padding: 1.25rem 1.75rem;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background-color 0.3s ease, border-color 0.3s ease;
        }

        .section-header h2 {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .section-header h2 .icon {
            width: 28px;
            height: 28px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.9rem;
        }

        .icon-blue { background: rgba(59, 130, 246, 0.2); }
        .icon-green { background: rgba(16, 185, 129, 0.2); }
        .icon-red { background: rgba(239, 68, 68, 0.2); }
        .icon-yellow { background: rgba(245, 158, 11, 0.2); }

        .section-badge {
            padding: 0.35rem 0.85rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }

        .badge-success { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }
        .badge-warning { background: rgba(245, 158, 11, 0.2); color: var(--accent-yellow); }
        .badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--accent-red); }

        .section-body { padding: 1.5rem; overflow-x: auto; }

        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }

        th {
            background: var(--table-header-bg);
            padding: 1rem 0.75rem;
            text-align: left;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            font-size: 0.7rem;
            letter-spacing: 0.5px;
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        td {
            padding: 0.85rem 0.75rem;
            border-bottom: 1px solid var(--border-color);
            vertical-align: top;
        }

        tr:hover { background: var(--bg-card-hover); }

        .number { font-family: 'JetBrains Mono', monospace; text-align: right; }
        .items-cell { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.8; }
        .status-pass { color: var(--accent-green); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .status-fail { color: var(--accent-red); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .row-error { background: rgba(239, 68, 68, 0.05); }
        .variance-error { color: var(--accent-red); font-weight: 600; }

        .exception-type {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            background: rgba(139, 92, 246, 0.2);
            color: var(--accent-purple);
        }

        .severity-low { color: var(--accent-cyan); font-weight: 600; }
        .severity-medium { color: var(--accent-yellow); font-weight: 600; }
        .severity-high { color: var(--accent-red); font-weight: 600; }
        .recommendation { font-size: 0.8rem; color: var(--text-secondary); max-width: 300px; }

        .conclusion {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(6, 182, 212, 0.1) 100%);
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 16px;
            padding: 2rem;
            margin-bottom: 2rem;
        }

        .conclusion h3 {
            color: var(--accent-green);
            font-size: 1.25rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .conclusion p { color: var(--text-secondary); margin-bottom: 1rem; }
        .conclusion ul { list-style: none; padding: 0; }

        .conclusion li {
            padding: 0.5rem 0;
            padding-left: 1.5rem;
            position: relative;
            color: var(--text-secondary);
        }

        .conclusion li::before {
            content: "→";
            position: absolute;
            left: 0;
            color: var(--accent-cyan);
        }

        .footer { text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8rem; }

        @media (max-width: 1200px) { .kpi-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 768px) {
            .kpi-grid { grid-template-columns: repeat(2, 1fr); }
            .header { flex-direction: column; text-align: center; gap: 1rem; }
            .header-right { text-align: center; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <header class="header">
            <div class="header-left">
                <h1>📊 Audit Casting & Cross-Checking Dashboard</h1>
                <div class="subtitle">Financial Statements Verification Report</div>
                <div class="company">${escapeHtml(data.companyName)}</div>
            </div>
            <div class="header-right">
                <div class="theme-toggle">
                    <span class="theme-icon">🌙</span>
                    <button class="theme-toggle-btn" onclick="toggleTheme()" aria-label="Toggle theme"></button>
                    <span class="theme-icon">☀️</span>
                </div>
                <div class="date">Report Generated: ${escapeHtml(data.reportDate)}</div>
                <div class="date">Financial Year Ended: ${escapeHtml(data.financialYearEnd)}</div>
                <span class="status status-complete">✓ Audit Complete</span>
            </div>
        </header>

        <div class="kpi-grid">
            <div class="kpi-card success">
                <div class="value">${data.kpi.testsPassed}</div>
                <div class="label">Tests Passed</div>
            </div>
            <div class="kpi-card danger">
                <div class="value">${data.kpi.testsFailed}</div>
                <div class="label">Tests Failed</div>
            </div>
            <div class="kpi-card info">
                <div class="value">${data.kpi.totalTests}</div>
                <div class="label">Total Tests</div>
            </div>
            <div class="kpi-card warning">
                <div class="value">${data.kpi.exceptionsFound}</div>
                <div class="label">Exceptions Found</div>
            </div>
            <div class="kpi-card danger">
                <div class="value">${data.kpi.highSeverity}</div>
                <div class="label">High Severity</div>
            </div>
            <div class="kpi-card cyan">
                <div class="value">${data.kpi.passRate}%</div>
                <div class="label">Pass Rate</div>
            </div>
            <div class="kpi-card purple">
                <div class="value">${escapeHtml(data.kpi.horizontalChecks)}</div>
                <div class="label">Horiz. Checks</div>
            </div>
        </div>

        <div class="conclusion">
            <h3>✓ Audit Conclusion</h3>
            <p><strong>${escapeHtml(data.conclusionSummary)}</strong></p>
            <ul>
                ${conclusionItemsHtml}
            </ul>
            <p style="margin-top: 1.5rem; font-style: italic;">${escapeHtml(data.conclusionNote)}</p>
        </div>

        <section class="section">
            <div class="section-header">
                <h2><span class="icon icon-blue">🔢</span>Vertical Casting Results</h2>
                <span class="section-badge ${verticalBadgeClass}">${data.kpi.testsPassed}/${data.kpi.totalTests} Passed</span>
            </div>
            <div class="section-body">
                <table>
                    <thead>
                        <tr>
                            <th>Section</th>
                            <th>Description</th>
                            <th>Components</th>
                            <th>Calculated</th>
                            <th>Stated</th>
                            <th>Variance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${verticalCastingRows}
                    </tbody>
                </table>
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2><span class="icon icon-green">↔️</span>Horizontal Casting Checks (Movement Reconciliations)</h2>
                <span class="section-badge ${horizontalBadgeClass}">${escapeHtml(data.kpi.horizontalChecks)} Passed</span>
            </div>
            <div class="section-body">
                <table>
                    <thead>
                        <tr>
                            <th>Account/Balance</th>
                            <th>Opening</th>
                            <th>Additions</th>
                            <th>Deductions</th>
                            <th>Calculated Closing</th>
                            <th>Stated Closing</th>
                            <th>Variance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${horizontalCastingRows}
                    </tbody>
                </table>
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2><span class="icon icon-red">⚠️</span>Exception Report</h2>
                <span class="section-badge ${exceptionBadgeClass}">${data.kpi.exceptionsFound} Issues Found</span>
            </div>
            <div class="section-body">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Type</th>
                            <th>Location</th>
                            <th>Description</th>
                            <th>Per Statement</th>
                            <th>Per Calculation</th>
                            <th>Difference</th>
                            <th>Severity</th>
                            <th>Recommendation</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${exceptionRows}
                    </tbody>
                </table>
            </div>
        </section>

        <footer class="footer">
            <p>Audit Casting Tool v2.0 | Generated by Claude AI | Financial Statement Casting Check</p>
        </footer>
    </div>

    <script>
        function toggleTheme() {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            html.setAttribute('data-theme', currentTheme === 'dark' ? 'light' : 'dark');
            localStorage.setItem('theme', currentTheme === 'dark' ? 'light' : 'dark');
        }

        // Load saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    </script>
</body>
</html>`
}
