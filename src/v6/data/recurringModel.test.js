import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { RECURRING_GAPS, recurringGapSlot } from './recurringGaps.js'
import { buildRecurringCalendar, buildRecurringModel } from './recurringModel.js'
import { recurringPeriod, stepMonth } from './recurringPeriods.js'
import { composeRecurring } from './composeRecurring.js'

const TODAY = '2026-08-28'
const AUGUST = recurringPeriod({ year: 2026, month: 8, today: TODAY })

function periodMetrics({ spend = 21486.35, review = 0, missingFx = 0 } = {}) {
  return {
    period_start: AUGUST.from,
    period_end: AUGUST.to,
    scope: 'household',
    person: null,
    posted_income_aed: 31240,
    consumption_spend_aed: spend,
    savings_movement_aed: 4100,
    cash_retained_aed: spend === null ? null : 31240 - spend - 4100,
    savings_aed: spend === null ? null : 31240 - spend,
    cash_flow_aed: spend === null ? null : 31240 - spend - 4100,
    savings_rate_percent: null,
    savings_rate_reason: spend === null ? 'incomplete_inputs' : null,
    quality_status: spend === null ? 'incomplete' : review > 0 ? 'provisional' : 'complete',
    missing_fx_count: missingFx,
    needs_review_count: review,
    zero_placeholder_count: 0,
    quality_metadata: { missing_fx_currencies: missingFx > 0 ? ['JPY'] : [] },
  }
}

/* ── Period ─────────────────────────────────────────────────────────────── */

test('a recurring period is a whole calendar month on the household calendar', () => {
  assert.equal(AUGUST.from, '2026-08-01')
  assert.equal(AUGUST.to, '2026-08-31')
  assert.equal(AUGUST.label, 'August 2026')
  assert.equal(AUGUST.isCurrentMonth, true)
  assert.equal(AUGUST.daysRemaining, 3)
})

test('a past month reports no days remaining rather than a negative count', () => {
  const march = recurringPeriod({ year: 2026, month: 3, today: TODAY })
  assert.equal(march.daysRemaining, null)
  assert.equal(march.isCurrentMonth, false)
})

test('stepping the month rolls the year at both boundaries', () => {
  assert.deepEqual(stepMonth(recurringPeriod({ year: 2026, month: 1, today: TODAY }), -1), { year: 2025, month: 12 })
  assert.deepEqual(stepMonth(recurringPeriod({ year: 2026, month: 12, today: TODAY }), 1), { year: 2027, month: 1 })
})

test('an out-of-range period falls back to the household month, never to an invalid window', () => {
  const bogus = recurringPeriod({ year: '1066', month: '13', today: TODAY })
  assert.equal(bogus.year, 2026)
  assert.equal(bogus.month, 8)
})

/* ── Plan truth fails closed ────────────────────────────────────────────── */

test('every recurring plan position is unavailable and names SHR-171', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  const planSlots = Object.entries(model.plan)
  assert.ok(planSlots.length >= 10)
  for (const [name, slot] of planSlots) {
    assert.equal(slot.status, 'unavailable', `plan.${name} must fail closed`)
    // Every plan position names SHR-171 except attribution, which is a
    // different missing contract and must say so rather than borrow this one.
    const expected = name === 'attribution' ? /SHR-195 \/ SHR-156/ : /SHR-171/
    assert.match(slot.gap.contract, expected, `plan.${name} must name its own missing contract`)
  }
})

test('the item list is empty by construction and no read can populate it', async () => {
  // Even with a canonical read that answers, and even with a read that hands
  // back rows shaped like transactions, nothing reaches the plan list: the
  // composition never asks for posted rows at all.
  const model = await composeRecurring({
    year: 2026,
    month: 8,
    today: TODAY,
    reads: {
      async getPeriodMetrics() { return periodMetrics() },
      async listLedgerRows() { throw new Error('the Recurring screen must never read the ledger') },
      async listCanonicalIncomeRows() { throw new Error('the Recurring screen must never read posted income') },
    },
  })
  assert.deepEqual(model.items, [])
  assert.equal(model.plan.bills.status, 'unavailable')
})

