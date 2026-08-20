// Reports → Spending's "this period vs a comparison period" chart (Taskiv
// #103) — Monarch-parity. Pure date/aggregation logic; no Supabase import so
// it's testable under `node --test` the same way reports.js is.
//
// The screen fetches one wide window of transactions (resolveComparisonPeriod
// tells it how wide) and this module turns that flat list into two cumulative
// daily series indexed by day-of-period, so "day 12 of this month" always
// lines up under "day 12 of last month" regardless of month length.

import { toAED } from './money.js'
import { isSpend } from './reports.js'

export const COMPARISON_OPTIONS = [
  { key: 'week', label: 'This week vs last week' },
  { key: 'month', label: 'This month vs last month' },
  { key: 'month_last_year', label: 'This month vs last year' },
  { key: 'month_average', label: 'This month vs average month' },
  { key: 'year', label: 'This year vs last year' },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n) {
  return String(n).padStart(2, '0')
}

function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate()
}

/** Adds `n` days to an ISO date string, returning an ISO date string. */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** Monday = 0 .. Sunday = 6, matching the rest of the app's week convention (period.js has none, but Reports/Budget both treat Monday as the week start). */
function isoWeekday(d) {
  return (d.getDay() + 6) % 7
}

/**
 * Everything the screen needs to fetch data and render one comparison:
 * the current period (always ending "today", since the rest hasn't
 * happened yet), the comparison period (a real past period — null only for
 * `month_average`, whose comparison isn't one period but an average across
 * twelve), the widest date range to fetch, and how many days the chart's
 * x-axis needs.
 */
export function resolveComparisonPeriod(key, today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const d = today.getDate()
  const todayIso = iso(y, m, d)

  if (key === 'week') {
    const offset = isoWeekday(today)
    const mondayIso = addDays(todayIso, -offset)
    const lastMondayIso = addDays(mondayIso, -7)
    const lastSundayIso = addDays(mondayIso, -1)
    return {
      current: { from: mondayIso, to: todayIso, label: 'This week' },
      comparison: { from: lastMondayIso, to: lastSundayIso, label: 'Last week' },
      fetchFrom: lastMondayIso,
      dayCount: 7,
    }
  }

  if (key === 'month') {
    const prev = new Date(y, m - 2, 1)
    const py = prev.getFullYear()
    const pm = prev.getMonth() + 1
    return {
      current: { from: iso(y, m, 1), to: todayIso, label: 'This month' },
      comparison: { from: iso(py, pm, 1), to: iso(py, pm, daysInMonth(py, pm)), label: 'Last month' },
      fetchFrom: iso(py, pm, 1),
      dayCount: daysInMonth(y, m),
    }
  }

  if (key === 'month_last_year') {
    return {
      current: { from: iso(y, m, 1), to: todayIso, label: 'This month' },
      comparison: { from: iso(y - 1, m, 1), to: iso(y - 1, m, daysInMonth(y - 1, m)), label: `${MONTH_NAMES[m - 1]} ${y - 1}` },
      fetchFrom: iso(y - 1, m, 1),
      dayCount: daysInMonth(y, m),
    }
  }

  if (key === 'month_average') {
    // The 12 full calendar months immediately before this one.
    const start = new Date(y, m - 13, 1)
    const end = new Date(y, m - 1, 0) // day 0 of the current month = last day of the prior month
    return {
      current: { from: iso(y, m, 1), to: todayIso, label: 'This month' },
      comparison: null,
      comparisonLabel: 'Average month (last 12 months)',
      fetchFrom: iso(start.getFullYear(), start.getMonth() + 1, 1),
      dayCount: daysInMonth(y, m),
      averageWindow: {
        from: iso(start.getFullYear(), start.getMonth() + 1, 1),
        to: iso(end.getFullYear(), end.getMonth() + 1, end.getDate()),
      },
    }
  }

  // 'year' — the axis spans the full comparison year (last year, complete),
  // same as month comparisons span the full month; the current year's series
  // just stops early via currentDayCount in buildComparisonSeries.
  return {
    current: { from: iso(y, 1, 1), to: todayIso, label: 'This year' },
    comparison: { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), label: String(y - 1) },
    fetchFrom: iso(y - 1, 1, 1),
    dayCount: daysInYear(y - 1),
  }
}

