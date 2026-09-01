/**
 * The V6 Budget view model.
 *
 * Pure: no Supabase import, no I/O, and — the rule this screen exists to keep
 * — no financial arithmetic. Budget is the screen where browser-created
 * financial truth is easiest to write and hardest to spot, because every
 * missing figure has an obvious-looking formula:
 *
 *   remaining      = plan - actual
 *   progress       = actual / plan
 *   projected      = actual / elapsed * length
 *   year total     = sum(months)
 *   year average   = sum(months) / 12
 *
 * None of those is computed here. Every one of them is a slot that names the
 * contract which would publish it. The only numbers this module passes through
 * are values a canonical contract already returned:
 *
 *   - `canonical_budget_actuals.actual_aed`  — per category, per month
 *   - `canonical_period_metrics.consumption_spend_aed` — the period total
 *   - the counters both contracts return about their own completeness
 *
 * One derived quantity does exist, and it is deliberately not a financial
 * figure: `magnitude`, the width of a category's bar relative to the largest
 * canonical actual in the same period. It is drawing geometry over canonical
 * values, exactly as the Overview's top-spend bars already are; it is never
 * stated as a number, never a share of a total, and never a proportion of a
 * plan. The prototype's plan progress bar is a separate slot and stays
 * unavailable.
 */

import { reconcilesAtCents } from '../../lib/canonicalPresentation.js'
import { BUDGET_GAPS, budgetGapSlot } from './budgetGaps.js'
import { availableSlot, errorSlot, incompleteSlot } from './slots.js'

export { BUDGET_GAPS, budgetGapSlot }

/**
 * The contract's own bucket for entries carrying no category. It is a real,
 * distinct label — never folded into a household category called "Other".
 */
export const UNCATEGORISED = 'Uncategorised'

function sourced(contract, field) {
  return `${contract}.${field}`
}

/* ── Canonical figures ──────────────────────────────────────────────────── */

function metricSlot(metrics, field, error, incompleteReason) {
  if (error) return errorSlot(error)
  if (!metrics) return errorSlot('The canonical period contract has not been read for this period.')
  const value = metrics[field]
  if (value === null || value === undefined) return incompleteSlot(incompleteReason)
  return availableSlot(value, { source: sourced('canonical_period_metrics', field) })
}

function actualSlot(row) {
  if (row.actual_aed === null || row.actual_aed === undefined) {
    return incompleteSlot('At least one entry in this category has no canonical AED amount, so the contract withholds the category actual rather than under-reporting it.')
  }
  return availableSlot(row.actual_aed, { source: sourced('canonical_budget_actuals', 'actual_aed') })
}

/* ── Category rows ──────────────────────────────────────────────────────── */

/**
 * Bar geometry for the category actuals.
 *
 * Drawn only when every category actual in the period is a canonical number
 * *and* those numbers reconcile to the canonical period total at two-decimal
 * precision — the same gate the Overview applies before drawing its top-spend
 * bars. If either fails, no bar is drawn at all, because a bar over a partial
 * set would silently misstate how the period is composed.
 *
 * `peak` is the largest canonical actual, not a sum: the widths are relative
 * magnitude between published values, not a share of anything.
 */
function magnitudeBasis(rows, periodTotal) {
  if (!rows.length) return { drawable: false, reason: null, peak: 0 }
  if (rows.some((row) => row.actual.status !== 'available')) {
    return {
      drawable: false,
      peak: 0,
      reason: 'At least one category actual is incomplete, so the relative bars are not drawn — a bar over a partial set would misstate how this period is composed.',
    }
  }
  if (periodTotal === null) {
    return {
      drawable: false,
      peak: 0,
      reason: 'Canonical consumption spend is incomplete for this period, so the category actuals cannot be checked against a reconciled total and the relative bars are not drawn.',
    }
  }
  const sum = rows.reduce((running, row) => running + row.actual.value, 0)
  if (!reconcilesAtCents(sum, periodTotal)) {
    return {
      drawable: false,
      peak: 0,
      reason: 'Category actuals do not reconcile to the canonical period consumption total at two-decimal precision, so the relative bars are not drawn.',
    }
  }
  const peak = rows.reduce((largest, row) => Math.max(largest, Math.abs(row.actual.value)), 0)
  return { drawable: true, reason: null, peak }
}

