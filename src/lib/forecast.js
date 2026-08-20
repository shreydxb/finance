// Accounts → net worth forecast (Taskiv #24's forecasting piece).
// Pure projection logic — no Supabase import, testable the same way
// reports.js and spendingComparison.js are.
//
// Deliberately the "estimate, not a promise" kind of projection: one
// blended annual growth rate applied to the whole participating net worth
// figure, plus a flat monthly net cash flow (income minus expenses) taken
// from real trailing-12-month actuals — never a hand-typed guess, per the
// app's own money-data rule — adjusted by whatever life events the
// household adds. This mirrors how Monarch's own forecast wizard works: it
// does not model each account's return separately either.

import { toAED } from './money.js'
import { isSpend } from './reports.js'

/** Trailing-N-months average monthly income and expenses (AED), from real logged data. `income`/`transactions` should already span that window. */
export function computeMonthlyAssumptions(income, transactions, fxRates, months = 12) {
  const incomeTotal = income.reduce((sum, i) => sum + toAED(Number(i.amount) || 0, i.currency, fxRates), 0)
  const expenseTotal = transactions.reduce(
    (sum, t) => (isSpend(t) ? sum + toAED(Number(t.amount) || 0, t.currency, fxRates) : sum),
    0
  )
  return {
    monthlyIncome: months > 0 ? incomeTotal / months : 0,
    monthlyExpenses: months > 0 ? expenseTotal / months : 0,
  }
}

/** Net worth (AED) for just the accounts the household chose to include — same assets-minus-liabilities convention as useNetWorth.js. */
export function participatingNetWorth(accounts, fxRates, participatingIds) {
  let assets = 0
  let liabilities = 0
  for (const a of accounts) {
    if (participatingIds && !participatingIds.includes(a.id)) continue
    const aed = toAED(Number(a.value) || 0, a.currency, fxRates)
    if (a.is_liability) liabilities += aed
    else assets += aed
  }
  return assets - liabilities
}

/**
 * Projects net worth month by month from `startDate` for `years`.
 *
 * A `retirement` event permanently replaces `monthlyIncome` with
 * `event.params.retirementIncome` (default 0) from its date onward —
 * nothing before that date changes. Every other event kind applies a
 * one-time `params.amount` at its date (negative for a cost, positive for a
 * windfall, e.g. a house down payment or an inheritance) and, if
 * `params.monthlyDelta` is set, an ongoing change to monthly cash flow from
 * that date onward (e.g. a new mortgage payment or childcare costs).
 *
 * Growth compounds monthly on the running balance; cash flow is added after
 * growth, matching "you earn interest on what you had at the start of the
 * month, then the month's saving lands at the end of it."
 */
export function projectNetWorth({
  startNetWorth,
  monthlyIncome,
  monthlyExpenses,
  annualGrowthPct,
  years,
  events = [],
  startDate = new Date(),
}) {
  const monthlyGrowth = (Number(annualGrowthPct) || 0) / 100 / 12
  const totalMonths = Math.max(0, Math.round(years * 12))
  const sortedEvents = [...events].sort((a, b) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : 0))

  let balance = startNetWorth
  let income = monthlyIncome
  let flowDelta = 0
  let eventIndex = 0
  const points = []
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1)

  for (let m = 0; m <= totalMonths; m++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + m, 1)
    const monthIso = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`
    const firedThisMonth = []

    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].target_date <= monthIso) {
      const ev = sortedEvents[eventIndex]
      if (ev.kind === 'retirement') {
        income = Number(ev.params?.retirementIncome) || 0
      } else {
        balance += Number(ev.params?.amount) || 0
        flowDelta += Number(ev.params?.monthlyDelta) || 0
      }
      firedThisMonth.push(ev)
      eventIndex++
    }

    if (m > 0) {
      balance *= 1 + monthlyGrowth
      balance += income - monthlyExpenses + flowDelta
    }

    points.push({ date: monthIso, netWorth: balance, events: firedThisMonth })
  }

  return points
}

/**
 * A birthdate + a target age → the calendar date that birthday falls on, as
 * `YYYY-MM-DD`, for turning "retire at 55" into an actual event date.
 *
 * Returns a plain date string rather than a Date object on purpose: this
 * codebase's own dates.js documents `toISOString().slice(0, 10)` as a
 * UTC-vs-local trap for a household in Dubai (UTC+4) — converting a local
 * Date back to an ISO string at the call site can silently shift the date
 * back a day. Building the string directly from the parts avoids that
 * conversion ever happening.
 */
export function dateAtAge(birthDate, age) {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const d = new Date(by + age, bm - 1, bd)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
