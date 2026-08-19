// Recurring-obligation occurrence maths (Taskiv #57). Ported from
// src/lib/recurringSchedule.js's nextDueDate/occursInMonth, generalised from
// "the next single occurrence" to "every occurrence inside a window" — the
// app only ever needed the former; the bot needs the latter to sum "what's
// due in the next 14 days."
//
// Lives in _shared/, not telegram-intake/query/, because the task calls for
// the Sprint 5 bill-due push (a separate Edge Function) to reuse this
// verbatim — build it standalone, not inline in the query.
//
// UTC ISO-string arithmetic throughout, not the browser Date localtime
// methods recurringSchedule.js uses — this runs in Deno with no local
// timezone to speak of, same reasoning as telegram-intake/query/period.ts's
// header comment. Same calendar result either way.

export interface RecurringRule {
  /** Day of month the obligation falls due, 1-31. null = no schedule set (a placeholder row with nothing to project — 19 of the household's 24 live rows are like this today). */
  dayOfMonth: number | null
  /** Empty = every month. Non-empty = only these month numbers (1-12) — the LIC premiums and flight allowances rely on this. */
  months: number[]
  /** Inclusive — an occurrence landing exactly on end_date still counts, one after it does not. */
  endDate: string | null
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function occurrenceIso(year: number, month: number, dayOfMonth: number): string {
  // day_of_month of 29/30/31 clamps to the last real day of a short month
  // (Feb 31 -> Feb 28, or 29 in a leap year) rather than rolling into the
  // next month — a bill due "the 31st" is due the 28th in February, not the
  // 3rd of March, per the task.
  const day = Math.min(dayOfMonth, daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Every occurrence of `rule` on or after `fromIso`, up to and including
 * `toIso` — both plain YYYY-MM-DD calendar strings. Reused verbatim by the
 * Sprint 5 bill-due push; keep this standalone, never inlined into
 * query/bills.ts.
 */
export function nextOccurrences(rule: RecurringRule, fromIso: string, toIso: string): string[] {
  if (!rule.dayOfMonth) return []
  const monthsFilter = rule.months.length > 0 ? new Set(rule.months) : null
  const [fromYear, fromMonth] = fromIso.split('-').map(Number)
  const occurrences: string[] = []
  let year = fromYear
  let month = fromMonth
  // 36 months of headroom is generous for a 1-90 day window even against a
  // restrictive months filter (worst case: one qualifying month a year).
  for (let i = 0; i < 36; i++) {
    const iso = occurrenceIso(year, month, rule.dayOfMonth)
    if (iso > toIso) break
    if (iso >= fromIso && (!monthsFilter || monthsFilter.has(month))) {
      if (!rule.endDate || iso <= rule.endDate) occurrences.push(iso)
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return occurrences
}