test('a posted period never produces a cadence, a due date or a paid status', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  for (const key of ['cadence', 'nextDue', 'paidStatus', 'autopay', 'effectiveWindow']) {
    assert.equal(model.plan[key].status, 'unavailable')
  }
  // The canonical figure the screen does publish stays where it belongs.
  assert.equal(model.posted.consumptionSpend.status, 'available')
  assert.equal(model.posted.consumptionSpend.value, 21486.35)
})

test('no matching semantics are created, automatic or suggested', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  for (const [name, slot] of Object.entries(model.matching)) {
    assert.equal(slot.status, 'unavailable', `matching.${name} must fail closed`)
    assert.match(slot.gap.contract, /SHR-171/)
  }
})

test('recorded owner text is never presented as stable economic attribution', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  assert.equal(model.plan.attribution.status, 'unavailable')
  assert.match(model.plan.attribution.gap.contract, /SHR-195/)
  assert.match(model.plan.attribution.gap.contract, /SHR-156/)
  // Every row position that would carry a person carries the same gap.
  const attribution = model.rowPositions.find((position) => position.key === 'attribution')
  assert.ok(attribution)
  assert.match(attribution.slot.gap.contract, /SHR-195/)
})

test('budget-period posted-income truth fails closed and names SHR-167', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  assert.equal(model.posted.incomePeriod.status, 'unavailable')
  assert.match(model.posted.incomePeriod.gap.contract, /SHR-167/)
})

test('the model publishes no posted income figure even though the contract carries one', () => {
  // `canonical_period_metrics` really does return `posted_income_aed`. The
  // screen's only income position is the prototype's *expected* income, so
  // borrowing the posted total for it would answer a different question in a
  // place a household reads as an expectation.
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics() })
  assert.equal(JSON.stringify(model).includes('31240'), false)
})

/* ── Canonical posted position ──────────────────────────────────────────── */

test('a withheld canonical consumption spend is stated, never rendered as zero', () => {
  const model = buildRecurringModel({ period: AUGUST, periodMetrics: periodMetrics({ spend: null, missingFx: 2 }) })
  assert.equal(model.posted.consumptionSpend.status, 'incomplete')
  assert.equal(model.posted.consumptionSpend.value, undefined)
  assert.equal(model.posted.quality, 'incomplete')
  assert.deepEqual(model.posted.missingFxCurrencies, ['JPY'])
})

test('a failed canonical read degrades to an honest state without substituting a value', () => {
  const model = buildRecurringModel({
    period: AUGUST,
    errors: { periodMetrics: 'Canonical period metrics could not be read. No legacy or estimated value is substituted.' },
  })
  assert.equal(model.posted.consumptionSpend.status, 'unavailable')
  assert.match(model.posted.consumptionSpend.reason, /No legacy or estimated value is substituted/)
  // The plan positions are unaffected — they were never going to be filled.
  assert.equal(model.plan.bills.status, 'unavailable')
})

test('composeRecurring settles a failing read rather than throwing', async () => {
  const model = await composeRecurring({
    year: 2026,
    month: 8,
    today: TODAY,
    reads: { async getPeriodMetrics() { throw new Error('offline') } },
  })
  assert.equal(model.posted.consumptionSpend.status, 'unavailable')
  assert.match(model.posted.consumptionSpend.reason, /offline/)
})

/* ── Calendar ───────────────────────────────────────────────────────────── */

test('the calendar is a real Monday-first month with nothing placed on it', () => {
  const weeks = buildRecurringCalendar({ year: 2026, month: 8, today: TODAY })
  const cells = weeks.flat()
  assert.equal(cells.length % 7, 0)
  const inMonth = cells.filter((cell) => cell.inMonth)
  assert.equal(inMonth.length, 31)
  assert.equal(inMonth[0].date, '2026-08-01')
  assert.equal(inMonth.at(-1).date, '2026-08-31')
  // 1 Aug 2026 is a Saturday, so a Monday-first grid leads with five blanks.
  assert.equal(cells.findIndex((cell) => cell.inMonth), 5)
  // No cell carries an amount, a count, an event or a status of any kind.
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), ['date', 'day', 'inMonth', 'isToday', 'key'])
  }
})

