import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { BUDGET_GAPS, buildBudgetModel, buildCapabilities, isWriteEnabled } from './budgetModel.js'
import { budgetPeriod, monthPeriod, stepMonth, stepYear, yearPeriod } from './budgetPeriods.js'
import { composeBudget } from './composeBudget.js'

const TODAY = '2026-08-28'
const AUGUST = monthPeriod({ year: 2026, month: 8, today: TODAY })

function row(category, actual, extra = {}) {
  return {
    category,
    actual_aed: actual,
    quality_status: 'complete',
    transaction_count: 3,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
    ...extra,
  }
}

function metrics(spend, extra = {}) {
  return {
    period_start: AUGUST.from,
    period_end: AUGUST.to,
    scope: 'household',
    person: null,
    posted_income_aed: 28400,
    consumption_spend_aed: spend,
    quality_status: 'complete',
    needs_review_count: 0,
    zero_placeholder_count: 0,
    missing_fx_count: 0,
    quality_metadata: { missing_fx_currencies: [] },
    ...extra,
  }
}

function monthModel({ actuals = [row('Housing', 600), row('Groceries', 400)], spend = 1000, errors = {} } = {}) {
  return buildBudgetModel({
    period: AUGUST,
    view: 'month',
    budgetActuals: actuals,
    periodMetrics: spend === null ? null : metrics(spend),
    errors,
  })
}

/* ── Periods ────────────────────────────────────────────────────────────── */

test('the budget month is the whole calendar month, in the household calendar', () => {
  assert.equal(AUGUST.from, '2026-08-01')
  assert.equal(AUGUST.to, '2026-08-31')
  assert.equal(AUGUST.label, 'August 2026')
  assert.equal(AUGUST.isCurrentMonth, true)
  assert.equal(AUGUST.daysRemaining, 3)
})

test('a completed month reports no days remaining rather than a negative count', () => {
  const july = monthPeriod({ year: 2026, month: 7, today: TODAY })
  assert.equal(july.isCurrentMonth, false)
  assert.equal(july.daysRemaining, null)
  assert.equal(july.isFuture, false)
})

test('an invalid or absent month falls back to the household’s current month', () => {
  assert.equal(monthPeriod({ year: '', month: '13', today: TODAY }).label, 'August 2026')
  assert.equal(monthPeriod({ today: TODAY }).label, 'August 2026')
})

test('the year period is twelve separate monthly windows, never one range to aggregate', () => {
  const year = yearPeriod({ year: 2026, month: 8, today: TODAY })
  assert.equal(year.months.length, 12)
  assert.equal(year.months[0].from, '2026-01-01')
  assert.equal(year.months[1].to, '2026-02-28')
  assert.equal(year.months[11].to, '2026-12-31')
  // The month selection survives the year view so switching back reopens it.
  assert.equal(year.month, 8)
  assert.equal(year.months[7].isCurrentMonth, true)
  assert.equal(year.months[8].isFuture, true)
})

test('a leap February is a real February, not a padded 28 days', () => {
  assert.equal(yearPeriod({ year: 2028, today: TODAY }).months[1].to, '2028-02-29')
})

test('stepping never round-trips a date through UTC', () => {
  // `new Date(2026, 0, 1).toISOString()` lands on 31 Dec 2025 at UTC+4. The
  // period helpers build their strings directly, so January is January.
  assert.deepEqual(stepMonth(monthPeriod({ year: 2026, month: 2, today: TODAY }), -1), { year: 2026, month: 1 })
  assert.equal(monthPeriod({ year: 2026, month: 1, today: TODAY }).from, '2026-01-01')
  assert.deepEqual(stepMonth(monthPeriod({ year: 2026, month: 12, today: TODAY }), 1), { year: 2027, month: 1 })
  assert.deepEqual(stepYear(yearPeriod({ year: 2026, month: 3, today: TODAY }), -1), { year: 2025, month: 3 })
})

test('budgetPeriod dispatches on the view', () => {
  assert.equal(budgetPeriod({ view: 'year', year: 2026, today: TODAY }).view, 'year')
  assert.equal(budgetPeriod({ view: 'month', year: 2026, month: 4, today: TODAY }).view, 'month')
  assert.equal(budgetPeriod({ view: 'nonsense', year: 2026, month: 4, today: TODAY }).view, 'month')
})

/* ── Canonical actuals ──────────────────────────────────────────────────── */

test('category actuals are passed through exactly as the contract published them', () => {
  const model = monthModel()
  const housing = model.categories.rows.find((entry) => entry.label === 'Housing')
  assert.equal(housing.actual.status, 'available')
  assert.equal(housing.actual.value, 600)
  assert.equal(housing.actual.source, 'canonical_budget_actuals.actual_aed')
  assert.equal(model.summary.actual.value, 1000)
  assert.equal(model.summary.actual.source, 'canonical_period_metrics.consumption_spend_aed')
})

