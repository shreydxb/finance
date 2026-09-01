// Period-to-date ranges for the Overview's MTD/QTD/YTD control, and the
// trailing-month windows the cash-flow chart reads.
//
// Pure date arithmetic only. Every range is an inclusive [from, to] pair in the
// household's own calendar, matching `canonical_period_metrics`'s contract.

import { currentQuarter, currentYearMonth, monthRange, quarterRange, shiftMonth, yearRange } from '../../lib/period.js'
import { todayLocal } from '../../lib/dates.js'

export const PERIOD_OPTIONS = Object.freeze([
  { value: 'mtd', label: 'MTD', title: 'Month to date' },
  { value: 'qtd', label: 'QTD', title: 'Quarter to date' },
  { value: 'ytd', label: 'YTD', title: 'Year to date' },
])

export const PERIOD_KEYS = Object.freeze(PERIOD_OPTIONS.map((option) => option.value))

export function isPeriodKey(value) {
  return PERIOD_KEYS.includes(value)
}

function parseIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

/**
 * The inclusive range for a period-to-date selection.
 *
 * `to` is always today in the household timezone: a period-to-date figure that
 * ran to the end of the calendar month would silently include days that have
 * not happened.
 */
export function periodToDateRange(key, today = todayLocal()) {
  if (!isPeriodKey(key)) throw new Error(`Unknown Overview period: ${String(key)}`)
  const { year, month } = parseIsoDate(today)

  if (key === 'mtd') {
    return { key, from: monthRange(year, month).from, to: today, title: 'Month to date' }
  }
  if (key === 'qtd') {
    const quarter = Math.floor((month - 1) / 3) + 1
    return { key, from: quarterRange(year, quarter).from, to: today, title: 'Quarter to date' }
  }
  return { key, from: yearRange(year).from, to: today, title: 'Year to date' }
}

/**
 * The last `count` **completed** calendar months before today's month.
 *
 * Completed months only: mixing a part-month into a month-over-month series
 * makes the newest column look like a collapse in spending rather than a
 * shorter window. Ranges are inclusive at both ends to match the canonical
 * period contract.
 */
export function trailingCompletedMonths(count, today = todayLocal()) {
  if (!Number.isInteger(count) || count < 1) throw new Error('trailingCompletedMonths needs a positive count')
  const { year, month } = parseIsoDate(today)
  const months = []
  for (let offset = count; offset >= 1; offset -= 1) {
    const shifted = shiftMonth(year, month, -offset)
    const range = monthRange(shifted.year, shifted.month)
    months.push({ key: `${shifted.year}-${String(shifted.month).padStart(2, '0')}`, ...range })
  }
  return months
}

export { currentQuarter, currentYearMonth, todayLocal }
