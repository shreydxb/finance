import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { INSIGHTS_GAPS, insightsGapSlot } from './insightsGaps.js'
import { buildInsightsModel } from './insightsModel.js'
import {
  completedMonthsBefore,
  insightsPeriod,
  stepInsightsPeriod,
} from './insightsPeriods.js'
import { composeInsights } from './composeInsights.js'

const TODAY = '2026-08-28'
const AUGUST = insightsPeriod({ kind: 'month', year: 2026, month: 8, today: TODAY })

function metrics(from, to, spend = 1000, income = 2400, extra = {}) {
  return {
    period_start: from,
    period_end: to,
    scope: 'household',
    person: null,
    posted_income_aed: income,
    consumption_spend_aed: spend,
    quality_status: 'complete',
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
    quality_metadata: { missing_fx_currencies: [] },
    ...extra,
  }
}

function row(category, actual, extra = {}) {
  return {
    category,
    actual_aed: actual,
    quality_status: 'complete',
    transaction_count: 2,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
    ...extra,
  }
}

function history() {
  return completedMonthsBefore(AUGUST).map((range, index) => ({
    range,
    metrics: metrics(range.from, range.to, 800 + index, 2200 + index),
    error: null,
  }))
}

function model(overrides = {}) {
  return buildInsightsModel({
    period: AUGUST,
    view: 'breakdown',
    metrics: metrics(AUGUST.from, AUGUST.to),
    categoryActuals: [row('Housing', 600), row('Other', 250), row('Uncategorised', 150)],
    history: history(),
    ...overrides,
  })
}

test('month, quarter and year windows use inclusive household calendar ranges', () => {
  assert.deepEqual(
    { from: AUGUST.from, to: AUGUST.to, label: AUGUST.label },
    { from: '2026-08-01', to: '2026-08-31', label: 'August 2026' },
  )
  const quarter = insightsPeriod({ kind: 'quarter', year: 2026, quarter: 3, today: TODAY })
  assert.equal(quarter.from, '2026-07-01')
  assert.equal(quarter.to, '2026-09-30')
  assert.equal(quarter.label, 'Q3 2026')
  const year = insightsPeriod({ kind: 'year', year: 2026, today: TODAY })
  assert.equal(year.from, '2026-01-01')
  assert.equal(year.to, '2026-12-31')
})

test('period stepping crosses month, quarter and year boundaries without UTC drift', () => {
  assert.deepEqual(stepInsightsPeriod(insightsPeriod({ kind: 'month', year: 2026, month: 1, today: TODAY }), -1), { year: 2025, month: 12, quarter: 4 })
  assert.deepEqual(stepInsightsPeriod(insightsPeriod({ kind: 'quarter', year: 2026, quarter: 1, today: TODAY }), -1), { year: 2025, quarter: 4, month: 8 })
  assert.deepEqual(stepInsightsPeriod(insightsPeriod({ kind: 'year', year: 2026, month: 8, quarter: 3, today: TODAY }), 1), { year: 2027, month: 8, quarter: 3 })
})

test('history windows are six completed months before the selected period', () => {
  const windows = completedMonthsBefore(AUGUST)
  assert.equal(windows.length, 6)
  assert.equal(windows[0].key, '2026-02')
  assert.equal(windows.at(-1).key, '2026-07')
  assert.equal(windows.at(-1).to, '2026-07-31')
})

test('selected-period spend and posted income pass through exact canonical fields', () => {
  const result = model()
  assert.equal(result.summary.spend.value, 1000)
  assert.equal(result.summary.spend.source, 'canonical_period_metrics.consumption_spend_aed')
  assert.equal(result.summary.income.value, 2400)
  assert.equal(result.summary.income.source, 'canonical_period_metrics.posted_income_aed')
})

test('income analysis beyond the direct posted total fails closed under SHR-167', () => {
  const result = model()
  assert.equal(result.gaps.incomeAnalysis.status, 'unavailable')
  assert.match(result.gaps.incomeAnalysis.gap.contract, /SHR-167/)
  assert.match(result.gaps.incomeAnalysis.gap.detail, /Source breakdown/)
})