function buildCategoryRow(row) {
  return {
    key: row.category,
    // Presented as the label the contract reported, never as a stable id.
    label: row.category,
    isUncategorised: row.category === UNCATEGORISED,
    actual: actualSlot(row),
    // Every plan-side position the prototype shows, each naming its contract.
    plan: budgetGapSlot('plan'),
    remaining: budgetGapSlot('remaining'),
    progress: budgetGapSlot('progress'),
    pace: budgetGapSlot('pace'),
    projectedClose: budgetGapSlot('projectedClose'),
    magnitude: null,
    quality: row.quality_status,
    transactionCount: row.transaction_count,
    needsReviewCount: row.needs_review_count,
    zeroPlaceholderCount: row.zero_placeholder_count,
    missingFxCount: row.missing_fx_count,
  }
}

function buildCategories({ budgetActuals, budgetError, periodMetrics, metricsError }) {
  if (budgetError) return { status: 'unavailable', reason: budgetError, rows: [], bars: null }
  if (!Array.isArray(budgetActuals)) {
    return {
      status: 'unavailable',
      reason: 'Canonical category actuals have not been read for this period.',
      rows: [],
      bars: null,
    }
  }
  if (budgetActuals.length === 0) {
    return {
      status: 'empty',
      reason: 'The canonical actuals contract reports no consumption spend in any category for this period.',
      rows: [],
      bars: null,
    }
  }

  const rows = budgetActuals.map(buildCategoryRow)
  // Largest actual first, then label. Ordering is presentation; it changes no
  // value and states no judgement about a category.
  rows.sort((left, right) => {
    const leftValue = left.actual.status === 'available' ? Math.abs(left.actual.value) : -Infinity
    const rightValue = right.actual.status === 'available' ? Math.abs(right.actual.value) : -Infinity
    if (leftValue === rightValue) return left.label.localeCompare(right.label)
    return rightValue - leftValue
  })

  const periodTotal = metricsError ? null : periodMetrics?.consumption_spend_aed ?? null
  const basis = magnitudeBasis(rows, periodTotal)
  const drawn = rows.map((row) => Object.freeze({
    ...row,
    magnitude: basis.drawable && basis.peak > 0 ? Math.abs(row.actual.value) / basis.peak : null,
  }))

  return {
    status: 'available',
    reason: null,
    rows: Object.freeze(drawn),
    bars: Object.freeze({ drawable: basis.drawable, reason: basis.reason }),
  }
}

/* ── Month summary ──────────────────────────────────────────────────────── */

function buildSummary({ periodMetrics, metricsError }) {
  return Object.freeze({
    // The one canonical headline this screen can state.
    actual: metricSlot(
      periodMetrics,
      'consumption_spend_aed',
      metricsError,
      'Consumption spend is incomplete for this period, so the canonical contract withholds the figure rather than under-reporting it.',
    ),
    // The prototype's "of 55,000", its bar, its pace marker, its "tracking
    // under pace" line and its projected close — all plan positions.
    plan: budgetGapSlot('plan'),
    remaining: budgetGapSlot('remaining'),
    progress: budgetGapSlot('progress'),
    pace: budgetGapSlot('pace'),
    projectedClose: budgetGapSlot('projectedClose'),
    variance: budgetGapSlot('variance'),
    rollover: budgetGapSlot('rollover'),
    quality: periodMetrics?.quality_status ?? null,
    needsReviewCount: periodMetrics?.needs_review_count ?? null,
    zeroPlaceholderCount: periodMetrics?.zero_placeholder_count ?? null,
    missingFxCount: periodMetrics?.missing_fx_count ?? null,
    missingFxCurrencies: periodMetrics?.quality_metadata?.missing_fx_currencies ?? [],
  })
}

/* ── Year grid ──────────────────────────────────────────────────────────── */

/**
 * Twelve canonical monthly reads laid out as one grid.
 *
 * The grid navigates monthly versions; it does not aggregate them. Every cell
 * is one month's own `actual_aed` for one label. The Total and Avg columns the
 * prototype shows, and its income and net-saved rows, are slots naming their
 * contracts — nothing is added up across the row.
 */
