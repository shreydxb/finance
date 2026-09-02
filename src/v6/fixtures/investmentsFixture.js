/**
 * NON-CONTRACTUAL canonical-shaped fixtures for the Investments preview and
 * tests only.
 *
 * These exist so the deterministic visual and accessibility preview can render
 * without a database. They are never an application fallback, and none of the
 * frozen prototype's demo numbers appears here — not a holding name, not a
 * price, not the 611,200 portfolio figure, not the +1,840 day change. The
 * prototype's numbers are design content, not household truth, and copying one
 * into runtime data is exactly the mistake these fixtures must not normalise.
 *
 * The `owner` values are deliberately obvious nonsense strings, and the reader
 * below strips them the way the production reader's column list does. The
 * tests assert none of these strings ever reaches the screen.
 */

const METRICS = Object.freeze({
  scope: 'household',
  person: null,
  investment_value_aed: 741820.55,
  cost_basis_aed: 612430.18,
  unrealized_pnl_aed: 129390.37,
  quality_status: 'provisional',
  incomplete_value_count: 0,
  incomplete_pnl_count: 0,
  provisional_count: 1,
  manual_value_count: 1,
  stale_value_count: 0,
  missing_fx_count: 0,
  quality_metadata: Object.freeze({
    fx_basis: 'current_rate_aed',
    classification_version: 'shr-111-phase-a-v1',
    fx_updated_at: '2026-08-28T07:15:00.000Z',
    oldest_valuation_at: '2026-08-22T05:30:00.000Z',
    newest_valuation_at: '2026-08-27T20:00:00.000Z',
    missing_fx_currencies: Object.freeze([]),
  }),
})

// The portfolio shape when one position's inputs are incomplete: the contract
// withholds every monetary total and reports the counts instead.
const INCOMPLETE_METRICS = Object.freeze({
  ...METRICS,
  investment_value_aed: null,
  cost_basis_aed: null,
  unrealized_pnl_aed: null,
  quality_status: 'incomplete',
  incomplete_value_count: 1,
  incomplete_pnl_count: 1,
  missing_fx_count: 1,
  quality_metadata: Object.freeze({
    ...METRICS.quality_metadata,
    missing_fx_currencies: Object.freeze(['CHF']),
  }),
})

// The portfolio shape when the contract publishes a value and a cost basis but
// withholds the profit. It is the fixture every "unrealized P&L is never
// derived locally" test is written against: both operands of the obvious
// subtraction are present and the answer must still be withheld.
const PNL_WITHHELD_METRICS = Object.freeze({
  ...METRICS,
  unrealized_pnl_aed: null,
})

