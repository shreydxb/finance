/**
 * Activity's month window.
 *
 * Activity is a review surface over a calendar month, so its range is the
 * whole month rather than a period-to-date: an entry recorded later in the
 * month is exactly what the household came here to review.
 */

import { todayLocal } from '../../lib/dates.js'
import { currentYearMonth, monthLabel, monthRange, shiftMonth } from '../../lib/period.js'

export function isMonthNumber(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12
}

export function isYearNumber(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 2000 && numeric <= 2100
}

export function monthPeriod({ year, month, today = todayLocal() } = {}) {
  const fallback = currentYearMonth(new Date(`${today}T00:00:00Z`))
  const resolvedYear = isYearNumber(year) ? Number(year) : fallback.year
  const resolvedMonth = isMonthNumber(month) ? Number(month) : fallback.month
  const { from, to } = monthRange(resolvedYear, resolvedMonth)
  return Object.freeze({
    year: resolvedYear,
    month: resolvedMonth,
    from,
    to,
    label: monthLabel(resolvedYear, resolvedMonth),
    isCurrentMonth: resolvedYear === fallback.year && resolvedMonth === fallback.month,
  })
}

export function stepMonth(period, delta) {
  return shiftMonth(period.year, period.month, delta)
}