function buildYear({ months, monthlyActuals, monthlyMetrics }) {
  if (!Array.isArray(monthlyActuals)) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'Canonical category actuals have not been read for this year.',
      months, rows: [], spendRow: [],
    })
  }

  const labels = new Map()
  for (const entry of monthlyActuals) {
    if (!Array.isArray(entry.rows)) continue
    for (const row of entry.rows) {
      if (!labels.has(row.category)) labels.set(row.category, new Map())
      labels.get(row.category).set(entry.key, row)
    }
  }

  const rows = [...labels.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, byMonth]) => Object.freeze({
      key: label,
      label,
      isUncategorised: label === UNCATEGORISED,
      cells: Object.freeze(months.map((month) => {
        const entry = monthlyActuals.find((candidate) => candidate.key === month.key)
        if (!entry || entry.error) {
          return Object.freeze({
            key: month.key, month,
            slot: errorSlot(entry?.error ?? 'This month was not read.'),
            reported: false,
          })
        }
        const row = byMonth.get(month.key)
        if (!row) {
          // A label the contract did not report for this month. That is "no
          // canonical consumption spend recorded", not zero spend asserted and
          // not a plan of nothing.
          return Object.freeze({ key: month.key, month, slot: null, reported: false })
        }
        return Object.freeze({ key: month.key, month, slot: actualSlot(row), reported: true })
      })),
      total: budgetGapSlot('yearAggregate'),
      average: budgetGapSlot('yearAggregate'),
    }))

  const spendRow = Object.freeze(months.map((month) => {
    const entry = Array.isArray(monthlyMetrics)
      ? monthlyMetrics.find((candidate) => candidate.key === month.key)
      : null
    return Object.freeze({
      key: month.key,
      month,
      slot: metricSlot(
        entry?.metrics ?? null,
        'consumption_spend_aed',
        entry?.error ?? null,
        'Consumption spend is incomplete for this month, so the canonical contract withholds the figure.',
      ),
    })
  }))

  return Object.freeze({
    status: rows.length ? 'available' : 'empty',
    reason: rows.length
      ? null
      : 'The canonical actuals contract reports no consumption spend in any category in any month of this year.',
    months,
    rows: Object.freeze(rows),
    spendRow,
    total: budgetGapSlot('yearAggregate'),
    income: budgetGapSlot('income'),
    netSaved: budgetGapSlot('savings'),
    plan: budgetGapSlot('plan'),
  })
}

/* ── Capabilities ───────────────────────────────────────────────────────── */

/**
 * Every write the prototype's Budget page offers, reported as unsupported.
 *
 * Rendered as visible, disabled affordances naming their missing contract.
 * None of them is wired to `src/lib/budgets.js` or any other legacy writer:
 * a plan written outside the versioned plan contract is a plan that contract
 * could not later version, interpret or supersede.
 */
export function buildCapabilities() {
  return Object.freeze({
    setBudget: budgetGapSlot('setBudget'),
    editBudget: budgetGapSlot('editBudget'),
    rollover: budgetGapSlot('rollover'),
    categoryAdmin: budgetGapSlot('categoryAdmin'),
  })
}

export function isWriteEnabled(capabilities) {
  return Object.values(capabilities).some((slot) => slot.status === 'available')
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function buildBudgetModel(input) {
  const {
    period,
    view = 'month',
    budgetActuals = null,
    periodMetrics = null,
    monthlyActuals = null,
    monthlyMetrics = null,
    errors = {},
  } = input

  const resolvedView = view === 'year' ? 'year' : 'month'
  const metricsError = errors.periodMetrics ?? null
  const budgetError = errors.budgetActuals ?? null

  return Object.freeze({
    period,
    view: resolvedView,
    summary: buildSummary({ periodMetrics, metricsError }),
    categories: Object.freeze(buildCategories({
      budgetActuals, budgetError, periodMetrics, metricsError,
    })),
    year: resolvedView === 'year'
      ? buildYear({ months: period.months ?? [], monthlyActuals, monthlyMetrics })
      : null,
    capabilities: buildCapabilities(),
    gaps: Object.freeze({
      plan: budgetGapSlot('plan'),
      remaining: budgetGapSlot('remaining'),
      progress: budgetGapSlot('progress'),
      pace: budgetGapSlot('pace'),
      projectedClose: budgetGapSlot('projectedClose'),
      variance: budgetGapSlot('variance'),
      rollover: budgetGapSlot('rollover'),
      allocation: budgetGapSlot('allocation'),
      yearAggregate: budgetGapSlot('yearAggregate'),
      income: budgetGapSlot('income'),
      savings: budgetGapSlot('savings'),
      categoryIdentity: budgetGapSlot('categoryIdentity'),
      categoryGroups: budgetGapSlot('categoryGroups'),
    }),
  })
}
