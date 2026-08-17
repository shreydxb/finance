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
 * The card's last four digits, parsed from the account name.
 *
 * There is no dedicated column for this — every card account this project has
 * entered so far names itself "...NNNN" (e.g. "ENBD Noon CC ...1657"), so the
 * name is the source rather than duplicating it into a column that could
 * drift out of sync. Falls back to any trailing run of exactly four digits
 * for a name that doesn't use the "..." convention.
 */
export function parseLast4(name) {
  const dotted = name.match(/\.\.\.(\d{4})\b/)
  if (dotted) return dotted[1]
  const trailing = name.match(/(\d{4})\D*$/)
  return trailing ? trailing[1] : null
}

/**
 * The account name with its "...NNNN" trimmed out, for a header that already
 * shows the last four digits separately and doesn't need them twice.
 *
 * Only the digits are removed, not any parenthetical they sit inside — a name
 * like "0% Cash Advance (FAB Islamic Etihad CC ...0570)" keeps the bank/network
 * context in "(FAB Islamic Etihad CC)" rather than losing it along with the
 * digits.
 */
export function cardDisplayName(name) {
  return name
    .replace(/\.\.\.\d{4}/, '')
    .replace(/\(\s*\)/, '')
    .replace(/\s+\)/, ')')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Transactions for one account inside one date window, inclusive. */
function inWindow(transactions, accountId, start, end) {
  return transactions.filter((t) => t.account_id === accountId && t.date >= start && t.date <= end)
}

function sumAED(transactions, fxRates) {
  return transactions.reduce((sum, t) => sum + toAED(Number(t.amount) || 0, t.currency, fxRates), 0)
}

/**
 * Up to `count` statement cycles before the currently open one, most recent
 * first, each with its total spend — the trend behind "is this month running
 * normal or high", not a projection of anything.
 *
 * A cycle with zero transactions is still included (as a zero), not skipped:
 * a card that genuinely wasn't used for a month is a real data point, and
 * dropping it would bias the trend.
 */
export function previousCycles(account, transactions, fxRates, today, count = 6) {
  const cycles = []
  let cursor = statementCycle(account.statement_day, today)
  if (!cursor) return cycles
  for (let i = 0; i < count; i++) {
    // statementCycle(day, X) where X is the current cycle's own start date
    // returns that same cycle again (X falls inside it), so step back one
    // further day to actually land in the prior one.
    const oneEarlier = new Date(`${cursor.start}T00:00:00Z`)
    oneEarlier.setUTCDate(oneEarlier.getUTCDate() - 1)
    const priorAnchor = oneEarlier.toISOString().slice(0, 10)
    const priorCycle = statementCycle(account.statement_day, priorAnchor)
    if (!priorCycle) break
    const spend = sumAED(
      inWindow(transactions, account.id, priorCycle.start, priorCycle.end).filter((t) => t.category !== 'Transfer'),
      fxRates
    )
    cycles.push({ cycle: priorCycle, spend })
    cursor = priorCycle
  }
  return cycles
}

/**
 * Spend-in-cycle grouped by category, largest first. Transfers are excluded
 * — they are money moving between the household's own accounts, not spend,
 * the same rule the Budget screen already applies.
 */
export function categoryBreakdown(account, transactions, fxRates, cycle) {
  if (!cycle) return []
  const rows = inWindow(transactions, account.id, cycle.start, cycle.end).filter((t) => t.category !== 'Transfer')
  const total = sumAED(rows, fxRates)
  const byCategory = new Map()
  for (const t of rows) {
    const key = t.category || 'Uncategorised'
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    const entry = byCategory.get(key) ?? { category: key, total: 0, count: 0 }
    entry.total += aed
    entry.count += 1
    byCategory.set(key, entry)
  }
  return Array.from(byCategory.values())
    .map((e) => ({ ...e, pct: total > 0 ? (e.total / total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
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

  const inCycle = cycle ? inWindow(transactions, account.id, cycle.start, cycle.end) : []
  const spendRows = inCycle.filter((t) => t.category !== 'Transfer')
  const cycleSpend = sumAED(spendRows, fxRates)

  const due = nextDueDate(account.due_day, today)

  return {
    owed,
    limit,
    available: limit == null || !Number.isFinite(owed) ? null : limit - owed,
    utilisationPct: utilisation(owed, limit),
    cycle,
    cycleSpend: cycle ? cycleSpend : null,
    cycleCount: spendRows.length,
    dueDate: due,
    daysToDue: daysUntil(due, today),
    daysToClose: cycle ? daysUntil(cycle.end, today) : null,
  }
}
