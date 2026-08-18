// Budget-vs-actual formatting (Taskiv #54). Kept separate from reply.ts
// because the shaping here — grouping by status, sorting, the unbudgeted
// split, the single-category daily-pace line — is genuinely more involved
// than every other query's one-liner, and the task calls for its own test
// file (query/budget.test.ts) exercising it without a Telegram harness.
//
// The one rule that must never be broken: a category with no `budgets` row
// is not a category with a zero limit. `classify` below treats `limitAed`
// of `null` *or* `0` identically as "unbudgeted" — a limit nobody can ever
// exceed is not a limit — and neither ever reaches the Over/Close/On track
// grouping, only the separate "No budget set" line.

import { formatAmount } from '../format.ts'
import type { CategoryBudgetRow, ResolvedPeriod } from './types.ts'

export type BudgetBucket = 'over' | 'close' | 'on_track'

export interface ClassifiedRow {
  category: string
  limitAed: number
  spentAed: number
  pct: number
  bucket: BudgetBucket
}

const CLOSE_THRESHOLD_PCT = 80

/** `null` or `0` are both "no real limit" — see the file header. */
function hasBudget(row: CategoryBudgetRow): row is CategoryBudgetRow & { limitAed: number } {
  return row.limitAed !== null && row.limitAed > 0
}

export function classify(row: CategoryBudgetRow & { limitAed: number }): ClassifiedRow {
  const pct = (row.spentAed / row.limitAed) * 100
  const bucket: BudgetBucket = pct > 100 ? 'over' : pct >= CLOSE_THRESHOLD_PCT ? 'close' : 'on_track'
  return { category: row.category, limitAed: row.limitAed, spentAed: row.spentAed, pct, bucket }
}

export function partitionAndClassify(rows: CategoryBudgetRow[]): {
  classified: ClassifiedRow[]
  unbudgeted: CategoryBudgetRow[]
} {
  const classified: ClassifiedRow[] = []
  const unbudgeted: CategoryBudgetRow[] = []
  for (const row of rows) {
    if (hasBudget(row)) {
      classified.push(classify(row))
    } else {
      unbudgeted.push(row)
    }
  }
  return { classified, unbudgeted }
}

const GRID_ROW_CAP = 15
const UNBUDGETED_NAME_CAP = 4

const BUCKET_LABEL: Record<BudgetBucket, string> = { over: 'Over', close: 'Close', on_track: 'On track' }
const BUCKET_ORDER: BudgetBucket[] = ['over', 'close', 'on_track']

function gridLine(row: ClassifiedRow): string {
  const warn = row.bucket === 'over' ? ' ⚠️' : ''
  return `  ${row.category.padEnd(16)}${formatAmount(row.spentAed)} / ${formatAmount(row.limitAed)}   ${Math.round(row.pct)}%${warn}`
}

/** Days elapsed / remaining in the calendar month `period.from` starts, as of `period.to` — only meaningful when the caller has confirmed this is `this_month` (see `isCurrentMonth` on BudgetStatusResult). */
function monthProgress(period: ResolvedPeriod): { dayOfMonth: number; daysInMonth: number } {
  const [fromYear, fromMonth] = period.from.split('-').map(Number)
  const dayOfMonth = Number(period.to.split('-')[2])
  const daysInMonth = new Date(Date.UTC(fromYear, fromMonth, 0)).getUTCDate()
  return { dayOfMonth, daysInMonth }
}

function formatGrid(rows: CategoryBudgetRow[], period: ResolvedPeriod, isCurrentMonth: boolean): string {
  const { classified, unbudgeted } = partitionAndClassify(rows)
  const byBucket = new Map<BudgetBucket, ClassifiedRow[]>(BUCKET_ORDER.map((b) => [b, []]))
  for (const row of classified) byBucket.get(row.bucket)!.push(row)
  for (const list of byBucket.values()) list.sort((a, b) => b.pct - a.pct)

  const header = isCurrentMonth
    ? `Budget — ${period.label} (${monthProgressLabel(period)})`
    : `Budget — ${period.label}`

  const sections: string[] = [header, '']
  let shown = 0
  let truncated = false
  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket)!
    if (list.length === 0) continue
    const remaining = GRID_ROW_CAP - shown
    if (remaining <= 0) {
      truncated = true
      break
    }
    const take = list.slice(0, remaining)
    if (take.length < list.length) truncated = true
    shown += take.length
    sections.push(BUCKET_LABEL[bucket], ...take.map(gridLine), '')
  }
  if (truncated) {
    const totalRows = classified.length
    sections.push(`+${totalRows - shown} more — see the Budget tab`, '')
  }

  if (unbudgeted.length > 0) {
    const names = unbudgeted.slice(0, UNBUDGETED_NAME_CAP).map((r) => r.category)
    const extra = unbudgeted.length - names.length
    const nameList = extra > 0 ? `${names.join(', ')} (+${extra} more)` : names.join(', ')
    const unbudgetedTotal = unbudgeted.reduce((sum, r) => sum + r.spentAed, 0)
    sections.push(`No budget set: ${nameList}`, `Unbudgeted spend this month: ${formatAmount(unbudgetedTotal)} AED`)
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

function monthProgressLabel(period: ResolvedPeriod): string {
  const { dayOfMonth, daysInMonth } = monthProgress(period)
  const left = daysInMonth - dayOfMonth
  return `${dayOfMonth} days in, ${left} left`
}

function formatSingleCategory(category: string, row: CategoryBudgetRow, period: ResolvedPeriod, isCurrentMonth: boolean): string {
  if (!hasBudget(row)) {
    return row.spentAed > 0
      ? `No budget set for ${category}. Spent ${formatAmount(row.spentAed)} AED in ${period.label}.`
      : `No budget set for ${category}, and nothing spent in ${period.label}.`
  }
  if (row.spentAed === 0) {
    return `${category}: nothing spent yet of ${formatAmount(row.limitAed)} AED in ${period.label}.`
  }
  const { pct } = classify(row)
  const remaining = row.limitAed - row.spentAed
  const lines = [
    `${category} — ${period.label}`,
    `${formatAmount(row.spentAed)} of ${formatAmount(row.limitAed)} AED · ${formatAmount(Math.max(0, remaining))} left · ${Math.round(pct)}%`,
  ]
  if (isCurrentMonth && remaining > 0) {
    const { dayOfMonth, daysInMonth } = monthProgress(period)
    const daysLeft = daysInMonth - dayOfMonth
    if (daysLeft > 0) {
      lines.push(`${daysLeft} days left, ~${formatAmount(remaining / daysLeft)}/day to stay inside.`)
    }
  }
  return lines.join('\n')
}

export function formatBudgetStatusReply(category: string | undefined, rows: CategoryBudgetRow[], period: ResolvedPeriod, isCurrentMonth: boolean): string {
  if (category) {
    const row = rows.find((r) => r.category === category) ?? { category, limitAed: null, spentAed: 0 }
    return formatSingleCategory(category, row, period, isCurrentMonth)
  }
  return formatGrid(rows, period, isCurrentMonth)
}
