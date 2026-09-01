/**
 * NON-CONTRACTUAL canonical-shaped Recurring fixtures.
 *
 * Same rule as `canonicalFixture.js` and `budgetFixture.js`: these exist only
 * so the deterministic preview, the component tests and the responsive and
 * accessibility runs have a stable target without a Supabase session. They are
 * not household data, and they are never a fallback — `composeRecurring` only
 * ever uses reads passed to it.
 *
 * There is deliberately no recurring-plan fixture in this file, and no shape
 * for one. Recurring plans have no approved contract, so a fixture for them
 * would be a fixture for a shape nobody has agreed — and once it existed, the
 * screen could be made to look finished by rendering it. The screen must look
 * exactly as unfinished as the contracts actually are.
 *
 * The one fixture here is `canonical_period_metrics`, which the screen really
 * does read. None of its numbers is taken from the prototype's demo Recurring
 * set (29,400 committed, 78,400 expected income, 20,860 fixed, 25,260
 * variable, 6,850 mortgage, 8,940 card, 9,600 school fee and the rest), so no
 * prototype demo value can reach the screen through this file.
 */

export const RECURRING_FIXTURE_TODAY = '2026-08-28'
export const RECURRING_FIXTURE_MONTH = Object.freeze({ year: 2026, month: 8 })

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
 * A canonical period row that satisfies the real contract's own invariants,
 * so the fixture can never assert a shape `normalizeCanonicalPeriodResponse`
 * would reject.
 *
 * `spend === null` models the contract legitimately withholding the period's
 * consumption spend because its inputs are incomplete. That is the case the
 * screen has to state rather than render as zero, so it is a first-class
 * fixture rather than an afterthought.
 */
function metricsFor({ from, to }, { spend = 21486.35, review = 0, missingFx = 0 } = {}) {
  const income = 31240
  const savingsMovement = 4100
  const quality = spend === null ? 'incomplete' : review > 0 ? 'provisional' : 'complete'
  const round = (value) => Math.round(value * 100) / 100
  return Object.freeze({
    period_start: from,
    period_end: to,
    scope: 'household',
    person: null,
    posted_income_aed: income,
    consumption_spend_aed: spend,
    savings_movement_aed: savingsMovement,
    cash_retained_aed: spend === null ? null : round(income - spend - savingsMovement),
    savings_aed: spend === null ? null : round(income - spend),
    cash_flow_aed: spend === null ? null : round(income - spend - savingsMovement),
    savings_rate_percent: spend === null ? null : round(100 * (income - spend) / income),
    savings_rate_reason: spend === null ? 'incomplete_inputs' : null,
    quality_status: quality,
    missing_fx_count: missingFx,
    needs_review_count: review,
    zero_placeholder_count: 0,
    quality_metadata: Object.freeze({
      ...QUALITY_METADATA,
      consumption_incomplete_count: spend === null ? 1 : 0,
      provisional_transaction_count: spend === null ? 0 : review,
      missing_fx_currencies: missingFx > 0 ? Object.freeze(['JPY']) : Object.freeze([]),
    }),
  })
}

export function recurringFixtureReadsWith(overrides = {}) {
  return Object.freeze({
    async getPeriodMetrics({ from, to }) {
      return metricsFor({ from, to }, overrides)
    },
  })
}

export const recurringFixtureReads = recurringFixtureReadsWith()

/** The contract withholds the period's consumption spend: inputs incomplete. */
export const recurringFixtureReadsIncomplete = recurringFixtureReadsWith({ spend: null, missingFx: 2 })

/** A period the contract flags provisional because entries await review. */
export const recurringFixtureReadsProvisional = recurringFixtureReadsWith({ spend: 19204.80, review: 3 })

export const recurringFixtureReadsFailed = Object.freeze({
  async getPeriodMetrics() { throw new Error('period metrics offline') },
})
