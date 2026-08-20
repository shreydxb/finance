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
import { isSpend } from './reports.js'

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
 * The trailing window of `months` full completed calendar months before
 * today's (partial) month — `{ from, to }` as `YYYY-MM-DD`, both inclusive,
 * matching `listTransactions`'s `dateFrom`/`dateTo` (`gte`/`lte`). Never
 * hardcode a date range for this: "the last N full months" has to keep
 * moving with real time, or the budget comparison quietly goes stale the
 * way the first FIRE derivation's fixed Mar–Jul window would have.
 */
export function trailingMonthsRange(months, today = todayLocal()) {
  const [y, m] = today.split('-').map(Number)
  // Day 0 of the current month == the last day of the previous month, so
  // this lands on the last full completed month without ever going
  // through toISOString (the UTC-vs-Dubai-local trap dates.js documents).
  const toDate = new Date(y, m - 1, 0)
  const fromDate = new Date(y, m - 1 - months, 1)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    from: `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-01`,
    to: `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`,
  }
}

/**
 * Monthly-average AED spend per category over `months` trailing full
 * months. `transactions` should already be filtered to that window (e.g.
 * via `trailingMonthsRange`) — this only sums and divides, matching
 * `reports.js`'s `sumByCategoryAED` grouping convention (`Uncategorised`
 * bucket, Transfer excluded via `isSpend`).
 */
export function categoryMonthlyAverages(transactions, fxRates, months) {
  const totals = new Map()
  for (const t of transactions) {
    if (!isSpend(t)) continue
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    if (!Number.isFinite(aed)) continue
    const key = t.category || 'Uncategorised'
    totals.set(key, (totals.get(key) || 0) + aed)
  }
  if (months > 0) {
    for (const [key, total] of totals) totals.set(key, total / months)
  }
  return totals
}

/**
 * Every category with a budget limit or real spend (or both) in the
 * window, budget vs. actual monthly AED, sorted by actual spend
 * descending. A budget row with no matching spend still shows (0 actual);
 * real spend with no budget row shows `hasBudget: false` rather than being
 * silently dropped — that gap is the whole point of the comparison.
 */
export function budgetVsActual(budgetRows, transactions, fxRates, months) {
  const actual = categoryMonthlyAverages(transactions, fxRates, months)
  const rows = new Map()
  for (const b of budgetRows) {
    const name = b.category?.name
    if (!name) continue
    rows.set(name, { category: name, budgetMonthly: Number(b.monthly_limit) || 0, actualMonthly: 0, hasBudget: true })
  }
  for (const [name, monthly] of actual) {
    const existing = rows.get(name)
    if (existing) existing.actualMonthly = monthly
    else rows.set(name, { category: name, budgetMonthly: null, actualMonthly: monthly, hasBudget: false })
  }
  return [...rows.values()].sort((a, b) => b.actualMonthly - a.actualMonthly)
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