test('a category whose canonical actual is withheld is never shown as zero', () => {
  const model = monthModel({
    actuals: [row('Housing', 600), row('Travel', null, { quality_status: 'incomplete', missing_fx_count: 2, needs_review_count: 2 })],
    spend: null,
  })
  const travel = model.categories.rows.find((entry) => entry.label === 'Travel')
  assert.equal(travel.actual.status, 'incomplete')
  assert.ok(!Object.prototype.hasOwnProperty.call(travel.actual, 'value'))
})

test('Uncategorised stays its own row and is never folded into a category named Other', () => {
  const model = monthModel({
    actuals: [row('Other', 260), row('Uncategorised', 470), row('Housing', 270)],
    spend: 1000,
  })
  const labels = model.categories.rows.map((entry) => entry.label)
  assert.ok(labels.includes('Uncategorised'))
  assert.ok(labels.includes('Other'))
  assert.equal(labels.filter((label) => label === 'Other').length, 1)
  assert.equal(model.categories.rows.find((entry) => entry.label === 'Uncategorised').isUncategorised, true)
  assert.equal(model.categories.rows.find((entry) => entry.label === 'Other').isUncategorised, false)
  assert.equal(model.categories.rows.find((entry) => entry.label === 'Uncategorised').actual.value, 470)
  assert.equal(model.categories.rows.find((entry) => entry.label === 'Other').actual.value, 260)
})

test('a category label is never treated as a stable identity', () => {
  const model = monthModel()
  assert.equal(model.gaps.categoryIdentity.status, 'unavailable')
  assert.match(model.gaps.categoryIdentity.gap.contract, /SHR-198/)
  assert.match(model.gaps.categoryGroups.gap.contract, /SHR-198/)
})

/* ── No browser-created financial truth ─────────────────────────────────── */

const PLAN_SLOTS = ['plan', 'remaining', 'progress', 'pace', 'projectedClose']

test('every plan-side position is an unavailable slot naming SHR-166, never a number', () => {
  const model = monthModel()
  for (const key of [...PLAN_SLOTS, 'variance', 'rollover']) {
    const slot = model.summary[key]
    assert.equal(slot.status, 'unavailable', `summary.${key} must be unavailable`)
    assert.ok(!Object.prototype.hasOwnProperty.call(slot, 'value'), `summary.${key} must carry no value`)
    assert.match(slot.gap.contract, /SHR-166/, `summary.${key} must name SHR-166`)
  }
  for (const category of model.categories.rows) {
    for (const key of PLAN_SLOTS) {
      assert.equal(category[key].status, 'unavailable', `${category.label}.${key} must be unavailable`)
      assert.ok(!Object.prototype.hasOwnProperty.call(category[key], 'value'))
      assert.match(category[key].gap.contract, /SHR-166/)
    }
  }
})

test('no plan, remaining or projected figure is derivable from what the model exposes', () => {
  const model = monthModel({ actuals: [row('Housing', 600), row('Groceries', 400)], spend: 1000 })
  const serialised = JSON.stringify(model)
  // The only numbers present are canonical values, canonical counters, the
  // period's own date parts, and bar geometry in [0, 1].
  const numbers = new Set()
  JSON.parse(serialised, (key, value) => {
    if (typeof value === 'number') numbers.add(value)
    return value
  })
  const canonical = new Set([600, 400, 1000, 3, 0, 2026, 8, 31, 1])
  for (const value of numbers) {
    const isGeometry = value > 0 && value <= 1
    assert.ok(canonical.has(value) || isGeometry, `unexpected derived number in the model: ${value}`)
  }
})

test('the year grid states no total, average, income or net-saved figure', () => {
  const period = yearPeriod({ year: 2026, month: 8, today: TODAY })
  const model = buildBudgetModel({
    period,
    view: 'year',
    monthlyActuals: period.months.map((month) => ({
      key: month.key,
      rows: month.month <= 8 ? [row('Housing', 600)] : [],
      error: null,
    })),
    monthlyMetrics: period.months.map((month) => ({ key: month.key, metrics: metrics(month.month <= 8 ? 600 : 0), error: null })),
  })

  assert.equal(model.year.rows.length, 1)
  assert.equal(model.year.rows[0].label, 'Housing')
  assert.equal(model.year.rows[0].cells.length, 12)
  assert.equal(model.year.rows[0].cells[0].slot.value, 600)
  // A month the contract did not report the label in is "not reported", not 0.
  assert.equal(model.year.rows[0].cells[8].slot, null)
  assert.equal(model.year.rows[0].cells[8].reported, false)

  for (const slot of [model.year.rows[0].total, model.year.rows[0].average, model.year.total]) {
    assert.equal(slot.status, 'unavailable')
    assert.match(slot.gap.contract, /SHR-166/)
  }
  assert.match(model.year.income.gap.contract, /SHR-167/)
  assert.match(model.year.netSaved.gap.contract, /SHR-167/)
})