test('category labels pass through verbatim without claiming stable identity', () => {
  const result = model()
  assert.deepEqual(result.categories.rows.map((entry) => entry.label), ['Housing', 'Other', 'Uncategorised'])
  assert.equal(result.gaps.categoryIdentity.status, 'unavailable')
  assert.match(result.gaps.categoryIdentity.gap.contract, /SHR-157/)
  assert.match(result.gaps.categoryIdentity.gap.contract, /SHR-198/)
})

test('Uncategorised remains distinct from a household category named Other', () => {
  const result = model()
  const uncategorised = result.categories.rows.find((entry) => entry.label === 'Uncategorised')
  const other = result.categories.rows.find((entry) => entry.label === 'Other')
  assert.ok(uncategorised)
  assert.ok(other)
  assert.notEqual(uncategorised.key, other.key)
  assert.equal(uncategorised.isUncategorised, true)
  assert.equal(other.isUncategorised, false)
})

test('category comparison, trend, merchant, description and explanation positions fail closed under SHR-169', () => {
  const result = model()
  for (const key of ['categoryComparison', 'categoryTrend', 'descriptions', 'merchantIdentity', 'explanation']) {
    assert.equal(result.gaps[key].status, 'unavailable', key)
    assert.match(result.gaps[key].gap.contract, /SHR-169/, key)
  }
  for (const category of result.categories.rows) assert.equal(category.comparison.status, 'unavailable')
})

test('recorded owner text has no model input and attribution fails closed under SHR-195/SHR-156', () => {
  const result = model()
  assert.equal(result.gaps.attribution.status, 'unavailable')
  assert.match(result.gaps.attribution.gap.contract, /SHR-195/)
  assert.match(result.gaps.attribution.gap.contract, /SHR-156/)
  assert.equal(JSON.stringify(result).includes('recordedOwner'), false)
})

test('quality counters remain evidence fields and never become anomaly or attention records', () => {
  const result = model({
    metrics: metrics(AUGUST.from, AUGUST.to, 1000, 2400, { quality_status: 'provisional', needs_review_count: 3 }),
  })
  assert.equal(result.summary.quality, 'provisional')
  assert.equal(result.summary.needsReviewCount, 3)
  assert.equal(Object.hasOwn(result, 'anomalies'), false)
  assert.equal(Object.hasOwn(result, 'attention'), false)
  assert.equal(Object.hasOwn(result, 'recommendations'), false)
})

test('drawing-only category geometry reconciles but exposes no percentage or share', () => {
  const result = model()
  assert.equal(result.categories.geometry.drawable, true)
  assert.equal(result.categories.rows[0].magnitude, 1)
  assert.equal(result.categories.rows[1].magnitude, 250 / 600)
  for (const category of result.categories.rows) {
    assert.equal(Object.hasOwn(category, 'percentage'), false)
    assert.equal(Object.hasOwn(category, 'share'), false)
  }
})

test('drawing-only category geometry disappears when rows cannot reconcile', () => {
  const result = model({ categoryActuals: [row('Housing', 600), row('Other', 250)] })
  assert.equal(result.categories.geometry.drawable, false)
  assert.ok(result.categories.rows.every((entry) => entry.magnitude === null))
})

test('completed-month history passes through individual values and creates drawing geometry only', () => {
  const result = model()
  assert.equal(result.history.rows.length, 6)
  assert.equal(result.history.rows[0].spend.value, 800)
  assert.equal(result.history.rows[0].income.value, 2200)
  assert.equal(result.history.geometry.drawable, true)
  assert.equal(Object.hasOwn(result.history, 'average'), false)
  assert.equal(Object.hasOwn(result.history, 'trend'), false)
  assert.equal(Object.hasOwn(result.history, 'percentageChange'), false)
  assert.equal(Object.hasOwn(result.history, 'forecast'), false)
})

