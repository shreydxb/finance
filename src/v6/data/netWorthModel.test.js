import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNetWorthGeometry, buildNetWorthModel } from './netWorthModel.js'
import { netWorthRange } from './netWorthRanges.js'

const balance = {
  assets_aed: 900, liabilities_aed: 250, net_worth_aed: 650,
  quality_status: 'provisional', incomplete_account_count: 0,
  provisional_account_count: 1, missing_fx_count: 0,
  quality_metadata: { fx_updated_at: '2026-08-28T08:00:00Z' },
}

const accounts = [
  { id: 'asset', name: 'Asset', owner: 'Legacy Person Text', type: 'property', is_liability: false, currency: 'AED', canonical_value_aed: 900, quality_status: 'provisional', valuation_method: 'account_balance', valuation_as_of: '2026-08-20T08:00:00Z', fx_updated_at: '2026-08-28T08:00:00Z' },
  { id: 'debt', name: 'Debt', owner: 'Shared', type: 'mortgage', is_liability: true, currency: 'AED', canonical_value_aed: 250, quality_status: 'complete', valuation_method: 'account_balance', valuation_as_of: '2026-08-28T08:00:00Z', fx_updated_at: '2026-08-28T08:00:00Z' },
]

const history = [
  { day: '2026-01-31', assets_aed: 700, liabilities_aed: 300, total_aed: 400, run_id: 'one', history_status: 'complete', quality_status: 'complete', snapshot_at: '2026-02-01T22:00:00Z', quality_evidence: {}, is_gap: false },
  { day: '2026-04-30', assets_aed: null, liabilities_aed: null, total_aed: null, run_id: 'skip', history_status: 'skipped', quality_status: 'skipped', snapshot_at: '2026-05-01T22:00:00Z', quality_evidence: {}, is_gap: true },
  { day: '2026-08-27', assets_aed: 880, liabilities_aed: 255, total_aed: 625, run_id: 'two', history_status: 'provisional', quality_status: 'provisional', snapshot_at: '2026-08-28T22:00:00Z', quality_evidence: {}, is_gap: false },
]

test('current canonical balance-sheet truth stays distinct from authoritative historical truth', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.equal(model.current.netWorth.value, 650)
  assert.equal(model.current.netWorth.source, 'canonical_balance_sheet.net_worth_aed')
  assert.deepEqual(model.history.rows.map((row) => row.total_aed), [625, null, 400])
  assert.notEqual(model.current.netWorth.value, model.history.rows[0].total_aed)
})

test('history preserves only supplied authoritative point boundaries and creates no missing dates', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.deepEqual(model.history.rows.map((row) => row.day), ['2026-08-27', '2026-04-30', '2026-01-31'])
  assert.equal(model.history.rows.some((row) => row.day === '2026-02-01'), false)
  assert.equal(model.history.rows.some((row) => row.day === '2026-03-31'), false)
})

test('skipped snapshot data remains missing and never becomes zero', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  const skipped = model.history.rows.find((row) => row.history_status === 'skipped')
  assert.equal(skipped.total_aed, null)
  assert.equal(skipped.assets_aed, null)
  assert.equal(skipped.liabilities_aed, null)
})

test('Provisional remains Provisional and is not converted to error, anomaly or attention', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.equal(model.current.quality, 'provisional')
  assert.equal(model.history.rows[0].history_status, 'provisional')
  assert.doesNotMatch(JSON.stringify(model), /anomaly|attention|incorrect|broken|invalid/i)
})

test('unsupported change, saved, composition, scope and freshness positions fail closed', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.equal(model.current.change.status, 'unavailable')
  assert.match(model.current.change.gap.contract, /SHR-173 \/ SHR-153/)
  assert.match(model.current.composition.gap.contract, /SHR-173/)
  assert.match(model.current.scope.gap.contract, /SHR-156 \/ SHR-173/)
  assert.match(model.provenance.gap.contract, /SHR-172 \/ SHR-173/)
  assert.match(model.freshness.gap.contract, /SHR-173/)
  for (const row of model.history.rows) {
    assert.equal(row.change.status, 'unavailable')
    assert.equal(row.saved.status, 'unavailable')
  }
})

test('legacy owner text never enters the V6 account position model', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.equal(Object.hasOwn(model.accounts.assets[0], 'owner'), false)
  assert.equal(JSON.stringify(model).includes('Legacy Person Text'), false)
  assert.equal(JSON.stringify(model).includes('Shared'), false)
})

test('canonical asset and liability classifications are consumed without local sign reinterpretation', () => {
  const model = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), balanceSheet: balance, accounts, history })
  assert.deepEqual(model.accounts.assets.map((row) => [row.id, row.value.value]), [['asset', 900]])
  assert.deepEqual(model.accounts.liabilities.map((row) => [row.id, row.value.value]), [['debt', 250]])
  assert.equal(model.current.liabilities.value, 250)
})

test('drawing-only geometry returns placement ratios and no invented financial field', () => {
  const geometry = buildNetWorthGeometry(history)
  assert.equal(geometry.length, history.length)
  assert.equal(geometry[1].missing, true)
  for (const point of geometry) {
    assert.deepEqual(Object.keys(point).sort(), ['assetHeight', 'day', 'liabilityHeight', 'missing', 'netY', 'status', 'x'])
    assert.equal(Object.hasOwn(point, 'value'), false)
    assert.equal(Object.hasOwn(point, 'change'), false)
  }
})

test('range windows are calendar filters and All keeps the full authoritative read open', () => {
  assert.deepEqual(netWorthRange('6m', '2026-08-28'), { key: '6m', label: '6M', from: '2026-03-01', to: '2026-08-28' })
  assert.deepEqual(netWorthRange('ytd', '2026-08-28'), { key: 'ytd', label: 'YTD', from: '2026-01-01', to: '2026-08-28' })
  assert.deepEqual(netWorthRange('all', '2026-08-28'), { key: 'all', label: 'All', from: null, to: '2026-08-28' })
})

test('incomplete current values and failed reads never receive a plausible fallback', () => {
  const incomplete = buildNetWorthModel({
    range: netWorthRange('1y', '2026-08-28'),
    balanceSheet: { ...balance, assets_aed: null, liabilities_aed: null, net_worth_aed: null, quality_status: 'incomplete' },
    accounts: [], history: [],
  })
  assert.equal(incomplete.current.netWorth.status, 'incomplete')
  assert.equal(Object.hasOwn(incomplete.current.netWorth, 'value'), false)
  assert.match(incomplete.history.change.gap.contract, /SHR-173 \/ SHR-153/)
  assert.match(incomplete.history.saved.gap.contract, /SHR-173 \/ SHR-153/)
  const failed = buildNetWorthModel({ range: netWorthRange('1y', '2026-08-28'), errors: { balanceSheet: 'failed', accounts: 'failed', history: 'failed' } })
  assert.equal(failed.current.netWorth.status, 'unavailable')
  assert.equal(failed.accounts.status, 'unavailable')
  assert.equal(failed.history.status, 'unavailable')
})