test('one failed month of the year grid does not blank the other eleven', () => {
  const period = yearPeriod({ year: 2026, month: 8, today: TODAY })
  const model = buildBudgetModel({
    period,
    view: 'year',
    monthlyActuals: period.months.map((month) => (month.month === 3
      ? { key: month.key, rows: null, error: 'March could not be read.' }
      : { key: month.key, rows: [row('Housing', 600)], error: null })),
    monthlyMetrics: period.months.map((month) => ({ key: month.key, metrics: metrics(600), error: null })),
  })
  const cells = model.year.rows[0].cells
  assert.equal(cells[2].slot.status, 'unavailable')
  assert.equal(cells[2].slot.reason, 'March could not be read.')
  assert.equal(cells[0].slot.value, 600)
  assert.equal(cells[11].slot.value, 600)
})

/* ── Bar geometry ───────────────────────────────────────────────────────── */

test('bars are relative magnitude between canonical actuals, never progress against a plan', () => {
  const model = monthModel({ actuals: [row('Housing', 600), row('Groceries', 400)], spend: 1000 })
  assert.equal(model.categories.bars.drawable, true)
  const [first, second] = model.categories.rows
  assert.equal(first.label, 'Housing')
  assert.equal(first.magnitude, 1)
  assert.equal(second.magnitude, 400 / 600)
  // The plan-progress slot beside it is still unavailable: the bar is not it.
  assert.equal(first.progress.status, 'unavailable')
})

test('no bar is drawn when the category actuals do not reconcile to the canonical period total', () => {
  const model = monthModel({ actuals: [row('Housing', 600), row('Groceries', 400)], spend: 1250 })
  assert.equal(model.categories.bars.drawable, false)
  assert.match(model.categories.bars.reason, /do not reconcile/)
  assert.deepEqual(model.categories.rows.map((entry) => entry.magnitude), [null, null])
})

test('no bar is drawn when any category actual is incomplete', () => {
  const model = monthModel({
    actuals: [row('Housing', 600), row('Travel', null, { quality_status: 'incomplete', missing_fx_count: 1, needs_review_count: 1 })],
    spend: 600,
  })
  assert.equal(model.categories.bars.drawable, false)
  assert.match(model.categories.bars.reason, /incomplete/)
})

test('no bar is drawn when the canonical period total itself is withheld', () => {
  const model = monthModel({ actuals: [row('Housing', 600)], spend: null })
  assert.equal(model.categories.bars.drawable, false)
  assert.equal(model.summary.actual.status, 'unavailable')
})

/* ── Fail-closed reads ──────────────────────────────────────────────────── */

test('a failed actuals read degrades its own region and substitutes nothing', () => {
  const model = monthModel({ errors: { budgetActuals: 'Canonical category actuals could not be read (offline).' } })
  assert.equal(model.categories.status, 'unavailable')
  assert.match(model.categories.reason, /could not be read/)
  assert.deepEqual(model.categories.rows, [])
  // The period headline is a separate read and survives.
  assert.equal(model.summary.actual.status, 'available')
})

test('a failed period read never becomes a locally summed period total', () => {
  const model = monthModel({ errors: { periodMetrics: 'Canonical period metrics could not be read (offline).' } })
  assert.equal(model.summary.actual.status, 'unavailable')
  assert.ok(!Object.prototype.hasOwnProperty.call(model.summary.actual, 'value'))
  // Categories are still real canonical values, but nothing adds them up.
  assert.equal(model.categories.rows[0].actual.value, 600)
  assert.equal(model.categories.bars.drawable, false)
})

test('an unread actuals contract is stated, not rendered as an empty budget', () => {
  const model = buildBudgetModel({ period: AUGUST, view: 'month', budgetActuals: null, periodMetrics: metrics(1000) })
  assert.equal(model.categories.status, 'unavailable')
  const empty = buildBudgetModel({ period: AUGUST, view: 'month', budgetActuals: [], periodMetrics: metrics(0) })
  assert.equal(empty.categories.status, 'empty')
})

/* ── Writes ─────────────────────────────────────────────────────────────── */

