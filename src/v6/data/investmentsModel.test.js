import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInvestmentsModel, resolveHoldingDetail } from './investmentsModel.js'
import { composeInvestments } from './composeInvestments.js'
import { normalizeCanonicalInvestmentPositionRows } from '../../lib/canonicalContracts.js'
import {
  INVESTMENTS_FIXTURE_METRICS,
  INVESTMENTS_FIXTURE_MISSING_FX_POSITION,
  INVESTMENTS_FIXTURE_POSITIONS,
  investmentsFixtureReadsWith,
} from '../fixtures/investmentsFixture.js'

function modelFrom(kind = 'default') {
  return composeInvestments({ reads: investmentsFixtureReadsWith(kind) })
}

function normalized(rows = INVESTMENTS_FIXTURE_POSITIONS) {
  return normalizeCanonicalInvestmentPositionRows(rows)
}

test('the portfolio total is read from the published contract field', async () => {
  const model = await modelFrom()
  assert.equal(model.totals.value.status, 'available')
  assert.equal(model.totals.value.value, INVESTMENTS_FIXTURE_METRICS.investment_value_aed)
  assert.equal(model.totals.value.source, 'canonical_investment_metrics.investment_value_aed')
})

test('a withheld portfolio total is never backfilled by summing the rows', async () => {
  // The decisive case for "the total is not a sum". One position's inputs are
  // incomplete, so the contract withholds every monetary total and reports the
  // counts instead — while the other four positions still publish AED values
  // and still render. A browser-side sum would find those four operands
  // sitting right there and produce a confident, plausible, quietly-too-low
  // portfolio figure. The total must stay withheld instead.
  const model = await modelFrom('incomplete')
  assert.equal(model.totals.value.status, 'incomplete')
  assert.ok(!('value' in model.totals.value))

  const summable = model.positions.rows.filter((row) => row.aed.status === 'available')
  assert.ok(summable.length >= 4, 'the incomplete fixture must still expose summable rows')
  const wouldHaveBeen = summable.reduce((total, row) => total + row.aed.value, 0)
  assert.ok(wouldHaveBeen > 0, 'a browser-side sum would have produced a plausible figure here')
})

test('unrealized profit is the published figure, read from its own contract field', async () => {
  const model = await modelFrom()
  assert.equal(model.totals.unrealizedPnl.status, 'available')
  assert.equal(model.totals.unrealizedPnl.value, INVESTMENTS_FIXTURE_METRICS.unrealized_pnl_aed)
  assert.equal(model.totals.unrealizedPnl.source, 'canonical_investment_metrics.unrealized_pnl_aed')
})

test('unrealized profit stays withheld when both operands of the obvious subtraction are present', async () => {
  // The decisive case. The contract publishes the portfolio value and the cost
  // basis but withholds the profit, so `value - costBasis` is available to any
  // component willing to compute it. It must not be computed: a locally
  // derived figure would agree with the contract most of the time and diverge
  // silently exactly when the contract's quality rules said it should.
  const model = await modelFrom('pnl-withheld')
  assert.equal(model.totals.value.status, 'available')
  assert.equal(model.totals.costBasis.status, 'available')
  assert.equal(model.totals.unrealizedPnl.status, 'incomplete')
  assert.ok(!('value' in model.totals.unrealizedPnl))
})

test('an incomplete portfolio withholds every monetary total and keeps its counters', async () => {
  const model = await modelFrom('incomplete')
  for (const key of ['value', 'costBasis', 'unrealizedPnl']) {
    assert.equal(model.totals[key].status, 'incomplete', `${key} must be withheld`)
    assert.ok(!('value' in model.totals[key]), `${key} must carry no figure`)
  }
  assert.equal(model.totals.quality, 'incomplete')
  assert.equal(model.totals.incompleteValueCount, 1)
  assert.deepEqual([...model.totals.missingFxCurrencies], ['CHF'])
})

test('a position with no published FX rate keeps its AED position empty and its native figure', async () => {
  const model = await modelFrom('incomplete')
  const row = model.positions.rows.find((candidate) => candidate.id === INVESTMENTS_FIXTURE_MISSING_FX_POSITION.id)
  assert.ok(row, 'the missing-FX position must still be listed')
  assert.equal(row.aed.status, 'incomplete')
  assert.match(row.aed.reason, /No published FX rate for CHF/)
  // The native fact survives and is never relabelled as AED.
  assert.equal(row.native.status, 'available')
  assert.equal(row.native.value, INVESTMENTS_FIXTURE_MISSING_FX_POSITION.canonical_value_native)
  assert.equal(row.currency, 'CHF')
  assert.equal(row.costBasisAed.status, 'incomplete')
  assert.equal(row.unrealizedPnlAed.status, 'incomplete')
})

test('the contract may never publish an AED figure without FX evidence', () => {
  assert.throws(
    () => normalized([{ ...INVESTMENTS_FIXTURE_MISSING_FX_POSITION, canonical_value_aed: 144800 }]),
    /without published FX evidence/,
  )
})

test('a row that is not the canonical investment type is rejected', () => {
  assert.throws(
    () => normalized([{ ...INVESTMENTS_FIXTURE_POSITIONS[0], type: 'savings' }]),
    /not a canonical investment position/,
  )
})

test('duplicate position identifiers are rejected so no holding is counted twice', () => {
  assert.throws(
    () => normalized([INVESTMENTS_FIXTURE_POSITIONS[0], INVESTMENTS_FIXTURE_POSITIONS[0]]),
    /duplicate IDs/,
  )
})

