// Period resolution (Taskiv #51). Turns the closed `Period` vocabulary into
// concrete from/to dates plus a human label the bot's reply must always show
// — ambiguity about "this month" is where trust dies.
//
// Every date here is a plain YYYY-MM-DD calendar string, resolved once from
// `now` via `todayInTz` (Asia/Dubai) and never re-derived with
// `toISOString()` on a raw Date — that resolves in UTC and silently shifts
// anything between 00:00 and 04:00 Gulf time onto the previous calendar day.
// All further day/month/week arithmetic happens on that calendar string
// using UTC-midnight Date objects purely as a calendar calculator, the same
// pattern `_shared/store.ts`'s `shiftIsoDate` already uses.

import { todayInTz } from '../../_shared/dates.ts'
import type { Period, ResolvedPeriod } from './types.ts'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const date = toDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

function startOfMonth(iso: string): string {
  const { year, month } = parts(iso)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function endOfMonth(iso: string): string {
  const { year, month } = parts(iso)
  // Day 0 of next month = last day of this one.
  const date = new Date(Date.UTC(year, month, 0))
  return toIso(date)
}

function startOfPreviousMonth(iso: string): string {
  const { year, month } = parts(iso)
  const date = new Date(Date.UTC(year, month - 2, 1))
  return toIso(date)
}

/** Monday of the ISO week containing `iso` — the household's week start (no existing app convention to match; none of `src/` groups by week). */
function startOfWeek(iso: string): string {
  const date = toDate(iso)
  const dayOfWeek = date.getUTCDay() // 0 = Sunday .. 6 = Saturday
  const sinceMonday = (dayOfWeek + 6) % 7
  return addDays(iso, -sinceMonday)
}

function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const date = toDate(iso)
  return !Number.isNaN(date.getTime()) && toIso(date) === iso
}

function dayMonth(iso: string): string {
  const { day, month } = parts(iso)
  return `${day} ${MONTH_ABBR[month - 1]}`
}

function monthYearIfNeeded(iso: string, currentYear: number): string {
  const { year, month } = parts(iso)
  return year === currentYear ? MONTH_ABBR[month - 1] : `${MONTH_ABBR[month - 1]} ${year}`
}

/** "1–17 Aug" for a same-month range, "28 Jul – 4 Aug" across months, with a year appended only when it differs from the current one. */
function rangeLabel(from: string, to: string, currentYear: number): string {
  const f = parts(from)
  const t = parts(to)
  const suffix = (iso: string) => (parts(iso).year === currentYear ? '' : ` ${parts(iso).year}`)

  if (f.year === t.year && f.month === t.month) {
    return `${f.day}–${t.day} ${MONTH_ABBR[f.month - 1]}${suffix(to)}`
  }
  return `${dayMonth(from)}${suffix(from)} – ${dayMonth(to)}${suffix(to)}`
}

/** last_n_days is clamped here — the one bound period.ts owns; `limit` (recent_transactions) is plan.ts's job, not a period concern. */
const MIN_LAST_N_DAYS = 1
const MAX_LAST_N_DAYS = 730

export function resolvePeriod(period: Period, now: Date): ResolvedPeriod {
  const today = todayInTz(now)
  const currentYear = parts(today).year

  switch (period.kind) {
    case 'this_month': {
      const from = startOfMonth(today)
      return { from, to: today, label: rangeLabel(from, today, currentYear) }
    }
    case 'last_month': {
      const from = startOfPreviousMonth(today)
      const to = endOfMonth(from)
      return { from, to, label: monthYearIfNeeded(from, currentYear) }
    }
    case 'this_week': {
      const from = startOfWeek(today)
      return { from, to: today, label: rangeLabel(from, today, currentYear) }
    }
    case 'last_week': {
      const from = addDays(startOfWeek(today), -7)
      const to = addDays(from, 6)
      return { from, to, label: rangeLabel(from, to, currentYear) }
    }
    case 'ytd': {
      const from = `${currentYear}-01-01`
      return { from, to: today, label: rangeLabel(from, today, currentYear) }
    }
    case 'last_n_days': {
      const n = Math.min(MAX_LAST_N_DAYS, Math.max(MIN_LAST_N_DAYS, Math.round(period.n)))
      const from = addDays(today, -(n - 1))
      return { from, to: today, label: `last ${n} day${n === 1 ? '' : 's'}` }
    }
    case 'explicit': {
      if (!isValidIsoDate(period.from) || !isValidIsoDate(period.to)) {
        throw new RangeError(`explicit period has an invalid date: ${period.from}..${period.to}`)
      }
      if (period.from > period.to) {
        throw new RangeError(`explicit period is backwards: ${period.from} is after ${period.to}`)
      }
      return { from: period.from, to: period.to, label: rangeLabel(period.from, period.to, currentYear) }
    }
  }
}
