import { todayLocal } from './dates.js'
import { reconcilesAtCents } from './canonicalPresentation.js'

export const COMPARISON_OPTIONS = [
  { key: 'week', label: 'This week vs last week' },
  { key: 'month', label: 'This month vs last month' },
  { key: 'month_last_year', label: 'This month vs last year' },
  { key: 'month_average', label: 'This month vs average month' },
  { key: 'year', label: 'This year vs last year' },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const parseIso = (value) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const daysInYear = (year) => ((year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365)
const addDays = (date, days) => {
  const value = parseIso(date)
  value.setUTCDate(value.getUTCDate() + days)
  return iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
}
const dayOffset = (from, to) => Math.floor((parseIso(to) - parseIso(from)) / 86400000)
const isoWeekday = (date) => (parseIso(date).getUTCDay() + 6) % 7

export function resolveComparisonPeriod(key, now = new Date()) {
  const today = todayLocal(now)
  const [year, month] = today.split('-').map(Number)

  if (key === 'week') {
    const currentFrom = addDays(today, -isoWeekday(today))
    return {
      current: { from: currentFrom, to: today, label: 'This week' },
      comparison: { from: addDays(currentFrom, -7), to: addDays(currentFrom, -1), label: 'Last week' },
      fetchFrom: addDays(currentFrom, -7), dayCount: 7,
    }
  }
  if (key === 'month') {
    const previous = new Date(Date.UTC(year, month - 2, 1))
    const py = previous.getUTCFullYear()
    const pm = previous.getUTCMonth() + 1
    return {
      current: { from: iso(year, month, 1), to: today, label: 'This month' },
      comparison: { from: iso(py, pm, 1), to: iso(py, pm, daysInMonth(py, pm)), label: 'Last month' },
      fetchFrom: iso(py, pm, 1), dayCount: daysInMonth(year, month),
    }
  }
  if (key === 'month_last_year') {
    return {
      current: { from: iso(year, month, 1), to: today, label: 'This month' },
      comparison: { from: iso(year - 1, month, 1), to: iso(year - 1, month, daysInMonth(year - 1, month)), label: `${MONTH_NAMES[month - 1]} ${year - 1}` },
      fetchFrom: iso(year - 1, month, 1), dayCount: daysInMonth(year, month),
    }
  }
  if (key === 'month_average') {
    const start = new Date(Date.UTC(year, month - 13, 1))
    const end = new Date(Date.UTC(year, month - 1, 0))
    return {
      current: { from: iso(year, month, 1), to: today, label: 'This month' },
      comparison: null,
      comparisonLabel: 'Average month (last 12 months)',
      fetchFrom: iso(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      dayCount: daysInMonth(year, month),
      averageWindow: {
        from: iso(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
        to: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
      },
    }
  }
  return {
    current: { from: iso(year, 1, 1), to: today, label: 'This year' },
    comparison: { from: iso(year - 1, 1, 1), to: iso(year - 1, 12, 31), label: String(year - 1) },
    fetchFrom: iso(year - 1, 1, 1), dayCount: daysInYear(year - 1),
  }
}

export function averageMonthRanges(window) {
  const ranges = []
  let cursor = window.from
  while (cursor <= window.to) {
    const [year, month] = cursor.split('-').map(Number)
    ranges.push({ from: iso(year, month, 1), to: iso(year, month, daysInMonth(year, month)) })
    const next = new Date(Date.UTC(year, month, 1))
    cursor = iso(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)
  }
  return ranges
}

function dailyConsumption(rows) {
  const values = new Map()
  for (const row of rows) {
    if (row.economic_classification !== 'consumption_spend') continue
    if (row.quality_status === 'incomplete' || row.consumption_spend_aed === null) return null
    values.set(row.date, (values.get(row.date) ?? 0) + row.consumption_spend_aed)
  }
  return values
}

function rangeTotal(daily, range) {
  let total = 0
  for (const [date, value] of daily) if (date >= range.from && date <= range.to) total += value
  return total
}

function validRange(daily, metrics, range) {
  return metrics?.quality_status !== 'incomplete'
    && metrics?.consumption_spend_aed !== null
    && reconcilesAtCents(rangeTotal(daily, range), metrics.consumption_spend_aed)
}

export function buildComparisonSeries({ rows, currentMetrics, comparisonMetrics = null, averageMetrics = [] }, resolved) {
  const daily = dailyConsumption(rows)
  const averageRanges = resolved.averageWindow ? averageMonthRanges(resolved.averageWindow) : []
  const currentValid = daily !== null && validRange(daily, currentMetrics, resolved.current)
  const comparisonValid = daily !== null && (resolved.comparison
    ? validRange(daily, comparisonMetrics, resolved.comparison)
    : averageMetrics.length === 12 && averageMetrics.every((metrics, index) => validRange(daily, metrics, averageRanges[index])))

  const currentDayCount = Math.min(resolved.dayCount, dayOffset(resolved.current.from, resolved.current.to) + 1)
  let currentCumulative = 0
  let comparisonCumulative = 0
  const points = []

  for (let offset = 0; offset < resolved.dayCount; offset += 1) {
    if (currentValid && offset < currentDayCount) currentCumulative += daily.get(addDays(resolved.current.from, offset)) ?? 0

    let hasComparison = false
    if (comparisonValid && resolved.comparison) {
      const date = addDays(resolved.comparison.from, offset)
      hasComparison = date <= resolved.comparison.to
      if (hasComparison) comparisonCumulative += daily.get(date) ?? 0
    } else if (comparisonValid) {
      const values = averageRanges
        .filter((range) => addDays(range.from, offset) <= range.to)
        .map((range) => daily.get(addDays(range.from, offset)) ?? 0)
      hasComparison = values.length > 0
      if (hasComparison) comparisonCumulative += values.reduce((sum, value) => sum + value, 0) / values.length
    }

    points.push({
      dayLabel: `Day ${offset + 1}`,
      current: currentValid && offset < currentDayCount ? currentCumulative : null,
      comparison: hasComparison ? comparisonCumulative : null,
    })
  }
  return {
    points,
    currentLabel: resolved.current.label,
    comparisonLabel: resolved.comparison?.label ?? resolved.comparisonLabel,
    quality: currentMetrics.quality_status === 'incomplete' || !currentValid ? 'incomplete' : currentMetrics.quality_status,
  }
}
