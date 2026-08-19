// Upcoming bills & payments (Taskiv #57). The occurrence maths itself lives
// in ../../_shared/recurringSchedule.ts (reused verbatim by the future
// Sprint 5 bill-due push) — this module only expands the whole `recurring`
// table through it, converts to AED, sums the totals, and formats the reply.

import { formatAmount, formatDate } from '../format.ts'
import { nextOccurrences } from '../../_shared/recurringSchedule.ts'
import type { RecurringRule } from '../../_shared/recurringSchedule.ts'
import type { BillOccurrence, RecurringEntry, UpcomingBillsResult } from './types.ts'

export const DEFAULT_DAYS = 14
const MIN_DAYS = 1
const MAX_DAYS = 90

export function clampDays(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(raw)))
}

/** Ported from src/lib/money.js's toAED — null (not NaN) when the rate is unknown. */
function convertToAed(value: number, currency: string, fxRates: Record<string, number>): number | null {
  if (currency === 'AED') return value
  const rate = fxRates[currency]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  return value * rate
}

function addDaysIso(todayIso: string, days: number): string {
  const [year, month, day] = todayIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/**
 * Projects every `recurring` row through its window, splits income from
 * bills (income never sums into what's owed — the task's own rule), and
 * totals both the full due amount and the not-on-autopay subtotal, which is
 * the actionable number.
 */
export function computeUpcomingBills(
  entries: RecurringEntry[],
  days: number,
  fxRates: Record<string, number>,
  todayIso: string
): UpcomingBillsResult {
  const toIso = addDaysIso(todayIso, days - 1)
  const bills: BillOccurrence[] = []
  const income: BillOccurrence[] = []

  for (const entry of entries) {
    const rule: RecurringRule = { dayOfMonth: entry.dayOfMonth, months: entry.months, endDate: entry.endDate }
    for (const date of nextOccurrences(rule, todayIso, toIso)) {
      const occurrence: BillOccurrence = {
        date,
        name: entry.name,
        amount: entry.amount,
        currency: entry.currency,
        amountAed: convertToAed(entry.amount, entry.currency, fxRates),
        autopay: entry.autopay,
        kind: entry.kind,
      }
      if (entry.kind === 'income') income.push(occurrence)
      else bills.push(occurrence)
    }
  }

  const byDate = (a: BillOccurrence, b: BillOccurrence) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  bills.sort(byDate)
  income.sort(byDate)

  let totalDueAed = 0
  let totalDueUnconvertedCount = 0
  let notOnAutopayAed = 0
  let notOnAutopayUnconvertedCount = 0
  for (const b of bills) {
    if (b.amountAed === null) {
      totalDueUnconvertedCount += 1
      if (!b.autopay) notOnAutopayUnconvertedCount += 1
      continue
    }
    totalDueAed += b.amountAed
    if (!b.autopay) notOnAutopayAed += b.amountAed
  }

  return { days, bills, income, totalDueAed, totalDueUnconvertedCount, notOnAutopayAed, notOnAutopayUnconvertedCount }
}

function unconvertedSuffix(count: number): string {
  if (count === 0) return ''
  return ` (${count} could not be converted — check the FX rate)`
}

function billLine(b: BillOccurrence): string {
  const amountText = b.amountAed === null ? `${formatAmount(b.amount)} ${b.currency} (unconverted)` : `${formatAmount(b.amountAed)} AED`
  const autopayText = b.autopay ? '  (autopay)' : ''
  return `${formatDate(b.date)}  ${b.name}  ${amountText}${autopayText}`
}

export function formatUpcomingBillsReply(result: UpcomingBillsResult): string {
  const header = `Next ${result.days} day${result.days === 1 ? '' : 's'}`

  if (result.bills.length === 0 && result.income.length === 0) {
    return `${header}\n\nNothing due.`
  }

  const lines = [header, '']
  if (result.bills.length === 0) {
    lines.push('No bills due.')
  } else {
    for (const b of result.bills) lines.push(billLine(b))
  }
  lines.push('')
  lines.push(`Total due: ${formatAmount(result.totalDueAed)} AED${unconvertedSuffix(result.totalDueUnconvertedCount)}`)
  lines.push(`Not on autopay: ${formatAmount(result.notOnAutopayAed)} AED${unconvertedSuffix(result.notOnAutopayUnconvertedCount)}`)

  if (result.income.length > 0) {
    lines.push('', 'Coming in')
    for (const inc of result.income) lines.push(billLine(inc))
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}
