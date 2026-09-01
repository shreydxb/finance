import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeCanonicalAccountRows,
  normalizeCanonicalBalanceSheet,
  normalizeCanonicalBudgetRows,
  normalizeCanonicalInvestmentMetrics,
  normalizeCanonicalLedgerRows,
  normalizeCanonicalPeriodResponse,
} from '../../lib/canonicalContracts.js'
import { FIXTURE_TODAY, fixtureReads } from '../fixtures/canonicalFixture.js'
import { composeOverview } from './composeOverview.js'
import { buildCashFlowGeometry, buildOverviewModel, buildQualitySignals } from './overviewModel.js'
import { OVERVIEW_GAPS } from './gaps.js'
import { periodToDateRange, trailingCompletedMonths } from './periods.js'

const PERIOD = periodToDateRange('mtd', FIXTURE_TODAY)

/* ── Period ranges ──────────────────────────────────────────────────────── */

test('period-to-date ranges end today, never at the end of the calendar period', () => {
  assert.deepEqual(periodToDateRange('mtd', '2026-08-28'), {
    key: 'mtd', from: '2026-08-01', to: '2026-08-28', title: 'Month to date',
  })
  assert.equal(periodToDateRange('qtd', '2026-08-28').from, '2026-07-01')
  assert.equal(periodToDateRange('ytd', '2026-08-28').from, '2026-01-01')
  for (const key of ['mtd', 'qtd', 'ytd']) {
    assert.equal(periodToDateRange(key, '2026-08-28').to, '2026-08-28')
  }
  assert.throws(() => periodToDateRange('all-time', '2026-08-28'), /Unknown Overview period/)
})

