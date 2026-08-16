import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lastDayOfMonth,
  clampDay,
  cycleCloseDate,
  statementCycle,
  nextDueDate,
  daysUntil,
  utilisation,
  cardSummary,
} from './cards.js'

const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

test('lastDayOfMonth handles month lengths and leap years', () => {
  assert.equal(lastDayOfMonth(2026, 1), 31)
  assert.equal(lastDayOfMonth(2026, 2), 28)
  assert.equal(lastDayOfMonth(2028, 2), 29)
  assert.equal(lastDayOfMonth(2026, 4), 30)
  assert.equal(lastDayOfMonth(2026, 12), 31)
})

test('clampDay rolls a 31st back to the last day of a short month', () => {
  assert.equal(clampDay(31, 2026, 2), 28)
  assert.equal(clampDay(31, 2028, 2), 29)
  assert.equal(clampDay(31, 2026, 4), 30)
  assert.equal(clampDay(17, 2026, 2), 17)
})

test('the cycle closes on the next statement day on or after today', () => {
  assert.equal(cycleCloseDate(17, '2026-08-16'), '2026-08-17')
  // On the closing day itself the cycle is still the one closing today.
  assert.equal(cycleCloseDate(17, '2026-08-17'), '2026-08-17')
  // The day after, it has rolled to next month.
  assert.equal(cycleCloseDate(17, '2026-08-18'), '2026-09-17')
})

test('a 31st statement day lands on the last day of February', () => {
  assert.equal(cycleCloseDate(31, '2026-02-10'), '2026-02-28')
  assert.equal(cycleCloseDate(31, '2028-02-10'), '2028-02-29')
})

test('the cycle window runs from the day after the previous close', () => {
  assert.deepEqual(statementCycle(17, '2026-08-16'), { start: '2026-07-18', end: '2026-08-17' })
  assert.deepEqual(statementCycle(17, '2026-08-18'), { start: '2026-08-18', end: '2026-09-17' })
})

test('the cycle window crosses a year boundary correctly', () => {
  assert.deepEqual(statementCycle(5, '2026-01-03'), { start: '2025-12-06', end: '2026-01-05' })
})

test('a 31st close in March starts the day after February ended', () => {
  assert.deepEqual(statementCycle(31, '2026-03-15'), { start: '2026-03-01', end: '2026-03-31' })
})

test('an unset statement day yields no cycle rather than a guessed one', () => {
  assert.equal(cycleCloseDate(null, '2026-08-16'), null)
  assert.equal(statementCycle(null, '2026-08-16'), null)
  assert.equal(nextDueDate(undefined, '2026-08-16'), null)
})

test('daysUntil counts whole days in both directions', () => {
  assert.equal(daysUntil('2026-08-17', '2026-08-16'), 1)
  assert.equal(daysUntil('2026-08-16', '2026-08-16'), 0)
  assert.equal(daysUntil('2026-08-14', '2026-08-16'), -2)
  assert.equal(daysUntil('2026-09-01', '2026-08-16'), 16)
})

test('utilisation is null when the limit is unknown, not zero', () => {
  assert.equal(utilisation(5000, null), null)
  assert.equal(utilisation(5000, 0), null)
  assert.equal(utilisation(5000, 20000), 25)
  assert.equal(utilisation(20000, 20000), 100)
})

test('utilisation is null when the balance could not be converted', () => {
  // toAED returns NaN for an unknown rate; that must not become a bar at 0%.
  assert.equal(utilisation(NaN, 20000), null)
})

const CARD = {
  id: 'card-1',
  name: 'Test CC',
  type: 'credit_card',
  currency: 'AED',
  value: 5000,
  credit_limit: 20000,
  statement_day: 17,
  due_day: 5,
}

test('cardSummary reports limit, owed, available and utilisation', () => {
  const s = cardSummary(CARD, [], FX, '2026-08-16')
  assert.equal(s.owed, 5000)
  assert.equal(s.limit, 20000)
  assert.equal(s.available, 15000)
  assert.equal(s.utilisationPct, 25)
  assert.deepEqual(s.cycle, { start: '2026-07-18', end: '2026-08-17' })
  assert.equal(s.daysToClose, 1)
  assert.equal(s.dueDate, '2026-09-05')
})

test('cycle spend counts only this card, only inside the window', () => {
  const txns = [
    { account_id: 'card-1', date: '2026-07-20', amount: 100, currency: 'AED' },
    { account_id: 'card-1', date: '2026-08-16', amount: 50, currency: 'AED' },
    // Before the cycle opened.
    { account_id: 'card-1', date: '2026-07-17', amount: 999, currency: 'AED' },
    // After it closes.
    { account_id: 'card-1', date: '2026-08-18', amount: 999, currency: 'AED' },
    // A different account.
    { account_id: 'other', date: '2026-08-01', amount: 999, currency: 'AED' },
  ]
  const s = cardSummary(CARD, txns, FX, '2026-08-16')
  assert.equal(s.cycleSpend, 150)
  assert.equal(s.cycleCount, 2)
})

test('cycle spend converts foreign-currency rows before summing', () => {
  const txns = [
    { account_id: 'card-1', date: '2026-08-01', amount: 100, currency: 'AED' },
    { account_id: 'card-1', date: '2026-08-02', amount: 100, currency: 'USD' },
  ]
  const s = cardSummary(CARD, txns, FX, '2026-08-16')
  assert.equal(s.cycleSpend, 100 + 367.25)
})

test('an unknown rate poisons the total rather than under-reporting it', () => {
  // The deliberate NaN-on-unknown-rate behaviour from money.js must survive
  // the sum. A quietly-too-small card balance is the failure mode this
  // project keeps guarding against.
  const txns = [{ account_id: 'card-1', date: '2026-08-01', amount: 100, currency: 'GBP' }]
  const s = cardSummary(CARD, txns, FX, '2026-08-16')
  assert.ok(Number.isNaN(s.cycleSpend))
})

test('a card with no cycle entered still reports limit and balance', () => {
  const bare = { ...CARD, statement_day: null, due_day: null }
  const s = cardSummary(bare, [], FX, '2026-08-16')
  assert.equal(s.limit, 20000)
  assert.equal(s.available, 15000)
  assert.equal(s.utilisationPct, 25)
  assert.equal(s.cycle, null)
  assert.equal(s.cycleSpend, null)
  assert.equal(s.dueDate, null)
})

test('a card with no limit reports no utilisation and no available figure', () => {
  const bare = { ...CARD, credit_limit: null }
  const s = cardSummary(bare, [], FX, '2026-08-16')
  assert.equal(s.limit, null)
  assert.equal(s.available, null)
  assert.equal(s.utilisationPct, null)
})

test('a USD card converts its limit as well as its balance', () => {
  const usd = { ...CARD, currency: 'USD', value: 1000, credit_limit: 5000 }
  const s = cardSummary(usd, [], FX, '2026-08-16')
  assert.equal(s.owed, 3672.5)
  assert.equal(s.limit, 18362.5)
  assert.equal(s.available, 14690)
  assert.equal(s.utilisationPct, 20)
})
