/**
 * Calendar windows for Money → Insights.
 *
 * These helpers choose inclusive date ranges only. They do not calculate a
 * financial comparison, trend or average. Every value later shown for one of
 * these windows still comes from `canonical_period_metrics` or
 * `canonical_budget_actuals`.
 */

import { todayLocal } from '../../lib/dates.js'
import {
  currentYearMonth,
  monthLabel,
  monthRange,
  quarterRange,
  shiftMonth,
  yearRange,
} from '../../lib/period.js'

export const INSIGHTS_PERIOD_OPTIONS = Object.freeze([
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
])

export const INSIGHTS_VIEW_OPTIONS = Object.freeze([
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'trends', label: 'History' },
  { value: 'compare', label: 'Compare' },
])

export function isInsightsPeriod(value) {
  return INSIGHTS_PERIOD_OPTIONS.some((option) => option.value === value)
}

export function isInsightsView(value) {
  return INSIGHTS_VIEW_OPTIONS.some((option) => option.value === value)
}

function validYear(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 2000 && numeric <= 2100
}

function validMonth(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12
}

function validQuarter(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 4
}

function todayParts(today) {
  return currentYearMonth(new Date(`${today}T00:00:00Z`))
}

function comparePeriod(left, right) {
  return left.year === right.year && left.index === right.index
}

export function insightsPeriod({ kind = 'month', year, month, quarter, today = todayLocal() } = {}) {
  const current = todayParts(today)
  const resolvedKind = isInsightsPeriod(kind) ? kind : 'month'
  const resolvedYear = validYear(year) ? Number(year) : current.year

  if (resolvedKind === 'year') {
    const range = yearRange(resolvedYear)
    const period = {
      kind: 'year',
      year: resolvedYear,
      month: validMonth(month) ? Number(month) : current.month,
      quarter: validQuarter(quarter) ? Number(quarter) : Math.floor((current.month - 1) / 3) + 1,
      index: resolvedYear,
      label: String(resolvedYear),
      ...range,
    }
    return Object.freeze({ ...period, isCurrent: comparePeriod(period, { year: current.year, index: current.year }) })
  }

  if (resolvedKind === 'quarter') {
    const resolvedQuarter = validQuarter(quarter) ? Number(quarter) : Math.floor((current.month - 1) / 3) + 1
    const range = quarterRange(resolvedYear, resolvedQuarter)
    const currentQuarter = Math.floor((current.month - 1) / 3) + 1
    const period = {
      kind: 'quarter',
      year: resolvedYear,
      month: validMonth(month) ? Number(month) : current.month,
      quarter: resolvedQuarter,
      index: resolvedQuarter,
      label: `Q${resolvedQuarter} ${resolvedYear}`,
      ...range,
    }
    return Object.freeze({ ...period, isCurrent: comparePeriod(period, { year: current.year, index: currentQuarter }) })
  }

  const resolvedMonth = validMonth(month) ? Number(month) : current.month
  const range = monthRange(resolvedYear, resolvedMonth)
  const period = {
    kind: 'month',
    year: resolvedYear,
    month: resolvedMonth,
    quarter: validQuarter(quarter) ? Number(quarter) : Math.floor((resolvedMonth - 1) / 3) + 1,
    index: resolvedMonth,
    label: monthLabel(resolvedYear, resolvedMonth),
    ...range,
  }
  return Object.freeze({ ...period, isCurrent: comparePeriod(period, { year: current.year, index: current.month }) })
}

export function stepInsightsPeriod(period, delta) {
  if (period.kind === 'year') return { year: period.year + delta, month: period.month, quarter: period.quarter }
  if (period.kind === 'quarter') {
    const ordinal = (period.year * 4) + (period.quarter - 1) + delta
    return {
      year: Math.floor(ordinal / 4),
      quarter: (ordinal % 4 + 4) % 4 + 1,
      month: period.month,
    }
  }
  const next = shiftMonth(period.year, period.month, delta)
  return { ...next, quarter: Math.floor((next.month - 1) / 3) + 1 }
}

/** Six completed calendar months immediately before the selected window. */
export function completedMonthsBefore(period, count = 6) {
  if (!Number.isInteger(count) || count < 1) throw new Error('completedMonthsBefore needs a positive count')
  const anchorYear = Number(period.from.slice(0, 4))
  const anchorMonth = Number(period.from.slice(5, 7))
  const windows = []
  for (let offset = count; offset >= 1; offset -= 1) {
    const shifted = shiftMonth(anchorYear, anchorMonth, -offset)
    const range = monthRange(shifted.year, shifted.month)
    windows.push(Object.freeze({
      key: `${shifted.year}-${String(shifted.month).padStart(2, '0')}`,
      year: shifted.year,
      month: shifted.month,
      label: monthLabel(shifted.year, shifted.month),
      ...range,
    }))
  }
  return Object.freeze(windows)
}
