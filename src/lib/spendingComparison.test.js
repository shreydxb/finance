import assert from 'node:assert/strict'
import test from 'node:test'

import { buildComparisonSeries, resolveComparisonPeriod } from './spendingComparison.js'

const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

function tx(date, amount, category = 'Dining Out', currency = 'AED') {
  return { date, amount, currency, category }
}

// Wednesday, so "this week" runs Mon 17 to today (Wed 19), a 3-day partial week.
const TODAY = new Date(2026, 7, 19) // 19 Aug 2026

test('resolveComparisonPeriod: week — Monday-start, current stops today, comparison is the full prior week', () => {
  const r = resolveComparisonPeriod('week', TODAY)
  assert.deepEqual(r.current, { from: '2026-08-17', to: '2026-08-19', label: 'This week' })
  assert.deepEqual(r.comparison, { from: '2026-08-10', to: '2026-08-16', label: 'Last week' })
  assert.equal(r.dayCount, 7)
})

test('resolveComparisonPeriod: month — comparison is the full prior calendar month regardless of its length', () => {
  const r = resolveComparisonPeriod('month', TODAY)
  assert.deepEqual(r.current, { from: '2026-08-01', to: '2026-08-19', label: 'This month' })
  assert.deepEqual(r.comparison, { from: '2026-07-01', to: '2026-07-31', label: 'Last month' })
  assert.equal(r.dayCount, 31, 'August has 31 days')
})

test('resolveComparisonPeriod: month crossing a year boundary rolls back correctly', () => {
  const r = resolveComparisonPeriod('month', new Date(2026, 0, 15)) // 15 Jan 2026
  assert.deepEqual(r.comparison, { from: '2025-12-01', to: '2025-12-31', label: 'Last month' })
})

test('resolveComparisonPeriod: month_last_year compares against the same month a year back', () => {
  const r = resolveComparisonPeriod('month_last_year', TODAY)
  assert.deepEqual(r.comparison, { from: '2025-08-01', to: '2025-08-31', label: 'Aug 2025' })
})

test('resolveComparisonPeriod: month_average has no single comparison period, just an averaging window', () => {
  const r = resolveComparisonPeriod('month_average', TODAY)
  assert.equal(r.comparison, null)
  assert.equal(r.comparisonLabel, 'Average month (last 12 months)')
  assert.deepEqual(r.averageWindow, { from: '2025-08-01', to: '2026-07-31' }, 'the 12 full months before this one')
})

test('resolveComparisonPeriod: year compares against the full prior calendar year', () => {
  const r = resolveComparisonPeriod('year', TODAY)
  assert.deepEqual(r.current, { from: '2026-01-01', to: '2026-08-19', label: 'This year' })
  assert.deepEqual(r.comparison, { from: '2025-01-01', to: '2025-12-31', label: '2025' })
  assert.equal(r.dayCount, 365, '2025 is not a leap year')
})

test('buildComparisonSeries: cumulative day-offset alignment for a week comparison', () => {
  const transactions = [
    tx('2026-08-17', 40), // this week, Mon
    tx('2026-08-18', 20), // this week, Tue
    // 19 Aug (Wed) — no spend logged today
    tx('2026-08-10', 30), // last week, Mon
    tx('2026-08-11', 30), // last week, Tue
    tx('2026-08-12', 30), // last week, Wed
  ]
  const resolved = resolveComparisonPeriod('week', TODAY)
  const { points, currentLabel, comparisonLabel } = buildComparisonSeries(transactions, FX, resolved, TODAY)

  assert.equal(currentLabel, 'This week')
  assert.equal(comparisonLabel, 'Last week')
  assert.equal(points.length, 7)

  // Day 1 (Mon): this week 40, last week 30.
  assert.equal(points[0].current, 40)
  assert.equal(points[0].comparison, 30)
  // Day 2 (Tue): cumulative 60 vs 60.
  assert.equal(points[1].current, 60)
  assert.equal(points[1].comparison, 60)
  // Day 3 (Wed, today): current stays 60 (no spend), comparison keeps accumulating to 90.
  assert.equal(points[2].current, 60)
  assert.equal(points[2].comparison, 90)
  // Day 4 onward: current has no data yet (still today), comparison's week is over too (only 3 days had data logged, but the week itself ran the full 7 — the rest just add nothing).
  assert.equal(points[3].current, null)
  assert.equal(points[3].comparison, 90)
})

test('buildComparisonSeries: transfers are excluded from both series', () => {
  const transactions = [tx('2026-08-17', 40), tx('2026-08-17', 500, 'Transfer')]
  const resolved = resolveComparisonPeriod('week', TODAY)
  const { points } = buildComparisonSeries(transactions, FX, resolved, TODAY)
  assert.equal(points[0].current, 40)
})

test('buildComparisonSeries: non-AED currencies convert before summing', () => {
  const transactions = [tx('2026-08-17', 10, 'Dining Out', 'USD')] // 10 * 3.6725 = 36.725
  const resolved = resolveComparisonPeriod('week', TODAY)
  const { points } = buildComparisonSeries(transactions, FX, resolved, TODAY)
  assert.equal(points[0].current, 36.725)
})

test('buildComparisonSeries: month_average uses the mean of each day-of-month across the window, skipping months without that day', () => {
  // Day 31 exists in the window's Aug/Oct/Dec/Jan/Mar/May/Jul (7 of 12 months) but not the others.
  const transactions = [
    tx('2025-08-31', 100),
    tx('2025-10-31', 200),
    tx('2026-01-05', 50), // day 5, contributes to every month's average
  ]
  const resolved = resolveComparisonPeriod('month_average', TODAY)
  const { points, comparisonLabel } = buildComparisonSeries(transactions, FX, resolved, TODAY)

  assert.equal(comparisonLabel, 'Average month (last 12 months)')
  // Day 5's average: 50 / 12 months.
  assert.equal(points[4].comparison, 50 / 12)
  // Day 31's average is only over the months that have a 31st (7 of them): (100+200)/7.
  const day31 = points[30]
  assert.ok(day31.comparison !== null)
  assert.equal(Math.round(day31.comparison * 1000) / 1000, Math.round(((300 / 7) + 50 / 12) * 1000) / 1000)
})

test('buildComparisonSeries: an empty transaction list produces an all-zero (not null) series for days with data expected', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  const { points } = buildComparisonSeries([], FX, resolved, TODAY)
  assert.equal(points[0].current, 0)
  assert.equal(points[0].comparison, 0)
})