function daysInYear(y) {
  return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365
}

/** AED spend total for one calendar day, excluding transfers. */
function daySpendAED(transactions, dateStr, fxRates) {
  let sum = 0
  for (const t of transactions) {
    if (t.date !== dateStr || !isSpend(t)) continue
    sum += toAED(Number(t.amount) || 0, t.currency, fxRates)
  }
  return sum
}

/**
 * Builds the two cumulative series for the chart, day-offset aligned (day 0
 * of "this month" lines up with day 0 of "last month" even though the
 * calendar dates differ). The comparison series stops early only for
 * `month_average`'s window edge; a real past comparison period runs to its
 * own end even past where the current period's data (today) stops, exactly
 * like Monarch's dashed reference line does.
 */
export function buildComparisonSeries(transactions, fxRates, resolved, today = new Date()) {
  const todayIso = iso(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const currentDayCount = Math.min(resolved.dayCount, Math.floor((new Date(todayIso) - new Date(resolved.current.from)) / 86400000) + 1)

  let averageByOffset = null
  if (!resolved.comparison) {
    averageByOffset = averageDailySpendByDayOfMonth(transactions, fxRates, resolved.averageWindow)
  }

  const points = []
  let currentCum = 0
  let comparisonCum = 0
  for (let offset = 0; offset < resolved.dayCount; offset++) {
    const inCurrentRange = offset < currentDayCount
    if (inCurrentRange) {
      currentCum += daySpendAED(transactions, addDays(resolved.current.from, offset), fxRates)
    }

    let comparisonHasValue
    if (resolved.comparison) {
      const comparisonDate = addDays(resolved.comparison.from, offset)
      comparisonHasValue = comparisonDate <= resolved.comparison.to
      if (comparisonHasValue) comparisonCum += daySpendAED(transactions, comparisonDate, fxRates)
    } else {
      comparisonHasValue = offset < 31 && averageByOffset[offset + 1] !== undefined
      if (comparisonHasValue) comparisonCum += averageByOffset[offset + 1]
    }

    points.push({
      dayLabel: `Day ${offset + 1}`,
      current: inCurrentRange ? currentCum : null,
      comparison: comparisonHasValue ? comparisonCum : null,
    })
  }

  return {
    points,
    currentLabel: resolved.current.label,
    comparisonLabel: resolved.comparison?.label ?? resolved.comparisonLabel,
  }
}

/** Average AED spend for each day-of-month (1-31) across every month in `window`, skipping months that don't have that day (e.g. day 31 in Feb). */
function averageDailySpendByDayOfMonth(transactions, fxRates, window) {
  const totals = new Map() // day -> { sum, count }
  let cursor = window.from
  while (cursor <= window.to) {
    const [y, m] = cursor.split('-').map(Number)
    const lastDay = daysInMonth(y, m)
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = iso(y, m, day)
      const entry = totals.get(day) ?? { sum: 0, count: 0 }
      entry.sum += daySpendAED(transactions, dateStr, fxRates)
      entry.count += 1
      totals.set(day, entry)
    }
    // `m` is 1-indexed, so passing it straight through as the (0-indexed)
    // month argument lands one month ahead — Date normalizes December's
    // overflow into January of the next year automatically.
    const next = new Date(y, m, 1)
    cursor = iso(next.getFullYear(), next.getMonth() + 1, 1)
  }
  const averages = {}
  for (const [day, { sum, count }] of totals) {
    averages[day] = count > 0 ? sum / count : 0
  }
  return averages
}
