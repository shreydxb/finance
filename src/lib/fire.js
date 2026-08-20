// FIRE number (Taskiv #21) — deliberately the small, static version: a
// 3-field formula over settings, not Monarch's Forecasting feature (that's
// forecast.js, built separately for #24 and not merged with this).
//
// fire_expense is meant to come from real trailing spend + standing
// commitments (card statements via transactions, plus recurring bills/EMIs
// that never hit a card and so never show up as a transaction row — rent
// cheques, loan EMIs, LIC premiums, remittances). Never a hand-typed guess,
// per the app's money-data rule.

import { toAED } from './money.js'
import { todayLocal } from './dates.js'

/** FIRE target = 12 months of expenses, divided by the safe withdrawal rate. */
export function computeFireTarget(fireExpense, fireSwr) {
  const expense = Number(fireExpense)
  const swr = Number(fireSwr)
  if (!expense || !swr) return null
  return (expense * 12) / swr
}

/**
 * One `recurring` row's monthly-equivalent AED cost.
 *
 * `months` empty means "every month" (this codebase's convention — see
 * recurringSchedule.js); a non-empty array means it only occurs in those
 * calendar months per year, so it's spread across all 12 for a monthly rate.
 */
export function monthlyEquivalent(row, fxRates) {
  const aed = toAED(Number(row.amount) || 0, row.currency, fxRates)
  const months = row.months || []
  if (months.length === 0) return aed
  return (aed * months.length) / 12
}

/** Sum of monthly-equivalent AED for every still-active recurring row of one kind. */
export function monthlyRecurringTotal(recurringRows, kind, fxRates, today = todayLocal()) {
  return recurringRows
    .filter((r) => r.kind === kind && (!r.end_date || r.end_date >= today))
    .reduce((sum, r) => sum + monthlyEquivalent(r, fxRates), 0)
}

/**
 * Years until `startNetWorth` compounded monthly at `annualReturnPct`, plus
 * `monthlyNetSavings` added each month, reaches `fireTarget`.
 *
 * Returns 0 if already there, null if unreachable within `maxYears` (e.g.
 * negative or zero net savings and growth alone won't close the gap).
 */
export function yearsToFire({ startNetWorth, fireTarget, monthlyNetSavings, annualReturnPct, maxYears = 100 }) {
  if (fireTarget == null || !Number.isFinite(fireTarget)) return null
  if (startNetWorth >= fireTarget) return 0
  const monthlyGrowth = (Number(annualReturnPct) || 0) / 100 / 12
  const maxMonths = Math.round(maxYears * 12)
  let balance = startNetWorth
  for (let m = 1; m <= maxMonths; m++) {
    balance = balance * (1 + monthlyGrowth) + monthlyNetSavings
    if (balance >= fireTarget) return m / 12
  }
  return null
}
