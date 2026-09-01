/**
 * Budget's period windows.
 *
 * A budget period is a whole calendar month, not a period-to-date: the plan a
 * household sets covers the month, and a partially elapsed month is still that
 * month. The year view is the twelve calendar months of one year, navigated as
 * a set rather than aggregated — SHR-166 owns year aggregation.
 *
 * Pure date arithmetic on the household's own calendar. Nothing here round-
 * trips a date through `toISOString`, which would shift the day at UTC+4.
 */

import { todayLocal } from '../../lib/dates.js'
import { currentYearMonth, monthLabel, monthRange, shiftMonth, yearRange } from '../../lib/period.js'

const MONTH_SHORT = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
])

export const BUDGET_VIEW_OPTIONS = Object.freeze([
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
])

export function isBudgetView(value) {
  return BUDGET_VIEW_OPTIONS.some((option) => option.value === value)
}

export function isMonthNumber(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12
}

export function isYearNumber(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 2000 && numeric <= 2100
}

function todayParts(today) {
  return currentYearMonth(new Date(`${today}T00:00:00Z`))
}

/** Days remaining in the month, inclusive of today. A calendar fact, not a forecast. */
function daysRemaining(period, today) {
  if (!period.isCurrentMonth) return null
  const last = Number(period.to.slice(8, 10))
  const day = Number(today.slice(8, 10))
  return Math.max(0, last - day)
}

export function monthPeriod({ year, month, today = todayLocal() } = {}) {
  const fallback = todayParts(today)
  const resolvedYear = isYearNumber(year) ? Number(year) : fallback.year
  const resolvedMonth = isMonthNumber(month) ? Number(month) : fallback.month
  const { from, to } = monthRange(resolvedYear, resolvedMonth)
  const period = {
    view: 'month',
    year: resolvedYear,
    month: resolvedMonth,
    from,
    to,
    label: monthLabel(resolvedYear, resolvedMonth),
    short: MONTH_SHORT[resolvedMonth - 1],
    isCurrentMonth: resolvedYear === fallback.year && resolvedMonth === fallback.month,
    isFuture: resolvedYear > fallback.year
      || (resolvedYear === fallback.year && resolvedMonth > fallback.month),
  }
  return Object.freeze({ ...period, daysRemaining: daysRemaining(period, today) })
}

/**
 * The twelve calendar months of a year, each as its own canonical window.
 *
 * They stay separate on purpose: the year view navigates monthly versions
 * rather than collapsing them into one annual number.
 */
export function yearPeriod({ year, month, today = todayLocal() } = {}) {
  const fallback = todayParts(today)
  const resolvedYear = isYearNumber(year) ? Number(year) : fallback.year
  const { from, to } = yearRange(resolvedYear)
  const months = []
  for (let index = 1; index <= 12; index += 1) {
    const range = monthRange(resolvedYear, index)
    months.push(Object.freeze({
      key: `${resolvedYear}-${String(index).padStart(2, '0')}`,
      year: resolvedYear,
      month: index,
      from: range.from,
      to: range.to,
      label: monthLabel(resolvedYear, index),
      short: MONTH_SHORT[index - 1],
      isCurrentMonth: resolvedYear === fallback.year && index === fallback.month,
      isFuture: resolvedYear > fallback.year || (resolvedYear === fallback.year && index > fallback.month),
    }))
  }
  return Object.freeze({
    view: 'year',
    year: resolvedYear,
    // The month selection is carried through the year view so switching back
    // to Month reopens the month the household was already looking at.
    month: isMonthNumber(month) ? Number(month) : fallback.month,
    from,
    to,
    label: String(resolvedYear),
    months: Object.freeze(months),
    isCurrentYear: resolvedYear === fallback.year,
    isFuture: resolvedYear > fallback.year,
  })
}

export function budgetPeriod({ view, year, month, today = todayLocal() } = {}) {
  return view === 'year' ? yearPeriod({ year, month, today }) : monthPeriod({ year, month, today })
}

export function stepMonth(period, delta) {
  return shiftMonth(period.year, period.month, delta)
}

export function stepYear(period, delta) {
  return { year: period.year + delta, month: period.month }
}
