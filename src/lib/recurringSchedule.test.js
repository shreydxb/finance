// UI-02: an obligation that has ended must stop appearing, and recurring
// income is not a bill.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isBill, occursInMonth, nextDueDate } from './recurringSchedule.js'

const emi = (over = {}) => ({
  name: 'Car EMI',
  kind: 'emi',
  day_of_month: 15,
  months: [],
  end_date: null,
  ...over,
})

// ── end_date ─────────────────────────────────────────────────────────────────

test('a monthly obligation occurs in any month before it ends', () => {
  assert.equal(occursInMonth(emi(), 2026, 8), true)
  assert.equal(occursInMonth(emi(), 2027, 3), true)
})

test('an ended obligation stops appearing in later months', () => {
  // The regression: the calendar filtered only on `months`, so a car EMI that
  // finished in May 2027 kept showing in every future month forever.
  const ended = emi({ end_date: '2027-05-20' })

  assert.equal(occursInMonth(ended, 2027, 4), true, 'before the end')
  assert.equal(occursInMonth(ended, 2027, 5), true, 'the final month')
  assert.equal(occursInMonth(ended, 2027, 6), false, 'after the end')
  assert.equal(occursInMonth(ended, 2028, 1), false, 'well after the end')
})

test('the end date is compared against the occurrence, not the month', () => {
  // Due on the 15th, ending on the 20th: that month still has a payment.
  assert.equal(occursInMonth(emi({ end_date: '2027-05-20' }), 2027, 5), true)
  // Due on the 25th, ending on the 20th: that month does not.
  assert.equal(occursInMonth(emi({ day_of_month: 25, end_date: '2027-05-20' }), 2027, 5), false)
})

test('a day beyond the month length is clamped, not skipped', () => {
  // Due on the 31st in a 30-day month means the 30th, which must still count
  // against an end date late in that month.
  assert.equal(occursInMonth(emi({ day_of_month: 31, end_date: '2027-04-30' }), 2027, 4), true)
})

// ── selected months ──────────────────────────────────────────────────────────

test('an obligation limited to certain months only occurs in those', () => {
  const quarterly = emi({ months: [3, 6, 9, 12] })
  assert.equal(occursInMonth(quarterly, 2026, 6), true)
  assert.equal(occursInMonth(quarterly, 2026, 7), false)
})

test('both rules apply together', () => {
  const quarterlyEnded = emi({ months: [3, 6, 9, 12], end_date: '2026-06-30' })
  assert.equal(occursInMonth(quarterlyEnded, 2026, 6), true)
  assert.equal(occursInMonth(quarterlyEnded, 2026, 9), false, 'right month, past the end')
})

test('an entry with no day_of_month never lands on the calendar', () => {
  assert.equal(occursInMonth(emi({ day_of_month: null }), 2026, 8), false)
})

test('occursInMonth agrees with nextDueDate about an ended obligation', () => {
  // The two used to disagree: nextDueDate honoured end_date, the calendar did not.
  const ended = emi({ end_date: '2026-05-20' })
  assert.equal(nextDueDate(ended, new Date(2026, 7, 1)), null)
  assert.equal(occursInMonth(ended, 2026, 8), false)
})

// ── bills vs income ──────────────────────────────────────────────────────────

test('recurring income is not a bill', () => {
  // Salary was appearing in "Bills & EMIs" as an upcoming obligation.
  assert.equal(isBill({ kind: 'income' }), false)
  assert.equal(isBill({ kind: 'expense' }), true)
  assert.equal(isBill({ kind: 'emi' }), true)
})