test('every write capability is unsupported and names its contract', () => {
  const capabilities = buildCapabilities()
  assert.equal(isWriteEnabled(capabilities), false)
  for (const [key, slot] of Object.entries(capabilities)) {
    assert.equal(slot.status, 'unavailable', `${key} must be unavailable`)
    assert.ok(slot.gap.contract, `${key} must name a contract`)
  }
  assert.match(capabilities.setBudget.gap.contract, /SHR-166/)
  assert.match(capabilities.editBudget.gap.contract, /SHR-166/)
  assert.match(capabilities.categoryAdmin.gap.contract, /SHR-198/)
})

test('the gap registry rejects an unknown gap rather than rendering an empty state', () => {
  assert.throws(() => buildBudgetModel({ period: AUGUST }) && BUDGET_GAPS.nope.reason, TypeError)
})

/* ── Composition ────────────────────────────────────────────────────────── */

test('the month view reads exactly the two approved canonical contracts', async () => {
  const calls = []
  const reads = {
    async listBudgetActuals(range) { calls.push(['listBudgetActuals', range]); return [row('Housing', 600)] },
    async getPeriodMetrics(range) { calls.push(['getPeriodMetrics', range]); return metrics(600) },
  }
  const model = await composeBudget({ view: 'month', year: 2026, month: 8, today: TODAY, reads })
  assert.deepEqual(calls.map(([name]) => name).sort(), ['getPeriodMetrics', 'listBudgetActuals'])
  assert.deepEqual(calls[0][1], { from: '2026-08-01', to: '2026-08-31' })
  assert.equal(model.summary.actual.value, 600)
})

test('the year view reads twelve separate months rather than one annual range', async () => {
  const ranges = []
  const reads = {
    async listBudgetActuals(range) { ranges.push(range); return [row('Housing', 600)] },
    async getPeriodMetrics() { return metrics(600) },
  }
  await composeBudget({ view: 'year', year: 2026, today: TODAY, reads })
  assert.equal(ranges.length, 12)
  assert.deepEqual(ranges[0], { from: '2026-01-01', to: '2026-01-31' })
  assert.deepEqual(ranges[11], { from: '2026-12-01', to: '2026-12-31' })
  assert.equal(ranges.some((range) => range.from === '2026-01-01' && range.to === '2026-12-31'), false)
})

test('a thrown read becomes a named honest failure, not an exception or a fallback', async () => {
  const model = await composeBudget({
    view: 'month', year: 2026, month: 8, today: TODAY,
    reads: {
      async listBudgetActuals() { throw new Error('actuals offline') },
      async getPeriodMetrics() { return metrics(600) },
    },
  })
  assert.equal(model.categories.status, 'unavailable')
  assert.match(model.categories.reason, /actuals offline/)
  assert.match(model.categories.reason, /No legacy or estimated value is substituted/)
})

/* ── Boundary ───────────────────────────────────────────────────────────── */

test('no Budget module reaches a legacy budget reader or writer', () => {
  const modules = [
    'src/v6/BudgetScreen.jsx',
    'src/v6/data/budgetModel.js',
    'src/v6/data/budgetPeriods.js',
    'src/v6/data/budgetGaps.js',
    'src/v6/data/composeBudget.js',
    'src/v6/data/useBudgetData.js',
    'src/v6/budget/BudgetHeader.jsx',
    'src/v6/budget/BudgetControls.jsx',
    'src/v6/budget/BudgetSummary.jsx',
    'src/v6/budget/BudgetCategoryTable.jsx',
    'src/v6/budget/BudgetYearGrid.jsx',
    'src/v6/budget/BudgetQuality.jsx',
    'src/v6/fixtures/budgetFixture.js',
  ]
  for (const path of modules) {
    const text = readFileSync(path, 'utf8')
    assert.ok(!/from\s+'[^']*\/lib\/budgets(\.js)?'/.test(text), `${path} must not import the legacy budget reader`)
    assert.ok(!/from\s+'[^']*\/screens\//.test(text), `${path} must not import a legacy screen`)
    assert.ok(!/\b(saveBudget|upsertBudget|deleteBudget|setBudgetLimit|listBudgets)\b/.test(text), `${path} must not call a legacy budget writer`)
  }
})

test('the pure Budget modules stay loadable without a Supabase client', () => {
  for (const path of ['src/v6/data/budgetModel.js', 'src/v6/data/budgetPeriods.js', 'src/v6/data/budgetGaps.js', 'src/v6/data/composeBudget.js']) {
    const text = readFileSync(path, 'utf8')
    assert.ok(!/supabaseClient|canonicalMetrics/.test(text), `${path} must not reach the Supabase client`)
  }
})
