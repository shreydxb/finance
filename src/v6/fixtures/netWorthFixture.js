/** NON-CONTRACTUAL canonical-shaped fixtures for Net Worth preview/tests only. */

export const NET_WORTH_FIXTURE_TODAY = '2026-08-28'

const BALANCE = Object.freeze({
  scope: 'household', person: null,
  assets_aed: 2500000, liabilities_aed: 450000, net_worth_aed: 2050000,
  quality_status: 'provisional', incomplete_account_count: 0,
  provisional_account_count: 1, missing_fx_count: 0,
  quality_metadata: Object.freeze({
    fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1',
    fx_updated_at: '2026-08-28T07:15:00.000Z',
  }),
})

const ACCOUNTS = Object.freeze([
  Object.freeze({ id: '10000000-0000-4000-8000-000000000001', name: 'Home', owner: 'fixture-label-a', type: 'property', is_liability: false, currency: 'AED', canonical_value_aed: 1640000, quality_status: 'complete', valuation_method: 'account_balance', valuation_as_of: '2026-08-27T12:00:00.000Z', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000002', name: 'Brokerage', owner: 'fixture-label-b', type: 'investment', is_liability: false, currency: 'USD', canonical_value_aed: 610000, quality_status: 'complete', valuation_method: 'quantity_times_last_price', valuation_as_of: '2026-08-27T20:00:00.000Z', fx_rate_to_aed: 3.6725, fx_updated_at: '2026-08-28T07:15:00.000Z' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000003', name: 'Emergency reserve', owner: 'fixture-label-a', type: 'cash', is_liability: false, currency: 'AED', canonical_value_aed: 250000, quality_status: 'provisional', valuation_method: 'account_balance', valuation_as_of: '2026-08-18T08:30:00.000Z', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000004', name: 'Home loan', owner: 'fixture-label-a', type: 'mortgage', is_liability: true, currency: 'AED', canonical_value_aed: 420000, quality_status: 'complete', valuation_method: 'account_balance', valuation_as_of: '2026-08-26T10:00:00.000Z', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000005', name: 'Card balance', owner: 'fixture-label-b', type: 'credit_card', is_liability: true, currency: 'AED', canonical_value_aed: 30000, quality_status: 'complete', valuation_method: 'account_balance', valuation_as_of: '2026-08-28T06:00:00.000Z', fx_rate_to_aed: 1, fx_updated_at: '2026-08-28T07:15:00.000Z' }),
])

const HISTORY = Object.freeze([
  Object.freeze({ day: '2025-09-30', assets_aed: 2200000, liabilities_aed: 510000, total_aed: 1690000, run_id: null, snapshot_at: null, published_at: null, quality_status: 'legacy', history_status: 'legacy', source_version: null, quality_evidence: null, input_digest: null, is_gap: false }),
  Object.freeze({ day: '2025-12-31', assets_aed: 2280000, liabilities_aed: 495000, total_aed: 1785000, run_id: '20000000-0000-4000-8000-000000000001', snapshot_at: '2026-01-01T22:05:00.000Z', published_at: '2026-01-01T22:05:02.000Z', quality_status: 'complete', history_status: 'complete', source_version: 'shr-113-phase-a-v1', quality_evidence: Object.freeze({ policy_version: 'shr-113-snapshot-policy-v1' }), input_digest: 'fixture-digest-1', is_gap: false }),
  Object.freeze({ day: '2026-02-28', assets_aed: 2320000, liabilities_aed: 485000, total_aed: 1835000, run_id: '20000000-0000-4000-8000-000000000002', snapshot_at: '2026-03-01T22:05:00.000Z', published_at: '2026-03-01T22:05:02.000Z', quality_status: 'provisional', history_status: 'provisional', source_version: 'shr-113-phase-a-v1', quality_evidence: Object.freeze({ policy_version: 'shr-113-snapshot-policy-v1', provisional_account_count: 1 }), input_digest: 'fixture-digest-2', is_gap: false }),
  Object.freeze({ day: '2026-04-30', assets_aed: null, liabilities_aed: null, total_aed: null, run_id: '20000000-0000-4000-8000-000000000003', snapshot_at: '2026-05-01T22:05:00.000Z', published_at: null, quality_status: 'skipped', history_status: 'skipped', source_version: null, quality_evidence: Object.freeze({ policy_version: 'shr-113-snapshot-policy-v1' }), input_digest: null, is_gap: true }),
  Object.freeze({ day: '2026-06-30', assets_aed: 2440000, liabilities_aed: 465000, total_aed: 1975000, run_id: '20000000-0000-4000-8000-000000000004', snapshot_at: '2026-07-01T22:05:00.000Z', published_at: '2026-07-01T22:05:02.000Z', quality_status: 'complete', history_status: 'complete', source_version: 'shr-113-phase-a-v1', quality_evidence: Object.freeze({ policy_version: 'shr-113-snapshot-policy-v1' }), input_digest: 'fixture-digest-4', is_gap: false }),
  Object.freeze({ day: '2026-08-27', assets_aed: 2490000, liabilities_aed: 452000, total_aed: 2038000, run_id: '20000000-0000-4000-8000-000000000005', snapshot_at: '2026-08-28T22:05:00.000Z', published_at: '2026-08-28T22:05:02.000Z', quality_status: 'provisional', history_status: 'provisional', source_version: 'shr-113-phase-a-v1', quality_evidence: Object.freeze({ policy_version: 'shr-113-snapshot-policy-v1', provisional_account_count: 1 }), input_digest: 'fixture-digest-5', is_gap: false }),
])

export function netWorthFixtureReadsWith(kind = 'default') {
  return Object.freeze({
    async getBalanceSheet() {
      if (kind === 'failed') throw new Error('fixture balance read failed')
      if (kind === 'incomplete') return Object.freeze({ ...BALANCE, assets_aed: null, liabilities_aed: null, net_worth_aed: null, quality_status: 'incomplete', incomplete_account_count: 1 })
      return BALANCE
    },
    async listAccounts() {
      if (kind === 'failed') throw new Error('fixture account read failed')
      if (kind === 'empty') return Object.freeze([])
      if (kind === 'incomplete') return Object.freeze([
        ...ACCOUNTS,
        Object.freeze({ ...ACCOUNTS[0], id: '10000000-0000-4000-8000-000000000099', name: 'Unavailable asset', canonical_value_aed: null, quality_status: 'incomplete' }),
      ])
      return ACCOUNTS
    },
    async listNetWorthHistory({ from, to } = {}) {
      if (kind === 'failed') throw new Error('fixture snapshot read failed')
      if (kind === 'empty') return Object.freeze([])
      return Object.freeze(HISTORY.filter((row) => (!from || row.day >= from) && (!to || row.day <= to)))
    },
  })
}

export const netWorthFixtureReads = netWorthFixtureReadsWith()