test('a holding with no recorded cost basis states the value and withholds the profit', async () => {
  const model = await modelFrom()
  const row = model.positions.rows.find((candidate) => candidate.name === 'Fixture Metals Holding')
  assert.ok(row)
  assert.equal(row.aed.status, 'available')
  assert.equal(row.costBasisAed.status, 'incomplete')
  assert.equal(row.unrealizedPnlAed.status, 'incomplete')
  // Cost basis and profit are withheld together: publishing one without the
  // other invites the subtraction this screen must never perform.
  assert.equal(row.costBasisAed.reason, row.unrealizedPnlAed.reason)
})

test('published per-position figures are read exactly as the contract stated them', async () => {
  const model = await modelFrom()
  const row = model.positions.rows.find((candidate) => candidate.name === 'Fixture Global Equity Fund')
  const source = INVESTMENTS_FIXTURE_POSITIONS[0]
  assert.equal(row.aed.value, source.canonical_value_aed)
  assert.equal(row.costBasisAed.value, source.cost_basis_aed)
  assert.equal(row.unrealizedPnlAed.value, source.unrealized_pnl_aed)
  assert.equal(row.quantity.value, source.quantity)
  assert.equal(row.price.value, source.last_price)
  // The row carries the contract's published value, and it carries the price,
  // quantity and FX rate beside it purely as evidence. The published AED value
  // is asserted against the contract field it came from — never against a
  // product of those operands, because reproducing that product here is the
  // valuation engine this screen must not contain.
  assert.equal(row.aed.source, 'v_canonical_accounts_aed.canonical_value_aed')
  assert.equal(row.native.value, source.canonical_value_native)
  assert.equal(row.fxRate, source.fx_rate_to_aed)
  assert.equal(row.priceSource, 'fixture-feed')
  assert.equal(row.priceCurrency, 'USD')
})

test('ownership, weight and day change are gaps on every row, never values', async () => {
  const model = await modelFrom()
  for (const row of model.positions.rows) {
    assert.equal(row.ownership.status, 'unavailable')
    assert.match(row.ownership.gap.contract, /SHR-154 \/ SHR-156/)
    assert.equal(row.weight.status, 'unavailable')
    assert.match(row.weight.gap.contract, /SHR-174/)
    assert.equal(row.dayChange.status, 'unavailable')
    assert.match(row.dayChange.gap.contract, /SHR-176/)
    assert.ok(!('owner' in row), 'the legacy owner label must not reach the model')
  }
})

test('missing performance, allocation and scope truth name their owning contracts', async () => {
  const model = await modelFrom()
  assert.match(model.gaps.performanceHistory.gap.contract, /SHR-176/)
  assert.match(model.gaps.returnMetrics.gap.contract, /SHR-176/)
  assert.match(model.gaps.dayChange.gap.contract, /SHR-176/)
  assert.match(model.gaps.allocation.gap.contract, /SHR-174/)
  assert.match(model.gaps.assetClass.gap.contract, /SHR-174/)
  assert.match(model.gaps.pnlPercent.gap.contract, /SHR-174/)
  assert.match(model.gaps.container.gap.contract, /SHR-174 \/ SHR-172/)
  assert.match(model.gaps.scope.gap.contract, /SHR-156 \/ SHR-173/)
  assert.match(model.gaps.ownership.gap.contract, /SHR-154 \/ SHR-156/)
  assert.match(model.gaps.freshness.gap.contract, /SHR-172 \/ SHR-173/)
  assert.match(model.gaps.priceProvenance.gap.contract, /SHR-172/)
})

test('every prototype write is a named unsupported capability', async () => {
  const model = await modelFrom()
  for (const key of ['addHolding', 'editHolding', 'refreshPrices', 'recordTrade']) {
    assert.equal(model.capabilities[key].status, 'unavailable', `${key} must be unsupported`)
    assert.match(model.capabilities[key].gap.contract, /SHR-172 \/ SHR-174/)
  }
})

test('each read fails independently without erasing the other', async () => {
  const positionsFailed = await modelFrom('positions-failed')
  assert.equal(positionsFailed.positions.status, 'unavailable')
  assert.match(positionsFailed.positions.reason, /No legacy investment reader/)
  // The published totals survive a failed position read.
  assert.equal(positionsFailed.totals.value.status, 'available')

  const metricsFailed = await modelFrom('metrics-failed')
  assert.equal(metricsFailed.totals.value.status, 'unavailable')
  assert.equal(metricsFailed.positions.status, 'available')
})

test('an empty canonical set is empty, not an error', async () => {
  const model = await modelFrom('empty')
  assert.equal(model.positions.status, 'empty')
  assert.equal(model.summary.holdingCount, null)
})

test('a deep link to an unknown holding fails closed', async () => {
  const model = await modelFrom()
  const unknown = resolveHoldingDetail(model, '40000000-0000-4000-8000-00000000dead')
  assert.equal(unknown.status, 'unavailable')
  assert.match(unknown.slot.gap.contract, /SHR-202/)
  assert.equal(unknown.row, null)

  const found = resolveHoldingDetail(model, INVESTMENTS_FIXTURE_POSITIONS[0].id)
  assert.equal(found.status, 'found')
  assert.equal(found.row.name, 'Fixture Global Equity Fund')
})

test('the model requires approved reads and never invents its own', async () => {
  await assert.rejects(() => composeInvestments({}), /requires approved reads/)
  const bare = buildInvestmentsModel({})
  assert.equal(bare.positions.status, 'unavailable')
  assert.equal(bare.totals.value.status, 'incomplete')
})

test('the staleness counter reports the absence of a policy, not a clean bill of health', async () => {
  const model = await modelFrom()
  // The consumer supplies no staleness boundary, so the contract's own count is
  // zero by construction. The model carries it as published and never converts
  // it into a freshness verdict.
  assert.equal(model.totals.staleValueCount, 0)
  assert.equal(model.gaps.freshness.status, 'unavailable')
})
