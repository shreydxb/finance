// Taskiv #57: upcoming bills & payments. The occurrence maths itself is
// tested in ../../_shared/recurringSchedule.test.ts — this file covers the
// query-level concerns: income exclusion from totals, the autopay subtotal,
// FX conversion, days clamping, and the reply text.

import assert from 'node:assert/strict'
import test from 'node:test'

import { clampDays, computeUpcomingBills, formatUpcomingBillsReply } from './bills.ts'
import type { RecurringEntry } from './types.ts'

const TODAY = '2026-08-17'
const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

function entry(overrides: Partial<RecurringEntry>): RecurringEntry {
  return {
    id: 'r1',
    name: 'Test Bill',
    kind: 'expense',
    amount: 100,
    currency: 'AED',
    owner: null,
    dayOfMonth: 20,
    months: [],
    autopay: false,
    endDate: null,
    ...overrides,
  }
}

// -- clampDays --

test('clampDays: defaults to 14 when unset', () => {
  assert.equal(clampDays(undefined), 14)
})

test('clampDays: clamps to the 1-90 range, never trusting an out-of-range model value', () => {
  assert.equal(clampDays(0), 1)
  assert.equal(clampDays(-5), 1)
  assert.equal(clampDays(500), 90)
  assert.equal(clampDays(30), 30)
})

// -- computeUpcomingBills --

test('income rows never appear in the "due" total, per the task\'s own rule', () => {
  const entries = [
    entry({ name: 'Salary', kind: 'income', amount: 20000, dayOfMonth: 20 }),
    entry({ name: 'Rent', kind: 'expense', amount: 5000, dayOfMonth: 20 }),
  ]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.equal(result.bills.length, 1)
  assert.equal(result.bills[0].name, 'Rent')
  assert.equal(result.income.length, 1)
  assert.equal(result.income[0].name, 'Salary')
  assert.equal(result.totalDueAed, 5000)
})

test('autopay rows are still in the total but excluded from the not-on-autopay subtotal', () => {
  const entries = [
    entry({ name: 'Autopay Bill', amount: 300, autopay: true, dayOfMonth: 20 }),
    entry({ name: 'Manual Bill', amount: 200, autopay: false, dayOfMonth: 21 }),
  ]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.equal(result.totalDueAed, 500)
  assert.equal(result.notOnAutopayAed, 200)
})

test('bills are sorted by date, not by input order', () => {
  const entries = [
    entry({ name: 'Later', dayOfMonth: 25 }),
    entry({ name: 'Sooner', dayOfMonth: 20 }),
  ]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.deepEqual(result.bills.map((b) => b.name), ['Sooner', 'Later'])
})

test('a non-AED bill converts through settings.fx_rates for the total, like every other query', () => {
  const entries = [entry({ name: 'India SIM', amount: 4999, currency: 'INR', dayOfMonth: 20 })]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.equal(Math.round(result.totalDueAed), Math.round(4999 * 0.044))
  assert.equal(result.totalDueUnconvertedCount, 0)
})

test('an unconvertible currency is excluded from the AED total and counted, never silently 1:1 or NaN', () => {
  const entries = [entry({ name: 'GBP Bill', amount: 100, currency: 'GBP', dayOfMonth: 20 })]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.equal(result.totalDueAed, 0)
  assert.equal(result.totalDueUnconvertedCount, 1)
  assert.equal(result.bills[0].amountAed, null)
})

test('a rule with no day_of_month (19 of the household\'s 24 live rows) contributes no occurrence at all', () => {
  const entries = [entry({ name: 'Netflix', dayOfMonth: null })]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  assert.equal(result.bills.length, 0)
})

test('a months-restricted rule outside the window contributes nothing, inside it does', () => {
  const entries = [entry({ name: 'LIC Premium', dayOfMonth: 15, months: [12] })]
  const outside = computeUpcomingBills(entries, 14, FX, TODAY) // TODAY is August
  assert.equal(outside.bills.length, 0)
  const inWindow = computeUpcomingBills(entries, 14, FX, '2026-12-10')
  assert.equal(inWindow.bills.length, 1)
})

test('the real household shape: two overlapping rent-cheque rules never double-count the same month', () => {
  const entries = [
    entry({ name: 'Rent Cheque (Sep/Nov/Jan)', amount: 11700, dayOfMonth: 6, months: [9, 11, 1] }),
    entry({ name: 'Rent Cheque (Mar/May)', amount: 11600, dayOfMonth: 6, months: [3, 5] }),
  ]
  // A window spanning into September should pick up exactly one rent cheque, not both rules firing.
  const result = computeUpcomingBills(entries, 30, FX, '2026-08-20')
  assert.equal(result.bills.filter((b) => b.name.startsWith('Rent')).length, 1)
})

// -- formatUpcomingBillsReply --

test('the given example shape: date, name, amount, autopay marker, both totals', () => {
  const entries = [
    entry({ name: 'Car loan EMI', amount: 2194, dayOfMonth: 15, autopay: true }),
    entry({ name: '0% CC loan', amount: 5207, dayOfMonth: 17, autopay: false }),
  ]
  const result = computeUpcomingBills(entries, 14, FX, '2026-08-15')
  const text = formatUpcomingBillsReply(result)
  assert.match(text, /Next 14 days/)
  assert.match(text, /Car loan EMI\s+2,194 AED\s+\(autopay\)/)
  assert.match(text, /0% CC loan\s+5,207 AED/)
  assert.doesNotMatch(text, /0% CC loan.*\(autopay\)/)
  assert.match(text, /Total due: 7,401 AED/)
  assert.match(text, /Not on autopay: 5,207 AED/)
})

test('zero bills and zero income reads as a plain "Nothing due", not an empty grid', () => {
  const result = computeUpcomingBills([], 14, FX, TODAY)
  assert.equal(formatUpcomingBillsReply(result), 'Next 14 days\n\nNothing due.')
})

test('income appears under its own "Coming in" heading, never inside the bills list', () => {
  const entries = [entry({ name: 'Shrey Salary', kind: 'income', amount: 20000, dayOfMonth: 20 })]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  const text = formatUpcomingBillsReply(result)
  assert.match(text, /No bills due\./)
  assert.match(text, /Coming in\n.*Shrey Salary/s)
})

test('an unconverted bill shows its own currency and flags the total as incomplete', () => {
  const entries = [entry({ name: 'GBP Bill', amount: 100, currency: 'GBP', dayOfMonth: 20 })]
  const result = computeUpcomingBills(entries, 14, FX, TODAY)
  const text = formatUpcomingBillsReply(result)
  assert.match(text, /100 GBP \(unconverted\)/)
  assert.match(text, /Total due: 0 AED \(1 could not be converted — check the FX rate\)/)
})