const POSITIONS = Object.freeze([
  Object.freeze({
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Fixture Global Equity Fund', ticker: 'FXTGE', type: 'investment', currency: 'USD',
    quantity: 412, last_price: 118.4,
    price_updated_at: '2026-08-27T20:00:00.000Z', price_source: 'fixture-feed',
    canonical_value_native: 48780.8, canonical_value_aed: 179147.99,
    cost_basis_native: 39140, cost_basis_aed: 143741.65,
    unrealized_pnl_native: 9640.8, unrealized_pnl_aed: 35406.34,
    quality_status: 'complete', pnl_quality_status: 'complete',
    valuation_method: 'quantity_times_last_price', valuation_as_of: '2026-08-27T20:00:00.000Z',
    freshness_status: 'timestamped', fx_rate_to_aed: 3.6725, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  Object.freeze({
    id: '40000000-0000-4000-8000-000000000002',
    name: 'Fixture Index Tracker', ticker: 'FXTIX', type: 'investment', currency: 'USD',
    quantity: 96, last_price: 612.25,
    price_updated_at: '2026-08-27T20:00:00.000Z', price_source: 'fixture-feed',
    canonical_value_native: 58776, canonical_value_aed: 215854.86,
    cost_basis_native: 47280, cost_basis_aed: 173625.3,
    unrealized_pnl_native: 11496, unrealized_pnl_aed: 42229.56,
    quality_status: 'complete', pnl_quality_status: 'complete',
    valuation_method: 'quantity_times_last_price', valuation_as_of: '2026-08-27T20:00:00.000Z',
    freshness_status: 'timestamped', fx_rate_to_aed: 3.6725, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  // A hand-priced holding: the contract publishes it as provisional, with a
  // manual valuation method and no price of its own. Its cost basis and profit
  // are still published, because quantity and average cost are recorded.
  Object.freeze({
    id: '40000000-0000-4000-8000-000000000003',
    name: 'Fixture India Portfolio', ticker: null, type: 'investment', currency: 'INR',
    quantity: 1275, last_price: null,
    price_updated_at: null, price_source: null,
    canonical_value_native: 2871400, canonical_value_aed: 126341.6,
    cost_basis_native: 2410000, cost_basis_aed: 106040,
    unrealized_pnl_native: 461400, unrealized_pnl_aed: 20301.6,
    quality_status: 'provisional', pnl_quality_status: 'provisional',
    valuation_method: 'manual_account_value', valuation_as_of: '2026-08-22T05:30:00.000Z',
    freshness_status: 'manual', fx_rate_to_aed: 0.044, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
  // A holding with a published value but no recorded cost basis: the value is
  // stated and the profit position stays empty rather than being derived.
  Object.freeze({
    id: '40000000-0000-4000-8000-000000000004',
    name: 'Fixture Metals Holding', ticker: null, type: 'investment', currency: 'AED',
    quantity: null, last_price: null,
    price_updated_at: null, price_source: null,
    canonical_value_native: 220476.1, canonical_value_aed: 220476.1,
    cost_basis_native: null, cost_basis_aed: null,
    unrealized_pnl_native: null, unrealized_pnl_aed: null,
    quality_status: 'provisional', pnl_quality_status: 'incomplete',
    valuation_method: 'manual_account_value', valuation_as_of: '2026-08-24T09:00:00.000Z',
    freshness_status: 'manual', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
])

/**
 * A native value the contract published with no AED counterpart, because
 * `settings.fx_rates` carries no rate for the currency. This is the row every
 * "native and AED are not the same fact" test is written against.
 */
const MISSING_FX_POSITION = Object.freeze({
  id: '40000000-0000-4000-8000-000000000099',
  name: 'Fixture Overseas Holding', ticker: 'FXTOS', type: 'investment', currency: 'CHF',
  quantity: 310, last_price: 127.15,
  price_updated_at: '2026-08-26T16:00:00.000Z', price_source: 'fixture-feed',
  canonical_value_native: 39416.5, canonical_value_aed: null,
  cost_basis_native: 34100, cost_basis_aed: null,
  unrealized_pnl_native: 5316.5, unrealized_pnl_aed: null,
  quality_status: 'incomplete', pnl_quality_status: 'incomplete',
  valuation_method: 'quantity_times_last_price', valuation_as_of: '2026-08-26T16:00:00.000Z',
  freshness_status: 'timestamped', fx_rate_to_aed: null, fx_updated_at: '2026-08-28T07:15:00.000Z',
})

export const INVESTMENTS_FIXTURE_POSITIONS = POSITIONS
export const INVESTMENTS_FIXTURE_MISSING_FX_POSITION = MISSING_FX_POSITION
export const INVESTMENTS_FIXTURE_METRICS = METRICS
export const INVESTMENTS_FIXTURE_PNL_WITHHELD_METRICS = PNL_WITHHELD_METRICS

/**
 * Legacy owner labels, present on the underlying table and deliberately absent
 * from every fixture row above — the production reader never selects the
 * column. Exported so a test can assert these strings appear nowhere on the
 * rendered screen.
 */
export const INVESTMENTS_FIXTURE_LEGACY_OWNER_LABELS = Object.freeze([
  'fixture-owner-label-a', 'fixture-owner-label-b', 'fixture-owner-label-c',
])

export function investmentsFixtureReadsWith(kind = 'default') {
  return Object.freeze({
    async getInvestments() {
      if (kind === 'failed' || kind === 'metrics-failed') throw new Error('fixture portfolio read failed')
      if (kind === 'incomplete') return INCOMPLETE_METRICS
      if (kind === 'pnl-withheld') return PNL_WITHHELD_METRICS
      return METRICS
    },
    async listInvestmentPositions() {
      if (kind === 'failed' || kind === 'positions-failed') throw new Error('fixture position read failed')
      if (kind === 'empty') return Object.freeze([])
      if (kind === 'incomplete') return Object.freeze([...POSITIONS, MISSING_FX_POSITION])
      return POSITIONS
    },
  })
}

export const investmentsFixtureReads = investmentsFixtureReadsWith()