test('the calendar marks today from the household date, not from the machine clock', () => {
  const cells = buildRecurringCalendar({ year: 2026, month: 8, today: TODAY }).flat()
  assert.equal(cells.filter((cell) => cell.isToday).length, 1)
  assert.equal(cells.find((cell) => cell.isToday).date, TODAY)
  // A month the household is not in has no "today" at all.
  const march = buildRecurringCalendar({ year: 2026, month: 3, today: TODAY }).flat()
  assert.equal(march.some((cell) => cell.isToday), false)
})

test('a leap February is a real February, not a padded one', () => {
  const cells = buildRecurringCalendar({ year: 2028, month: 2, today: TODAY }).flat()
  assert.equal(cells.filter((cell) => cell.inMonth).length, 29)
})

test('expected calendar events fail closed under SHR-171', () => {
  const model = buildRecurringModel({ period: AUGUST, view: 'calendar', periodMetrics: periodMetrics() })
  assert.equal(model.calendar.expected.status, 'unavailable')
  assert.match(model.calendar.expected.gap.contract, /SHR-171/)
})

/* ── Route state ────────────────────────────────────────────────────────── */

test('an unknown type or view resolves to the default rather than rendering it', () => {
  const model = buildRecurringModel({ period: AUGUST, type: 'both', view: 'gantt' })
  assert.equal(model.type, 'bills')
  assert.equal(model.view, 'list')
})

test('the income mode relabels its row positions without inventing a plan', () => {
  const bills = buildRecurringModel({ period: AUGUST, type: 'bills' })
  const income = buildRecurringModel({ period: AUGUST, type: 'income' })
  assert.ok(bills.rowPositions.some((position) => position.label === 'Paid by'))
  assert.ok(income.rowPositions.some((position) => position.label === 'Earned by'))
  for (const model of [bills, income]) {
    for (const position of model.rowPositions) {
      assert.equal(position.slot.status, 'unavailable')
    }
  }
})

/* ── Registry hygiene ───────────────────────────────────────────────────── */

test('every named gap carries a contract, a reason and a detail', () => {
  for (const [id, gap] of Object.entries(RECURRING_GAPS)) {
    assert.equal(gap.id.length > 0, true, `${id} needs an id`)
    assert.match(gap.contract, /SHR-\d+/, `${id} must name a contract`)
    assert.ok(gap.reason.length > 10, `${id} needs a reason`)
    assert.ok(gap.detail.length > 40, `${id} needs a detail explaining the refusal`)
  }
})

test('an unknown gap id throws rather than silently rendering an empty note', () => {
  assert.throws(() => recurringGapSlot('not-a-gap'), /Unknown Recurring gap/)
})

test('no prototype demo Recurring figure appears anywhere in the Recurring tree', () => {
  // The prototype's Recurring page is entirely demo data. None of it may reach
  // the app, and the surest way to guarantee that is for none of it to exist
  // in the source at all.
  const files = [
    'src/v6/RecurringScreen.jsx',
    'src/v6/data/recurringModel.js',
    'src/v6/data/recurringPeriods.js',
    'src/v6/data/composeRecurring.js',
    'src/v6/fixtures/recurringFixture.js',
    'src/v6/recurring/RecurringHeader.jsx',
    'src/v6/recurring/RecurringControls.jsx',
    'src/v6/recurring/RecurringPlanList.jsx',
    'src/v6/recurring/RecurringCalendar.jsx',
    'src/v6/recurring/RecurringCommitmentSplit.jsx',
    'src/v6/recurring/RecurringMatching.jsx',
  ]
  const demo = ['29,400', '78,400', '20,860', '25,260', '6,850', '8,940', '2,410', '1,180', '9,600', '42,000', '24,000', '12,400']
  for (const path of files) {
    // Comments are stripped first: the fixture's own header lists the demo set
    // it deliberately avoids, and that prose is the safeguard, not a breach.
    const text = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const value of demo) {
      assert.ok(!text.includes(value), `${path} must not carry prototype demo value ${value}`)
    }
    assert.ok(!/Mortgage|NBD credit card|Etisalat|GEMS|DEWA/.test(text), `${path} must not carry a prototype demo merchant`)
  }
})
