/**
 * NON-CONTRACTUAL canonical-shaped fixtures.
 *
 * These exist for one purpose: to render the V6 Overview deterministically in
 * the preview entry, the component tests and the visual/accessibility runs,
 * where no Supabase session exists.
 *
 * They are **not** household data and are **not** a fallback. `loadOverview`
 * never reaches for them; a caller has to pass them in explicitly. The numbers
 * are obviously synthetic and are not taken from the prototype's demo values,
 * so a screenshot can never be mistaken for a real balance.
 *
 * Every object matches the shape the corresponding canonical normaliser
 * produces, so a fixture that drifts from the contract fails the same
 * assertions live data would.
 */

const QUALITY_METADATA = Object.freeze({
  fx_basis: 'current_rate_aed',
  fx_updated_at: '2026-08-27T06:00:00Z',
  missing_fx_currencies: [],
  income_incomplete_count: 0,
  consumption_incomplete_count: 0,
  savings_movement_incomplete_count: 0,
  provisional_transaction_count: 2,
  zero_placeholder_count: 0,
  classification_version: 'shr-111-phase-a-v1',
})

function periodMetrics({ from, to, income, spend, movement, reviewCount = 0, provisional = 0, quality = 'complete' }) {
  const savings = Math.round((income - spend) * 100) / 100
  const cash = Math.round((income - spend - movement) * 100) / 100
  const rate = income > 0 ? Math.round((100 * savings / income) * 100) / 100 : null
  return Object.freeze({
    period_start: from,
    period_end: to,
    scope: 'household',
    person: null,
    posted_income_aed: income,
    consumption_spend_aed: spend,
    savings_movement_aed: movement,
    cash_retained_aed: cash,
    savings_aed: savings,
    cash_flow_aed: cash,
    savings_rate_percent: rate,
    savings_rate_reason: rate === null ? 'nonpositive_income' : null,
    quality_status: quality,
    missing_fx_count: 0,
    needs_review_count: reviewCount,
    zero_placeholder_count: 0,
    quality_metadata: Object.freeze({ ...QUALITY_METADATA, provisional_transaction_count: provisional }),
  })
}

const MONTHLY = Object.freeze({
  '2026-02': { income: 31000, spend: 21400, movement: 4000 },
  '2026-03': { income: 31000, spend: 24800, movement: 3000 },
  '2026-04': { income: 33500, spend: 19600, movement: 6000 },
  '2026-05': { income: 31000, spend: 23100, movement: 4000 },
  '2026-06': { income: 31000, spend: 27900, movement: 1500 },
  '2026-07': { income: 34200, spend: 22050, movement: 5000 },
})

export const FIXTURE_TODAY = '2026-08-28'

