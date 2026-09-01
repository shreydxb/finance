/**
 * Recurring's period window and its route vocabulary.
 *
 * A recurring period is a whole calendar month: a commitment that falls due on
 * the 25th belongs to that month whether or not the month has finished. The
 * screen navigates months, carrying both the year and the month in the URL, so
 * a shared or reloaded link reopens the period it was written for.
 *
 * Pure date arithmetic on the household's own calendar. Nothing here round-
 * trips a date through `toISOString`, which would shift the day at UTC+4.
 */

import { todayLocal } from '../../lib/dates.js'
import { currentYearMonth, monthLabel, monthRange, shiftMonth } from '../../lib/period.js'

/** Bills / Income. The route contract calls this `type`. */
export const RECURRING_TYPE_OPTIONS = Object.freeze([
  { value: 'bills', label: 'Bills', title: 'Bills and EMIs' },
  { value: 'income', label: 'Income', title: 'Expected income' },
])

/** List / Calendar. The route contract calls this `view`. */
export const RECURRING_VIEW_OPTIONS = Object.freeze([
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
])

export function isRecurringType(value) {
  return RECURRING_TYPE_OPTIONS.some((option) => option.value === value)
}

export function isRecurringView(value) {
  return RECURRING_VIEW_OPTIONS.some((option) => option.value === value)
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

export function recurringPeriod({ year, month, today = todayLocal() } = {}) {
  const fallback = todayParts(today)
  const resolvedYear = isYearNumber(year) ? Number(year) : fallback.year
  const resolvedMonth = isMonthNumber(month) ? Number(month) : fallback.month
  const { from, to } = monthRange(resolvedYear, resolvedMonth)
  const period = {
    year: resolvedYear,
    month: resolvedMonth,
    from,
    to,
    label: monthLabel(resolvedYear, resolvedMonth),
    today,
    isCurrentMonth: resolvedYear === fallback.year && resolvedMonth === fallback.month,
    isFuture: resolvedYear > fallback.year
      || (resolvedYear === fallback.year && resolvedMonth > fallback.month),
  }
  return Object.freeze({ ...period, daysRemaining: daysRemaining(period, today) })
}

export function stepMonth(period, delta) {
  return shiftMonth(period.year, period.month, delta)
}
