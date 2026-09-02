/**
 * NON-CONTRACTUAL canonical-shaped fixtures for the Accounts preview and
 * tests only.
 *
 * These exist so the deterministic visual and accessibility preview can render
 * without a database. They are never an application fallback, and none of the
 * frozen prototype's demo balances appears here: the prototype's numbers are
 * design content, not household truth, and copying one into runtime data is
 * exactly the mistake these fixtures must not normalise.
 *
 * The `owner` values are deliberately obvious nonsense strings. The V6 model
 * discards the legacy owner label, and the tests assert that none of these
 * strings ever reaches the screen.
 */

const BALANCE = Object.freeze({
  scope: 'household', person: null,
  assets_aed: 2669785, liabilities_aed: 531203, net_worth_aed: 2138582,
  quality_status: 'provisional', incomplete_account_count: 0,
  provisional_account_count: 1, missing_fx_count: 0,
  quality_metadata: Object.freeze({
    fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1',
    fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
})

const INCOMPLETE_BALANCE = Object.freeze({
  ...BALANCE,
  assets_aed: null, liabilities_aed: null, net_worth_aed: null,
  quality_status: 'incomplete', incomplete_account_count: 1, missing_fx_count: 1,
})

const ACCOUNTS = Object.freeze([
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000001', name: 'Residence · Fixture Gardens', owner: 'fixture-label-a',
    type: 'property', is_liability: false, currency: 'AED',
    canonical_value_native: 1846500, canonical_value_aed: 1846500, quality_status: 'complete',
    valuation_method: 'manual_account_value', valuation_as_of: '2026-06-30T09:00:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000002', name: 'Fixture Brokerage · Global', owner: 'fixture-label-b',
    type: 'investment', is_liability: false, currency: 'USD',
    canonical_value_native: 118250, canonical_value_aed: 434273.13, quality_status: 'complete',
    valuation_method: 'quantity_times_last_price', valuation_as_of: '2026-08-27T20:00:00.000Z',
    freshness_status: 'timestamped', fx_rate_to_aed: 3.6725, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000003', name: 'Fixture Portfolio · India', owner: 'fixture-label-c',
    type: 'investment', is_liability: false, currency: 'INR',
    canonical_value_native: 2871400, canonical_value_aed: 126341.6, quality_status: 'provisional',
    valuation_method: 'manual_account_value', valuation_as_of: '2026-08-22T05:30:00.000Z',
    freshness_status: 'manual', fx_rate_to_aed: 0.044, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000004', name: 'Fixture Savings', owner: 'fixture-label-a',
    type: 'savings', is_liability: false, currency: 'AED',
    canonical_value_native: 187325, canonical_value_aed: 187325, quality_status: 'complete',
    valuation_method: 'account_balance', valuation_as_of: '2026-08-28T06:10:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000005', name: 'Fixture Current', owner: 'fixture-label-b',
    type: 'bank', is_liability: false, currency: 'AED',
    canonical_value_native: 71640, canonical_value_aed: 71640, quality_status: 'complete',
    valuation_method: 'account_balance', valuation_as_of: '2026-08-28T06:10:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000006', name: 'Fixture Cash', owner: 'fixture-label-c',
    type: 'cash', is_liability: false, currency: 'AED',
    canonical_value_native: 4215, canonical_value_aed: 4215, quality_status: 'complete',
    valuation_method: 'account_balance', valuation_as_of: '2026-08-25T11:00:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000007', name: 'Fixture Credit Card', owner: 'fixture-label-a',
    type: 'credit_card', is_liability: true, currency: 'AED',
    canonical_value_native: 12483, canonical_value_aed: 12483, quality_status: 'complete',
    valuation_method: 'account_balance', valuation_as_of: '2026-08-28T06:10:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '30000000-0000-4000-8000-000000000008', name: 'Fixture Mortgage', owner: 'fixture-label-b',
    type: 'mortgage', is_liability: true, currency: 'AED',
    canonical_value_native: 518720, canonical_value_aed: 518720, quality_status: 'complete',
    valuation_method: 'account_balance', valuation_as_of: '2026-08-28T06:10:00.000Z',
    freshness_status: 'account_balance', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
])

// A native value the contract published with no AED counterpart, because
// settings.fx_rates carries no rate for the currency. This is the row every
// "native and AED are not the same fact" test is written against.
const MISSING_FX_ACCOUNT = Object.freeze({
  id: '30000000-0000-4000-8000-000000000099', name: 'Fixture Overseas Holding', owner: 'fixture-label-c',
  type: 'bank', is_liability: false, currency: 'CHF',
  canonical_value_native: 39415, canonical_value_aed: null, quality_status: 'incomplete',
  valuation_method: 'account_balance', valuation_as_of: '2026-08-24T09:00:00.000Z',
  freshness_status: 'account_balance', fx_rate_to_aed: null, fx_updated_at: '2026-08-28T07:15:00.000Z',
})

export const ACCOUNTS_FIXTURE_ROWS = ACCOUNTS
export const ACCOUNTS_FIXTURE_MISSING_FX_ROW = MISSING_FX_ACCOUNT
export const ACCOUNTS_FIXTURE_BALANCE = BALANCE

export function accountsFixtureReadsWith(kind = 'default') {
  return Object.freeze({
    async getBalanceSheet() {
      if (kind === 'failed') throw new Error('fixture balance read failed')
      if (kind === 'incomplete') return INCOMPLETE_BALANCE
      return BALANCE
    },
    async listAccounts() {
      if (kind === 'failed') throw new Error('fixture account read failed')
      if (kind === 'empty') return Object.freeze([])
      if (kind === 'incomplete') return Object.freeze([...ACCOUNTS, MISSING_FX_ACCOUNT])
      return ACCOUNTS
    },
  })
}

export const accountsFixtureReads = accountsFixtureReadsWith()
