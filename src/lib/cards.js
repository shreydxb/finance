// Credit-card statement-cycle arithmetic.
//
// Pure functions only — no Supabase import. Per CLAUDE.md, logic that lives in
// a module importing the client cannot be loaded by `node --test` and silently
// becomes untestable; that is how toAED, the transaction grouping and the
// recurring schedule rules all shipped carrying bugs. Data access stays in
// accounts.js, rules live here.
//
// Dates are handled as `YYYY-MM-DD` strings and integer parts, never as local
// Date objects, so nothing here depends on the browser's timezone. Callers pass
// today in from `dates.js`'s `todayLocal`, which resolves it in Asia/Dubai.

import { toAED } from './money.js'

function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Days in a given month. `month` is 1-12. */
export function lastDayOfMonth(year, month) {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * A statement day resolved against a specific month.
 *
 * A card that closes on the 31st has no 31st in February. Banks roll that back
 * to the last day of the month rather than forward, so a February statement
 * closes on the 28th (or 29th), not on 1 March.
 */
export function clampDay(day, year, month) {
  return Math.min(day, lastDayOfMonth(year, month))
}

function shift({ year, month }, delta) {
  const zero = year * 12 + (month - 1) + delta
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 }
}

/**
 * The statement date on or after `today` — the day the open cycle closes.
 *
 * Returns null when `statementDay` is unset, which is the normal state for a
 * card whose cycle nobody has entered yet.
 */
export function cycleCloseDate(statementDay, today) {
  if (!statementDay) return null
  const { year, month, day } = parseDate(today)
  const thisMonth = clampDay(statementDay, year, month)
  if (thisMonth >= day) return formatDate(year, month, thisMonth)
  const next = shift({ year, month }, 1)
  return formatDate(next.year, next.month, clampDay(statementDay, next.year, next.month))
}

/**
 * The open statement cycle as an inclusive `{ start, end }` window.
 *
 * The cycle ends on the closing date and begins the day after the previous
 * one closed, so a card closing on the 17th viewed on 16 August covers
 * 18 July - 17 August.
 */
export function statementCycle(statementDay, today) {
  const end = cycleCloseDate(statementDay, today)
  if (!end) return null
  const { year, month } = parseDate(end)
  const prevMonth = shift({ year, month }, -1)
  const prevClose = clampDay(statementDay, prevMonth.year, prevMonth.month)
  // The day after the previous close, which may roll into the next month when
  // the previous close was that month's last day.
  const startMs = Date.UTC(prevMonth.year, prevMonth.month - 1, prevClose + 1)
  const start = new Date(startMs)
  return {
    start: formatDate(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
    end,
  }
}

/** The next payment due date on or after `today`. Null when `dueDay` is unset. */
export function nextDueDate(dueDay, today) {
  return cycleCloseDate(dueDay, today)
}

/** Whole days from `today` to `iso`. Negative when `iso` is in the past. */
export function daysUntil(iso, today) {
  if (!iso) return null
  const a = parseDate(iso)
  const b = parseDate(today)
  const ms = Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)
  return Math.round(ms / 86400000)
}

/**
 * Utilisation as a percentage, or null when it cannot be computed.
 *
 * Null rather than 0 when the limit is unknown: "we don't know" and "you've
 * used none of it" are different answers, and only one of them should draw a
 * progress bar. The migration rejects a zero limit for the same reason.
 */
export function utilisation(owed, limit) {
  if (!limit || limit <= 0) return null
  if (!Number.isFinite(owed)) return null
  return (owed / limit) * 100
}

/**
 * Everything the Accounts screen needs to describe one credit card.
 *
 * `owed` is the balance carried on the account row, which someone maintains by
 * hand from the bank app. `cycleSpend` is the total of transactions actually
 * logged against this card inside the open cycle — a *floor*, never a
 * forecast, because it only counts what intake captured. The two are reported
 * separately and must never be added together or presented as the same figure;
 * see docs/telegram-bot-sprint-plan.md §6.2 for why an understated statement
 * estimate is more dangerous than none at all.
 */
export function cardSummary(account, transactions, fxRates, today) {
  const owed = toAED(Number(account.value) || 0, account.currency, fxRates)
  const limitRaw = account.credit_limit == null ? null : Number(account.credit_limit)
  const limit = limitRaw == null ? null : toAED(limitRaw, account.currency, fxRates)
  const cycle = statementCycle(account.statement_day, today)

  const inCycle = cycle
    ? transactions.filter((t) => t.account_id === account.id && t.date >= cycle.start && t.date <= cycle.end)
    : []
  const cycleSpend = inCycle.reduce((sum, t) => sum + toAED(Number(t.amount) || 0, t.currency, fxRates), 0)

  const due = nextDueDate(account.due_day, today)

  return {
    owed,
    limit,
    available: limit == null || !Number.isFinite(owed) ? null : limit - owed,
    utilisationPct: utilisation(owed, limit),
    cycle,
    cycleSpend: cycle ? cycleSpend : null,
    cycleCount: inCycle.length,
    dueDate: due,
    daysToDue: daysUntil(due, today),
    daysToClose: cycle ? daysUntil(cycle.end, today) : null,
  }
}
