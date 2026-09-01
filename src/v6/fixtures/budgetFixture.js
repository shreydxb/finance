/**
 * NON-CONTRACTUAL canonical-shaped Budget fixtures.
 *
 * Same rule as `canonicalFixture.js`: these exist only so the deterministic
 * preview, the component tests and the responsive/accessibility runs have a
 * stable target without a Supabase session. They are not household data, and
 * they are never a fallback — `composeBudget` only ever uses reads passed to
 * it.
 *
 * None of the numbers is taken from the prototype's demo Budget, so a
 * screenshot can never be mistaken for a household figure and no prototype
 * demo value can reach the screen through this file. The prototype's demo set
 * (14,500 Housing, 9,600 Education, 55,000 planned, 46,120 spent and the rest)
 * is deliberately absent.
 *
 * The set includes the awkward cases on purpose, because those are the ones
 * that must fail closed rather than look tidy: a category the contract flags
 * provisional, the contract's own `Uncategorised` bucket alongside a real
 * household category actually named `Other`, and — in the variant reads — a
 * category whose actual is withheld for want of an FX rate, and a period whose
 * category actuals do not reconcile to the canonical period total.
 */

export const BUDGET_FIXTURE_TODAY = '2026-08-28'
export const BUDGET_FIXTURE_MONTH = Object.freeze({ year: 2026, month: 8 })

function complete(category, actual, transactions) {
  return Object.freeze({
    category,
    actual_aed: actual,
    quality_status: 'complete',
    transaction_count: transactions,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
  })
}

function provisional(category, actual, transactions, review) {
  return Object.freeze({
    category,
    actual_aed: actual,
    quality_status: 'provisional',
    transaction_count: transactions,
    needs_review_count: review,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
  })
}

/** A category whose canonical actual is withheld: no FX rate for its entries. */
function incomplete(category, transactions, missingFx) {
  return Object.freeze({
    category,
    actual_aed: null,
    quality_status: 'incomplete',
    transaction_count: transactions,
    needs_review_count: missingFx,
    zero_placeholder_count: 0,
    missing_fx_count: missingFx,
  })
}

/**
 * `Uncategorised` and `Other` both appear, on purpose.
 *
 * `Uncategorised` is the canonical contract's bucket for entries carrying no
 * category at all. `Other` is a category a household can genuinely have named.
 * They are distinct facts and the screen must never fold one into the other.
 */
const AUGUST = Object.freeze([
  complete('Housing', 6120.50, 3),
  provisional('Groceries', 3884.25, 21, 2),
  complete('Transport & Fuel', 2145.00, 11),
  complete('Dining Out', 1732.75, 16),
  complete('Utilities', 918.40, 4),
  provisional('Uncategorised', 471.10, 3, 1),
  complete('Other', 264.00, 2),
])

const MONTHS = Object.freeze({
  '2026-01': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 3410.15, 18), complete('Utilities', 874.20, 4)]),
  '2026-02': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 3688.90, 19), complete('Dining Out', 1204.30, 11)]),
  '2026-03': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 4012.05, 22), complete('Transport & Fuel', 1980.60, 10)]),
  '2026-04': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 3555.40, 17), complete('Utilities', 902.75, 4)]),
  '2026-05': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 3901.80, 20), complete('Dining Out', 1418.65, 13)]),
  '2026-06': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 4188.35, 23), complete('Transport & Fuel', 2260.90, 12)]),
  '2026-07': Object.freeze([complete('Housing', 6120.50, 3), complete('Groceries', 3742.55, 19), complete('Utilities', 941.05, 4), complete('Other', 188.20, 1)]),
  '2026-08': AUGUST,
})

const QUALITY_METADATA = Object.freeze({
  fx_basis: 'current_rate_aed',
  fx_updated_at: '2026-08-27T06:00:00Z',
  missing_fx_currencies: Object.freeze([]),
  income_incomplete_count: 0,
  consumption_incomplete_count: 0,
  savings_movement_incomplete_count: 0,
  provisional_transaction_count: 0,
  zero_placeholder_count: 0,
  classification_version: 'shr-111-phase-a-v1',
})

