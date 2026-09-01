/**
 * NON-CONTRACTUAL canonical-shaped Insights fixtures.
 *
 * Preview and test entry points inject these explicitly. The production
 * screen defaults to `canonicalReads`, so none of these values can become a
 * fallback in the real application path. No value or conclusion is copied
 * from the frozen prototype.
 */

export const INSIGHTS_FIXTURE_TODAY = '2026-08-28'
export const INSIGHTS_FIXTURE_PERIOD = Object.freeze({ year: 2026, month: 8, quarter: 3 })

const CATEGORIES = Object.freeze([
  Object.freeze({ category: 'Housing', actual_aed: 6120.50, quality_status: 'complete', transaction_count: 3, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Groceries', actual_aed: 3884.25, quality_status: 'provisional', transaction_count: 21, needs_review_count: 2, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Transport & Fuel', actual_aed: 2145.00, quality_status: 'complete', transaction_count: 11, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Dining Out', actual_aed: 1732.75, quality_status: 'complete', transaction_count: 16, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Utilities', actual_aed: 918.40, quality_status: 'complete', transaction_count: 4, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Uncategorised', actual_aed: 471.10, quality_status: 'provisional', transaction_count: 3, needs_review_count: 1, zero_placeholder_count: 0, missing_fx_count: 0 }),
  Object.freeze({ category: 'Other', actual_aed: 264.00, quality_status: 'complete', transaction_count: 2, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
])

const HISTORY = Object.freeze({
  '2026-02': Object.freeze({ spend: 12841.60, income: 27120 }),
  '2026-03': Object.freeze({ spend: 14932.45, income: 27880 }),
  '2026-04': Object.freeze({ spend: 13744.20, income: 26540 }),
  '2026-05': Object.freeze({ spend: 15108.35, income: 28960 }),
  '2026-06': Object.freeze({ spend: 14266.90, income: 28110 }),
  '2026-07': Object.freeze({ spend: 14721.75, income: 27630 }),
})

function metrics({ from, to, spend, income, quality = 'complete', review = 0, missingFx = 0 }) {
  return Object.freeze({
    period_start: from,
    period_end: to,
    scope: 'household',
    person: null,
    posted_income_aed: income,
    consumption_spend_aed: spend,
    quality_status: quality,
    needs_review_count: review,
    zero_placeholder_count: 0,
    missing_fx_count: missingFx,
    quality_metadata: Object.freeze({
      missing_fx_currencies: missingFx ? Object.freeze(['JPY']) : Object.freeze([]),
    }),
  })
}

function selectedMetrics(from, to) {
  return metrics({ from, to, spend: 15536, income: 28400, quality: 'provisional', review: 3 })
}

function historyMetrics(from, to) {
  const values = HISTORY[from.slice(0, 7)] ?? Object.freeze({ spend: 13219.25, income: 26950 })
  return metrics({ from, to, spend: values.spend, income: values.income })
}

export function insightsFixtureReadsWith(kind = 'default') {
  return Object.freeze({
    async listBudgetActuals() {
      if (kind === 'failed') throw new Error('category actuals offline')
      if (kind === 'empty') return Object.freeze([])
      if (kind === 'incomplete') {
        return Object.freeze([
          ...CATEGORIES,
          Object.freeze({ category: 'Travel', actual_aed: null, quality_status: 'incomplete', transaction_count: 2, needs_review_count: 2, zero_placeholder_count: 0, missing_fx_count: 2 }),
        ])
      }
      return CATEGORIES
    },
    async getPeriodMetrics({ from, to } = {}) {
      if (kind === 'failed') throw new Error('period metrics offline')
      if (kind === 'incomplete' && from === '2026-08-01') {
        return metrics({ from, to, spend: null, income: null, quality: 'incomplete', review: 5, missingFx: 2 })
      }
      return from === '2026-08-01' ? selectedMetrics(from, to) : historyMetrics(from, to)
    },
  })
}

export const insightsFixtureReads = insightsFixtureReadsWith()
export { CATEGORIES as INSIGHTS_FIXTURE_CATEGORIES }
