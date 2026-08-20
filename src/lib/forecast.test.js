import assert from 'node:assert/strict'
import test from 'node:test'

import { computeMonthlyAssumptions, dateAtAge, participatingNetWorth, projectNetWorth } from './forecast.js'
import { isSpend } from './reports.js'

const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

test('computeMonthlyAssumptions averages income and expenses over the given window, excluding transfers', () => {
  const income = [
    { amount: 12000, currency: 'AED' },
    { amount: 12000, currency: 'AED' },
  ]
  const transactions = [
    { amount: 3000, currency: 'AED', category: 'Groceries' },
    { amount: 500, currency: 'AED', category: 'Transfer' }, // excluded
  ]
  const result = computeMonthlyAssumptions(income, transactions, FX, 12)
  assert.equal(result.monthlyIncome, 24000 / 12)
  assert.equal(result.monthlyExpenses, 3000 / 12)
})

test('computeMonthlyAssumptions with zero months returns zero rather than dividing by zero', () => {
  const result = computeMonthlyAssumptions([], [], FX, 0)
  assert.equal(result.monthlyIncome, 0)
  assert.equal(result.monthlyExpenses, 0)
})

test('participatingNetWorth sums only the chosen accounts, assets minus liabilities', () => {
  const accounts = [
    { id: 'a', value: 10000, currency: 'AED', is_liability: false },
    { id: 'b', value: 4000, currency: 'AED', is_liability: true },
    { id: 'c', value: 50000, currency: 'AED', is_liability: false }, // excluded
  ]
  assert.equal(participatingNetWorth(accounts, FX, ['a', 'b']), 10000 - 4000)
})

test('participatingNetWorth with no participation filter includes everything, same as useNetWorth', () => {
  const accounts = [
    { id: 'a', value: 10000, currency: 'AED', is_liability: false },
    { id: 'b', value: 4000, currency: 'AED', is_liability: true },
  ]
  assert.equal(participatingNetWorth(accounts, FX, null), 6000)
})

test('projectNetWorth with no growth and no events is a flat monthly-savings line', () => {
  const points = projectNetWorth({
    startNetWorth: 100000,
    monthlyIncome: 20000,
    monthlyExpenses: 15000,
    annualGrowthPct: 0,
    years: 1,
    startDate: new Date(2026, 0, 15),
  })
  assert.equal(points.length, 13) // month 0 through month 12 inclusive
  assert.equal(points[0].netWorth, 100000)
  assert.equal(points[1].netWorth, 105000) // +5000 saved
  assert.equal(points[12].netWorth, 100000 + 5000 * 12)
})

test('projectNetWorth compounds growth monthly on the running balance before adding cash flow', () => {
  const points = projectNetWorth({
    startNetWorth: 100000,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    annualGrowthPct: 12, // 1%/month
    years: 1,
    startDate: new Date(2026, 0, 1),
  })
  assert.equal(points[1].netWorth, 101000)
  assert.equal(Math.round(points[2].netWorth), 102010)
})

test('projectNetWorth applies a one-time event amount and an ongoing monthlyDelta from its date onward', () => {
  const points = projectNetWorth({
    startNetWorth: 500000,
    monthlyIncome: 20000,
    monthlyExpenses: 15000,
    annualGrowthPct: 0,
    years: 1,
    startDate: new Date(2026, 0, 1),
    events: [{ kind: 'house', target_date: '2026-04-01', params: { amount: -100000, monthlyDelta: -3000 } }],
  })
  // Month 3 (April) is when the down payment hits.
  const beforeEvent = points[2].netWorth // end of March
  const atEvent = points[3].netWorth // end of April
  assert.equal(atEvent, beforeEvent - 100000 + (20000 - 15000 - 3000))
  assert.deepEqual(points[3].events.map((e) => e.kind), ['house'])
  // The monthlyDelta keeps applying afterward.
  const afterEvent = points[4].netWorth
  assert.equal(afterEvent, atEvent + (20000 - 15000 - 3000))
})

test('projectNetWorth: a retirement event replaces monthly income from its date onward, not before', () => {
  const points = projectNetWorth({
    startNetWorth: 1000000,
    monthlyIncome: 30000,
    monthlyExpenses: 15000,
    annualGrowthPct: 0,
    years: 2,
    startDate: new Date(2026, 0, 1),
    events: [{ kind: 'retirement', target_date: '2027-01-01', params: { retirementIncome: 5000 } }],
  })
  // Just before retirement (month 11, Dec 2026): still saving 15000/month.
  assert.equal(points[11].netWorth, 1000000 + 15000 * 11)
  // After retirement (month 12 onward): net flow becomes 5000 - 15000 = -10000/month.
  assert.equal(points[12].netWorth, points[11].netWorth - 10000)
  assert.equal(points[13].netWorth, points[12].netWorth - 10000)
})

test('projectNetWorth: two events on the same date both fire', () => {
  const points = projectNetWorth({
    startNetWorth: 500000,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    annualGrowthPct: 0,
    years: 1,
    startDate: new Date(2026, 0, 1),
    events: [
      { kind: 'custom', target_date: '2026-06-01', params: { amount: 10000 } },
      { kind: 'custom', target_date: '2026-06-01', params: { amount: -5000 } },
    ],
  })
  assert.equal(points[5].netWorth, 500000 + 10000 - 5000)
  assert.equal(points[5].events.length, 2)
})

test('dateAtAge turns a birthdate + target age into the matching calendar date string', () => {
  assert.equal(dateAtAge('1990-06-15', 55), '2045-06-15')
})

test('dateAtAge never round-trips through toISOString, so a Dubai (UTC+4) local date is never shifted back a day', () => {
  // 1 Jan is the date most likely to expose a UTC-vs-local off-by-one.
  assert.equal(dateAtAge('1990-01-01', 55), '2045-01-01')
})

test('isSpend is reused verbatim from reports.js — no second transfer-exclusion rule to drift', () => {
  assert.equal(isSpend({ category: 'Transfer' }), false)
  assert.equal(isSpend({ category: 'Groceries' }), true)
})
