// Taskiv #57: recurring-obligation occurrence maths. Every case here is one
// the task names explicitly as an acceptance criterion, plus a case built
// from the household's real 24 live `recurring` rows (19 of which have no
// day_of_month at all — a real, common shape, not an edge case to shrug off).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextOccurrences } from './recurringSchedule.ts'
import type { RecurringRule } from './recurringSchedule.ts'

function rule(overrides: Partial<RecurringRule>): RecurringRule {
  return { dayOfMonth: 15, months: [], endDate: null, ...overrides }
}

test('a null day_of_month (no schedule) never produces an occurrence', () => {
  assert.deepEqual(nextOccurrences(rule({ dayOfMonth: null }), '2026-08-01', '2026-08-31'), [])
})

test('an every-month rule occurs once per month inside the window', () => {
  assert.deepEqual(nextOccurrences(rule({ dayOfMonth: 3 }), '2026-08-01', '2026-10-31'), ['2026-08-03', '2026-09-03', '2026-10-03'])
})

test('a months = {6,12} rule appears in June and December only', () => {
  const r = rule({ dayOfMonth: 15, months: [6, 12] })
  assert.deepEqual(nextOccurrences(r, '2026-01-01', '2026-12-31'), ['2026-06-15', '2026-12-15'])
  assert.deepEqual(nextOccurrences(r, '2026-07-01', '2026-11-30'), [])
})

test('a rule with end_date in the past appears never', () => {
  const r = rule({ dayOfMonth: 3, endDate: '2026-06-30' })
  assert.deepEqual(nextOccurrences(r, '2026-08-01', '2026-10-31'), [])
})

test('a rule ending mid-window includes the occurrence on end_date and excludes the one after', () => {
  const r = rule({ dayOfMonth: 3, endDate: '2026-09-03' })
  assert.deepEqual(nextOccurrences(r, '2026-08-01', '2026-10-31'), ['2026-08-03', '2026-09-03'])
})

test('day_of_month = 31 in February resolves to the 28th (non-leap year), not 1 March', () => {
  const r = rule({ dayOfMonth: 31 })
  const occurrences = nextOccurrences(r, '2026-01-25', '2026-03-05')
  assert.deepEqual(occurrences, ['2026-01-31', '2026-02-28'])
})

test('day_of_month = 31 in February resolves to the 29th in a leap year', () => {
  const r = rule({ dayOfMonth: 31 })
  assert.deepEqual(nextOccurrences(r, '2028-02-01', '2028-02-29'), ['2028-02-29'])
})

test('day_of_month = 30 in February also clamps to the last real day, never rolling into March', () => {
  const r = rule({ dayOfMonth: 30 })
  assert.deepEqual(nextOccurrences(r, '2026-02-01', '2026-02-28'), ['2026-02-28'])
})

test('a 14-day window across a month boundary picks up next month\'s occurrence', () => {
  const r = rule({ dayOfMonth: 3 })
  // "today" 25 Aug, next 14 days runs to 8 Sep — the 3rd of September is inside that window.
  assert.deepEqual(nextOccurrences(r, '2026-08-25', '2026-09-08'), ['2026-09-03'])
})

test('an occurrence exactly on the window boundaries is included at both ends', () => {
  const r = rule({ dayOfMonth: 15 })
  assert.deepEqual(nextOccurrences(r, '2026-08-15', '2026-08-15'), ['2026-08-15'])
  assert.deepEqual(nextOccurrences(r, '2026-08-16', '2026-08-15'), [])
})

test('real-shaped household rules: Car Loan EMI (day 3, every month, ends Jul 2030) inside a 14-day window', () => {
  const carLoanEmi = rule({ dayOfMonth: 3, endDate: '2030-07-03' })
  assert.deepEqual(nextOccurrences(carLoanEmi, '2026-08-01', '2026-08-14'), ['2026-08-03'])
})

test('real-shaped household rules: Rent Cheque split across two rules (Sep/Nov/Jan at 11700, Mar/May at 11600) never double-fires in the same month', () => {
  const rentA = rule({ dayOfMonth: 6, months: [9, 11, 1] })
  const rentB = rule({ dayOfMonth: 6, months: [3, 5] })
  assert.deepEqual(nextOccurrences(rentA, '2026-01-01', '2026-12-31'), ['2026-01-06', '2026-09-06', '2026-11-06'])
  assert.deepEqual(nextOccurrences(rentB, '2026-01-01', '2026-12-31'), ['2026-03-06', '2026-05-06'])
})

test('real-shaped household rules: the 19 rows with no day_of_month set (Netflix, LIC premiums before a date is entered, salaries) contribute nothing to any window', () => {
  const undated = rule({ dayOfMonth: null, months: [12] })
  assert.deepEqual(nextOccurrences(undated, '2026-01-01', '2026-12-31'), [])
})
