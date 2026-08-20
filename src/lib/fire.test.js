import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFireTarget, monthlyEquivalent, monthlyRecurringTotal, yearsToFire } from './fire.js'

const FX = { AED: 1, INR: 0.038454, USD: 3.672501 }

test('computeFireTarget: 25,399.54/month at a 4% SWR', () => {
  assert.equal(computeFireTarget(25399.54, 0.04), (25399.54 * 12) / 0.04)
})

test('computeFireTarget: null expense or zero swr both refuse rather than divide by zero', () => {
  assert.equal(computeFireTarget(null, 0.04), null)
  assert.equal(computeFireTarget(25000, 0), null)
  assert.equal(computeFireTarget(0, 0.04), null)
})

test('monthlyEquivalent: empty months array means every month, no spreading', () => {
  assert.equal(monthlyEquivalent({ amount: 120, currency: 'AED', months: [] }, FX), 120)
})

test('monthlyEquivalent: a months array spreads the annual cost across all 12', () => {
  // LIC Shrey: 150,000 INR once a year (December) -> monthly-equivalent AED
  const got = monthlyEquivalent({ amount: 150000, currency: 'INR', months: [12] }, FX)
  assert.ok(Math.abs(got - (150000 * FX.INR) / 12) < 1e-9)
})

test('monthlyEquivalent: a quarterly schedule (4 months/year) spreads across 12, not 4', () => {
  const got = monthlyEquivalent({ amount: 240, currency: 'AED', months: [2, 5, 8, 11] }, FX)
  assert.ok(Math.abs(got - (240 * 4) / 12) < 1e-9)
})

test('monthlyRecurringTotal: sums only the requested kind', () => {
  const rows = [
    { kind: 'expense', amount: 100, currency: 'AED', months: [] },
    { kind: 'income', amount: 20000, currency: 'AED', months: [] },
    { kind: 'emi', amount: 500, currency: 'AED', months: [] },
  ]
  assert.equal(monthlyRecurringTotal(rows, 'expense', FX), 100)
  assert.equal(monthlyRecurringTotal(rows, 'emi', FX), 500)
})

test('monthlyRecurringTotal: excludes a row whose end_date has already passed', () => {
  const rows = [
    { kind: 'emi', amount: 134, currency: 'AED', months: [], end_date: '2025-01-01' },
    { kind: 'emi', amount: 2194, currency: 'AED', months: [], end_date: '2030-07-03' },
  ]
  assert.equal(monthlyRecurringTotal(rows, 'emi', FX, '2026-08-20'), 2194)
})

test('monthlyRecurringTotal: a row ending exactly today still counts (still active today)', () => {
  const rows = [{ kind: 'emi', amount: 134, currency: 'AED', months: [], end_date: '2026-08-20' }]
  assert.equal(monthlyRecurringTotal(rows, 'emi', FX, '2026-08-20'), 134)
})

test('yearsToFire: already there returns 0', () => {
  assert.equal(yearsToFire({ startNetWorth: 8_000_000, fireTarget: 7_619_862, monthlyNetSavings: 3000, annualReturnPct: 7 }), 0)
})

test('yearsToFire: positive savings and growth reach the target within a plausible horizon', () => {
  const years = yearsToFire({
    startNetWorth: 500_000,
    fireTarget: 7_619_862,
    monthlyNetSavings: 3_101,
    annualReturnPct: 7,
  })
  assert.ok(years > 0 && years < 100)
})

test('yearsToFire: no savings and no growth never reaches the target — returns null', () => {
  const years = yearsToFire({
    startNetWorth: 500_000,
    fireTarget: 7_619_862,
    monthlyNetSavings: 0,
    annualReturnPct: 0,
    maxYears: 50,
  })
  assert.equal(years, null)
})

test('yearsToFire: no fireTarget refuses rather than looping forever', () => {
  assert.equal(yearsToFire({ startNetWorth: 100, fireTarget: null, monthlyNetSavings: 100, annualReturnPct: 5 }), null)
})