export const fixtureReads = Object.freeze({
  async getBalanceSheet() {
    return Object.freeze({
      scope: 'household',
      person: null,
      assets_aed: 1284300,
      liabilities_aed: 412600,
      net_worth_aed: 871700,
      quality_status: 'provisional',
      incomplete_account_count: 0,
      provisional_account_count: 1,
      missing_fx_count: 0,
      quality_metadata: Object.freeze({ fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1' }),
    })
  },
  async getInvestments() {
    return Object.freeze({
      scope: 'household',
      person: null,
      investment_value_aed: 318400,
      cost_basis_aed: 271000,
      unrealized_pnl_aed: 47400,
      quality_status: 'provisional',
      incomplete_value_count: 0,
      incomplete_pnl_count: 0,
      provisional_count: 1,
      manual_value_count: 1,
      stale_value_count: 2,
      missing_fx_count: 0,
      quality_metadata: Object.freeze({ fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1' }),
    })
  },
  async getPeriodMetrics({ from, to }) {
    const monthKey = from.slice(0, 7)
    if (MONTHLY[monthKey] && from.endsWith('-01')) {
      return periodMetrics({ from, to, ...MONTHLY[monthKey] })
    }
    return periodMetrics({ from, to, income: 34200, spend: 18825, movement: 5000, reviewCount: 3, provisional: 3, quality: 'provisional' })
  },
  async listBudgetActuals() {
    return Object.freeze([
      Object.freeze({ category: 'Housing', actual_aed: 6800, quality_status: 'complete', transaction_count: 2, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
      Object.freeze({ category: 'Groceries', actual_aed: 4310, quality_status: 'provisional', transaction_count: 18, needs_review_count: 2, zero_placeholder_count: 0, missing_fx_count: 0 }),
      Object.freeze({ category: 'Transport & Fuel', actual_aed: 3120, quality_status: 'complete', transaction_count: 9, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
      Object.freeze({ category: 'Dining Out', actual_aed: 2740, quality_status: 'complete', transaction_count: 14, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
      Object.freeze({ category: 'Utilities', actual_aed: 1265, quality_status: 'complete', transaction_count: 4, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }),
      Object.freeze({ category: 'Uncategorised', actual_aed: 590, quality_status: 'provisional', transaction_count: 3, needs_review_count: 1, zero_placeholder_count: 0, missing_fx_count: 0 }),
    ])
  },
  async listLedgerRows() {
    const row = (id, date, note, category, amount, extra = {}) => Object.freeze({
      id,
      date,
      amount,
      currency: 'AED',
      category,
      owner: 'Household',
      note,
      tags: [],
      account_id: 'fixture-account-1',
      needs_review: false,
      transaction_group_id: null,
      group_kind: null,
      transfer_direction: null,
      economic_classification: 'consumption_spend',
      classification_reason: 'categorised_consumption',
      quality_status: 'complete',
      amount_aed: amount,
      consumption_spend_aed: amount,
      savings_movement_aed: null,
      ...extra,
    })
    return Object.freeze([
      row('fixture-tx-1', '2026-08-27', 'Fixture grocery run', 'Groceries', 437, { needs_review: true, quality_status: 'provisional' }),
      row('fixture-tx-2', '2026-08-26', 'Fixture utility bill', 'Utilities', 1265),
      row('fixture-tx-3', '2026-08-25', 'Fixture fuel top-up', 'Transport & Fuel', 240),
      row('fixture-tx-4', '2026-08-24', 'Fixture card payment', 'Transfer', 3850, {
        economic_classification: 'internal_transfer',
        classification_reason: 'typed_transfer',
        consumption_spend_aed: null,
        transaction_group_id: 'fixture-group-1',
        group_kind: 'transfer',
        transfer_direction: 'out',
      }),
      row('fixture-tx-5', '2026-08-23', 'Fixture restaurant', 'Dining Out', 186),
      row('fixture-tx-6', '2026-08-22', 'Fixture savings sweep', 'Savings & Investments', 5000, {
        economic_classification: 'savings_movement',
        classification_reason: 'legacy_exact_savings_category',
        consumption_spend_aed: null,
        savings_movement_aed: 5000,
      }),
      row('fixture-tx-7', '2026-08-21', 'Fixture pharmacy', 'Health', 94),
    ])
  },
  async listAccounts() {
    const account = (id, name, type, value, extra = {}) => Object.freeze({
      id,
      name,
      owner: 'Household',
      type,
      is_liability: false,
      currency: 'AED',
      canonical_value_aed: value,
      quality_status: 'complete',
      valuation_method: 'account_balance',
      valuation_as_of: '2026-08-27T14:00:00Z',
      fx_rate_to_aed: 1,
      fx_updated_at: '2026-08-27T06:00:00Z',
      ...extra,
    })
    return Object.freeze([
      account('fixture-account-1', 'Fixture Current Account', 'bank', 61450),
      account('fixture-account-2', 'Fixture Savings Account', 'savings', 235250),
      account('fixture-account-3', 'Fixture Brokerage', 'investment', 318400, { quality_status: 'provisional', valuation_method: 'manual_account_value' }),
      account('fixture-account-4', 'Fixture Property', 'property', 669200, { valuation_as_of: '2026-06-30T09:00:00Z' }),
      account('fixture-account-5', 'Fixture Mortgage', 'mortgage', 380000, { is_liability: true }),
      account('fixture-account-6', 'Fixture Credit Card', 'credit_card', 32600, { is_liability: true }),
    ])
  },
})