test('history drawing fails closed if one completed month is incomplete', () => {
  const entries = history()
  entries[2] = { ...entries[2], metrics: metrics(entries[2].range.from, entries[2].range.to, null, 2300) }
  const result = model({ history: entries })
  assert.equal(result.history.geometry.drawable, false)
  assert.ok(result.history.geometry.bars.every((bar) => bar.spend === null && bar.income === null))
})

test('withheld canonical values never become zero', () => {
  const result = model({
    metrics: metrics(AUGUST.from, AUGUST.to, null, null, { quality_status: 'incomplete', missing_fx_count: 2 }),
    categoryActuals: [row('Travel', null, { quality_status: 'incomplete', missing_fx_count: 2 })],
  })
  assert.equal(result.summary.spend.status, 'incomplete')
  assert.equal(result.summary.income.status, 'incomplete')
  assert.equal(result.summary.spend.value, undefined)
  assert.equal(result.categories.rows[0].actual.status, 'incomplete')
})

test('empty and failed category reads remain distinct honest states', () => {
  assert.equal(model({ categoryActuals: [] }).categories.status, 'empty')
  const failed = model({ categoryActuals: null, errors: { categoryActuals: 'offline' } })
  assert.equal(failed.categories.status, 'unavailable')
  assert.equal(failed.categories.reason, 'offline')
})

test('composeInsights reads only approved canonical contracts and never raw rows', async () => {
  let metricsReads = 0
  let categoryReads = 0
  const result = await composeInsights({
    kind: 'month',
    view: 'breakdown',
    year: 2026,
    month: 8,
    today: TODAY,
    reads: {
      async getPeriodMetrics({ from, to }) {
        metricsReads += 1
        return metrics(from, to)
      },
      async listBudgetActuals() {
        categoryReads += 1
        return [row('Housing', 600), row('Other', 250), row('Uncategorised', 150)]
      },
      async listLedgerRows() { throw new Error('raw ledger must never be read') },
      async listIncomeRows() { throw new Error('raw income rows must never be read') },
    },
  })
  assert.equal(metricsReads, 7)
  assert.equal(categoryReads, 1)
  assert.equal(result.summary.spend.value, 1000)
})

test('composeInsights settles an unavailable canonical read without legacy fallback', async () => {
  const result = await composeInsights({
    year: 2026,
    month: 8,
    today: TODAY,
    reads: {
      async getPeriodMetrics() { throw new Error('metrics offline') },
      async listBudgetActuals() { throw new Error('actuals offline') },
    },
  })
  assert.equal(result.summary.spend.status, 'unavailable')
  assert.match(result.summary.spend.reason, /No legacy or estimated value is substituted/)
  assert.equal(result.categories.status, 'unavailable')
})

test('every Insights gap names its contract and explains the refusal', () => {
  for (const [name, gap] of Object.entries(INSIGHTS_GAPS)) {
    assert.ok(gap.id.length > 0, name)
    assert.match(gap.contract, /SHR-\d+/, name)
    assert.ok(gap.reason.length > 10, name)
    assert.ok(gap.detail.length > 40, name)
  }
  assert.throws(() => insightsGapSlot('missing'), /Unknown Insights gap/)
})

test('production Insights source contains no prototype demo financial values or merchants', () => {
  const files = [
    'src/v6/InsightsScreen.jsx',
    'src/v6/data/insightsGaps.js',
    'src/v6/data/insightsModel.js',
    'src/v6/data/composeInsights.js',
    'src/v6/insights/InsightsHeader.jsx',
    'src/v6/insights/InsightsSummary.jsx',
    'src/v6/insights/InsightsBreakdown.jsx',
    'src/v6/insights/InsightsHistory.jsx',
    'src/v6/insights/InsightsCompare.jsx',
    'src/v6/insights/InsightsQuality.jsx',
  ]
  const demoValues = ['14,500', '9,600', '7,320', '7,240', '3,180', '2,860', '1,420', '2,140', '1,180', '860', '740', '520']
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    for (const value of demoValues) assert.ok(!source.includes(value), `${path} carries prototype value ${value}`)
    assert.ok(!/Carrefour|Talabat|ENOC|Amazon\.ae|Noon\.com|DEWA/.test(source), `${path} carries a prototype merchant`)
  }
})