/**
 * The fixture's period metrics are built from the same rows the actuals read
 * returns, so the two agree the way the real contracts do. That is a property
 * of the fixture, not of the screen: `budgetModel` still checks reconciliation
 * itself and refuses to draw when it fails.
 */
function metricsFor(rows, { from, to }, drift = 0) {
  const summed = rows.every((row) => row.actual_aed !== null)
    ? Math.round(rows.reduce((running, row) => running + row.actual_aed, 0) * 100) / 100
    : null
  // `drift` models a period whose canonical total legitimately exceeds the sum
  // of the category actuals. The period row stays internally consistent — the
  // real contract would never emit one that is not — so the only thing that
  // fails is the category-to-period reconciliation the screen checks itself.
  const spend = summed === null ? null : Math.round((summed + drift) * 100) / 100
  const review = rows.reduce((running, row) => running + row.needs_review_count, 0)
  const missingFx = rows.reduce((running, row) => running + row.missing_fx_count, 0)
  const quality = spend === null ? 'incomplete' : review > 0 ? 'provisional' : 'complete'
  return Object.freeze({
    period_start: from,
    period_end: to,
    scope: 'household',
    person: null,
    posted_income_aed: 28400,
    consumption_spend_aed: spend,
    savings_movement_aed: 3200,
    cash_retained_aed: spend === null ? null : Math.round((28400 - spend - 3200) * 100) / 100,
    savings_aed: spend === null ? null : Math.round((28400 - spend) * 100) / 100,
    cash_flow_aed: spend === null ? null : Math.round((28400 - spend - 3200) * 100) / 100,
    savings_rate_percent: spend === null ? null : Math.round((100 * (28400 - spend) / 28400) * 100) / 100,
    savings_rate_reason: spend === null ? 'incomplete_inputs' : null,
    quality_status: quality,
    missing_fx_count: missingFx,
    needs_review_count: review,
    zero_placeholder_count: 0,
    quality_metadata: Object.freeze({
      ...QUALITY_METADATA,
      // The contract requires the metadata counters to agree with the
      // top-level figures, so the fixture keeps that invariant rather than
      // asserting a shape the real normaliser would reject.
      consumption_incomplete_count: spend === null ? 1 : 0,
      provisional_transaction_count: spend === null ? 0 : review,
      zero_placeholder_count: 0,
      missing_fx_currencies: missingFx > 0 ? Object.freeze(['JPY']) : Object.freeze([]),
    }),
  })
}

function monthKey(from) {
  return from.slice(0, 7)
}

function rowsFor(from, overrides) {
  const key = monthKey(from)
  if (overrides && overrides[key]) return overrides[key]
  return MONTHS[key] ?? Object.freeze([])
}

/**
 * Build a read pair over an optional month override map, so a test can inject
 * one awkward month without restating the whole year.
 */
export function budgetFixtureReadsWith(overrides = null, { breakReconciliation = false } = {}) {
  return Object.freeze({
    async listBudgetActuals({ from } = {}) {
      return rowsFor(from ?? '2026-08-01', overrides)
    },
    async getPeriodMetrics({ from, to } = {}) {
      const rows = rowsFor(from ?? '2026-08-01', overrides)
      // A period total that does not match the sum of the category actuals.
      // The screen must refuse to draw the relative bars rather than draw them
      // over a set it cannot reconcile.
      return metricsFor(rows, { from, to }, breakReconciliation ? 250 : 0)
    },
  })
}

export const budgetFixtureReads = budgetFixtureReadsWith()

/** August with one category whose canonical actual is withheld for want of FX. */
export const BUDGET_FIXTURE_INCOMPLETE_MONTH = Object.freeze({
  '2026-08': Object.freeze([...AUGUST, incomplete('Travel', 2, 2)]),
})

export { AUGUST as BUDGET_FIXTURE_AUGUST, MONTHS as BUDGET_FIXTURE_MONTHS }