test('the cash-flow window is completed months only and rolls over a year boundary', () => {
  const months = trailingCompletedMonths(6, '2026-01-15')
  assert.deepEqual(months.map((month) => month.key), ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'])
  // Inclusive bounds, and never the partial month the household is living in.
  assert.equal(months.at(-1).from, '2025-12-01')
  assert.equal(months.at(-1).to, '2025-12-31')
  assert.ok(months.every((month) => !month.to.startsWith('2026-01')))
})

/* ── Honest states ──────────────────────────────────────────────────────── */

test('an Overview with no canonical read renders honest states, never a number', () => {
  const model = buildOverviewModel({ today: FIXTURE_TODAY, period: PERIOD })

  for (const slot of [model.summary.netWorth, model.summary.assets, model.summary.liabilities, model.summary.investments]) {
    assert.equal(slot.status, 'unavailable')
    assert.equal(slot.value, undefined)
  }
  assert.equal(model.cashFlow.status, 'unavailable')
  assert.equal(model.topSpend.status, 'unavailable')
  assert.equal(model.recentActivity.status, 'unavailable')
  assert.equal(model.accounts.status, 'unavailable')
  assert.equal(model.attention.signals.length, 0)
})

test('slots with no approved contract name the contract that would supply them', () => {
  const model = buildOverviewModel({ today: FIXTURE_TODAY, period: PERIOD })
  const gapped = {
    runway: model.summary.runway,
    netWorthChange: model.summary.changeThisPeriod,
    twelveMonthChange: model.summary.twelveMonthChange,
    equityShare: model.summary.equityShare,
    investmentDayChange: model.summary.investmentDayChange,
    upcoming: model.upcoming,
    attentionRegistry: model.attention.registry,
    integrationStatus: model.quality.integrationStatus,
  }
  for (const [id, slot] of Object.entries(gapped)) {
    assert.equal(slot.status, 'unavailable', id)
    assert.equal(slot.gap, OVERVIEW_GAPS[id], id)
    assert.match(slot.gap.contract, /SHR-\d+/, id)
  }
  const budgetKpi = model.kpis.find((kpi) => kpi.key === 'budget')
  assert.equal(budgetKpi.slot.gap, OVERVIEW_GAPS.budgetRemaining)
})

test('the quarantined household split is never rendered as a value', () => {
  const model = buildOverviewModel({ today: FIXTURE_TODAY, period: PERIOD })
  assert.equal(model.summary.equityShare.status, 'unavailable')
  assert.match(model.summary.equityShare.gap.detail, /counted once/)
  assert.equal(model.summary.scopeNote, 'Whole household, counted once')
})

test('a failed canonical read degrades only its own region and names the failure', () => {
  const model = buildOverviewModel({
    today: FIXTURE_TODAY,
    period: PERIOD,
    errors: { balanceSheet: 'The canonical balance sheet could not be read. No legacy or estimated value is substituted.' },
    accounts: [],
  })
  assert.equal(model.summary.netWorth.status, 'unavailable')
  assert.match(model.summary.netWorth.reason, /No legacy or estimated value is substituted/)
  assert.equal(model.accounts.status, 'empty')
})

/* ── Canonical nulls stay distinct from missing contracts ───────────────── */

test('a canonical null reads as incomplete, not as a missing contract', () => {
  const incompleteMetrics = {
    posted_income_aed: null,
    consumption_spend_aed: 1000,
    savings_aed: null,
    savings_rate_percent: null,
    savings_rate_reason: 'incomplete_inputs',
    quality_status: 'incomplete',
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
    quality_metadata: {
      fx_basis: 'current_rate_aed', fx_updated_at: null, missing_fx_currencies: [],
      income_incomplete_count: 2, consumption_incomplete_count: 0, savings_movement_incomplete_count: 0,
      provisional_transaction_count: 0, zero_placeholder_count: 0,
    },
  }
  const model = buildOverviewModel({ today: FIXTURE_TODAY, period: PERIOD, periodMetrics: incompleteMetrics })
  const income = model.kpis.find((kpi) => kpi.key === 'income')
  const spend = model.kpis.find((kpi) => kpi.key === 'spend')
  const rate = model.kpis.find((kpi) => kpi.key === 'rate')
  assert.equal(income.slot.status, 'incomplete')
  assert.equal(spend.slot.status, 'available')
  assert.equal(spend.slot.value, 1000)
  assert.equal(rate.slot.status, 'incomplete')
  assert.match(rate.slot.reason, /inputs are incomplete/)
})

/* ── Chart geometry ─────────────────────────────────────────────────────── */

test('chart geometry scales to the largest canonical value and breaks on gaps', () => {
  const geometry = buildCashFlowGeometry([
    { key: 'a', income: 100, spend: 50, rate: 50 },
    { key: 'b', income: null, spend: null, rate: null },
    { key: 'c', income: 200, spend: 100, rate: 50 },
  ])
  assert.equal(geometry.peak, 200)
  assert.equal(geometry.bars[0].income, 0.5)
  assert.equal(geometry.bars[1].income, null)
  assert.equal(geometry.bars[2].income, 1)
  // Two known points only, so the polyline has two vertices and never draws
  // through the incomplete month.
  assert.equal(geometry.polyline.split(' ').length, 2)
})

test('a savings-rate series with fewer than two known points draws no line', () => {
  const geometry = buildCashFlowGeometry([
    { key: 'a', income: 100, spend: 50, rate: 50 },
    { key: 'b', income: 100, spend: 50, rate: null },
  ])
  assert.equal(geometry.polyline, null)
})

/* ── Top spend reconciliation ───────────────────────────────────────────── */

test('a category breakdown that does not reconcile is withheld rather than shown', () => {
  const metrics = { consumption_spend_aed: 1000, quality_metadata: { missing_fx_currencies: [] }, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0, quality_status: 'complete' }
  const drifting = [
    { category: 'Groceries', actual_aed: 600, quality_status: 'complete', transaction_count: 3, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 },
    { category: 'Transport', actual_aed: 380, quality_status: 'complete', transaction_count: 2, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 },
  ]
  const model = buildOverviewModel({ today: FIXTURE_TODAY, period: PERIOD, periodMetrics: metrics, budgetActuals: drifting })
  assert.equal(model.topSpend.status, 'incomplete')
  assert.match(model.topSpend.reason, /do not reconcile/)
})

/* ── Attention signals ──────────────────────────────────────────────────── */

test('attention lists canonical counts verbatim and never ranks or invents one', () => {
  const signals = buildQualitySignals({
    periodMetrics: {
      needs_review_count: 3,
      zero_placeholder_count: 1,
      missing_fx_count: 2,
      quality_metadata: {
        missing_fx_currencies: ['USD'],
        income_incomplete_count: 0,
        consumption_incomplete_count: 1,
        savings_movement_incomplete_count: 0,
      },
    },
    balanceSheet: { incomplete_account_count: 0, provisional_account_count: 1 },
    investments: { stale_value_count: 2, incomplete_value_count: 0 },
  })
  assert.deepEqual(signals.map((item) => item.id), [
    'needs-review', 'zero-placeholder', 'missing-fx', 'input-consumption_incomplete_count',
    'accounts-provisional', 'holdings-stale',
  ])
  for (const item of signals) {
    assert.match(item.source, /^canonical_/, item.id)
    assert.ok(!('severity' in item) && !('score' in item), 'signals must not be ranked')
  }
  assert.equal(buildQualitySignals({ periodMetrics: null, balanceSheet: null, investments: null }).length, 0)
})

/* ── Fixtures match the real contracts ──────────────────────────────────── */

test('the preview fixtures satisfy the real canonical normalisers', async () => {
  const range = { from: PERIOD.from, to: PERIOD.to, scope: 'household', person: null }
  normalizeCanonicalPeriodResponse([await fixtureReads.getPeriodMetrics(range)], range)
  for (const month of trailingCompletedMonths(6, FIXTURE_TODAY)) {
    const expected = { from: month.from, to: month.to, scope: 'household', person: null }
    normalizeCanonicalPeriodResponse([await fixtureReads.getPeriodMetrics(expected)], expected)
  }
  normalizeCanonicalBalanceSheet([await fixtureReads.getBalanceSheet()])
  normalizeCanonicalInvestmentMetrics([await fixtureReads.getInvestments()])
  normalizeCanonicalBudgetRows(await fixtureReads.listBudgetActuals())
  normalizeCanonicalLedgerRows(await fixtureReads.listLedgerRows())
  normalizeCanonicalAccountRows(await fixtureReads.listAccounts())
})

/* ── Composition ────────────────────────────────────────────────────────── */

test('composeOverview composes canonical reads into a complete Overview model', async () => {
  const model = await composeOverview({ periodKey: 'mtd', today: FIXTURE_TODAY, reads: fixtureReads })

  assert.equal(model.summary.netWorth.status, 'available')
  assert.equal(model.summary.netWorth.source, 'canonical_balance_sheet.net_worth_aed')
  assert.equal(model.kpis.find((kpi) => kpi.key === 'spend').slot.status, 'available')
  assert.equal(model.cashFlow.status, 'available')
  assert.equal(model.cashFlow.columns.length, 6)
  assert.equal(model.topSpend.status, 'available')
  assert.equal(model.topSpend.rows.length, 5)
  assert.equal(model.recentActivity.status, 'available')
  assert.equal(model.accounts.status, 'available')
  assert.equal(model.quality.period, 'provisional')
  // Even fully loaded, the slots without an approved contract stay honest.
  assert.equal(model.summary.runway.status, 'unavailable')
  assert.equal(model.upcoming.status, 'unavailable')
})

test('a canonical read that throws never blanks the rest of the Overview', async () => {
  const failing = { ...fixtureReads, getBalanceSheet: async () => { throw new Error('rpc offline') } }
  const model = await composeOverview({ periodKey: 'qtd', today: FIXTURE_TODAY, reads: failing })
  assert.equal(model.summary.netWorth.status, 'unavailable')
  assert.match(model.summary.netWorth.reason, /rpc offline/)
  assert.equal(model.accounts.status, 'available')
  assert.equal(model.period.from, '2026-07-01')
})
