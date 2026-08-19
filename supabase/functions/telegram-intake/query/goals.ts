// Goal & debt progress (Taskiv #56). Every formula here is ported from
// `src/screens/Goals.jsx` and `src/screens/Debts.jsx`, not reinvented — the
// task's own rule: a bot reporting different progress than those screens is
// worse than no bot. Only the presentation differs (chat lines instead of a
// progress bar).
//
// save_up: `saved` is the linked account's AED balance when one exists
// (Goals.jsx's `savedFor`), otherwise the sum of logged contributions.
// `starting_balance` is NOT part of this — Goals.jsx never reads it for
// save_up, only Debts.jsx does, for pay_down.
//
// pay_down: progress is `starting_balance` minus the linked account's
// current AED balance (Debts.jsx's `DebtCard`/`DebtDetail`) — never
// contributions. When the linked account is gone, `current` falls back to
// `starting_balance` (0% paid), the same fallback Debts.jsx uses.

import { formatAmount, formatDate } from '../format.ts'
import type { GoalContribution, GoalProgressResult, GoalRecord } from './types.ts'

const WEAK_GOAL_TOKENS = new Set(['the', 'a', 'my', 'our', 'fund', 'goal'])

/** Same token-scoring approach as accountMatch.ts's matchAccount — a goal name is exactly the kind of thing people paraphrase ("the emergency fund", "EF"). */
function bestGoalMatch(guess: string | null, goals: GoalRecord[]): { best: GoalRecord | null; tied: GoalRecord[] } {
  if (!guess) return { best: null, tied: [] }
  const wanted = simplify(guess)
  if (wanted === '') return { best: null, tied: [] }
  const wantedTokens = wanted.split(' ').filter(Boolean)
  const scored = goals.map((goal) => ({ goal, score: scoreGoal(goal, wanted, wantedTokens) }))
  const top = scored.reduce<{ goal: GoalRecord; score: number } | null>(
    (best, entry) => (!best || entry.score > best.score ? entry : best),
    null
  )
  if (!top || top.score < 12) return { best: null, tied: [] }
  const tiedWith = scored.filter((entry) => entry.goal !== top.goal && entry.score === top.score)
  if (tiedWith.length === 0) return { best: top.goal, tied: [] }
  return { best: null, tied: [top.goal, ...tiedWith.map((e) => e.goal)] }
}

function scoreGoal(goal: GoalRecord, wanted: string, wantedTokens: string[]): number {
  const name = simplify(goal.name)
  if (name === wanted) return 100
  let score = 0
  const hasStrongToken = wantedTokens.some((token) => !WEAK_GOAL_TOKENS.has(token))
  if (hasStrongToken && (name.includes(wanted) || wanted.includes(name))) score += 40
  for (const token of name.split(' ').filter(Boolean)) {
    if (!wantedTokens.includes(token)) continue
    score += WEAK_GOAL_TOKENS.has(token) ? 2 : 12
  }
  return score
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

export function matchGoal(guess: string | null, goals: GoalRecord[]): GoalRecord | null {
  return bestGoalMatch(guess, goals).best
}

export function matchGoalTies(guess: string | null, goals: GoalRecord[]): GoalRecord[] {
  return bestGoalMatch(guess, goals).tied
}

/** Ported from src/lib/money.js's toAED — null (not NaN) when the rate is unknown. */
function convertToAed(value: number, currency: string, fxRates: Record<string, number>): number | null {
  if (currency === 'AED') return value
  const rate = fxRates[currency]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  return value * rate
}

/** Ported from Goals.jsx's savedFor. */
export function savedAed(goal: GoalRecord, fxRates: Record<string, number>): number | null {
  if (goal.linkedAccount) return convertToAed(goal.linkedAccount.value, goal.linkedAccount.currency, fxRates)
  return goal.contributions.reduce((sum, c) => sum + c.amount, 0)
}

/** Ported from Goals.jsx's SaveUpCard/GoalDetail, except a 0/null target reports the absolute figure only (no fabricated "0%"), per the task's own edge case. */
export function savedPct(goal: GoalRecord, saved: number | null): number | null {
  if (saved === null) return null
  if (!goal.targetAmount || goal.targetAmount <= 0) return null
  return (saved / goal.targetAmount) * 100
}

/** Ported from Debts.jsx's DebtCard/DebtDetail. */
export function currentAed(goal: GoalRecord, fxRates: Record<string, number>): number | null {
  if (goal.linkedAccount) return convertToAed(goal.linkedAccount.value, goal.linkedAccount.currency, fxRates)
  return goal.startingBalance ?? 0
}

export function paidOffAed(goal: GoalRecord, current: number | null): number | null {
  if (current === null) return null
  return Math.max(0, (goal.startingBalance ?? 0) - current)
}

/** Ported from Debts.jsx as-is — starting_balance of 0 reads as 0% paid, not "no percentage" (unlike the target_amount case above; Debts.jsx never omits this one). */
export function paidOffPct(goal: GoalRecord, paidOff: number | null): number | null {
  if (paidOff === null) return null
  const starting = goal.startingBalance ?? 0
  return starting > 0 ? (paidOff / starting) * 100 : 0
}

/**
 * Calendar-month arithmetic on the ISO string rather than a browser Date's
 * local getFullYear()/getMonth() the way goals.js's projectedCompletionDate
 * does it — this runs in Deno with no local timezone to speak of, and the
 * rest of this codebase already avoids local Date methods for exactly that
 * reason (see period.ts's header comment). Same calendar result either way.
 */
function addMonthsIso(todayIso: string, months: number): string {
  const [year, month, day] = todayIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10)
}

/** Ported from goals.js's projectedCompletionDate. */
function projectedSaveUpDate(remaining: number, monthlyPlan: number | null, todayIso: string): string | null {
  if (!monthlyPlan || monthlyPlan <= 0 || remaining <= 0) return null
  const months = Math.ceil(remaining / monthlyPlan)
  return addMonthsIso(todayIso, months)
}

const MAX_FD_MONTHS = 600 // matches goals.js's projectedFDCompletion cap exactly

/** Ported from goals.js's projectedFDCompletion. */
function projectedFdDate(currentValue: number, targetAmount: number, annualRatePct: number, monthlyPlan: number, todayIso: string): string | null {
  if (currentValue >= targetAmount) return todayIso
  const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12
  if (monthlyRate <= 0 && monthlyPlan <= 0) return null
  let balance = currentValue
  for (let months = 1; months <= MAX_FD_MONTHS; months++) {
    balance = balance * (1 + monthlyRate) + monthlyPlan
    if (balance >= targetAmount) return addMonthsIso(todayIso, months)
  }
  return null
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(iso: string): string {
  const [year, month] = iso.split('-').map(Number)
  return `${MONTH_ABBR[month - 1]} ${year}`
}

function lastContribution(goal: GoalRecord): GoalContribution | null {
  if (goal.contributions.length === 0) return null
  return goal.contributions.reduce((latest, c) => (c.date > latest.date ? c : latest))
}

/** save_up pace: "{monthly}/mo planned · on track for {month}" — null (omitted) whenever monthly_plan is null/0, per the task's edge case. Never divides by zero. */
function saveUpPaceLine(goal: GoalRecord, saved: number | null, todayIso: string): string | null {
  if (saved === null || !goal.monthlyPlan || goal.monthlyPlan <= 0) return null
  if (goal.targetAmount == null) return `${formatAmount(goal.monthlyPlan)}/mo planned`
  const remaining = Math.max(0, goal.targetAmount - saved)
  if (remaining <= 0) return `${formatAmount(goal.monthlyPlan)}/mo planned · reached ✓`
  const isFd = goal.linkedAccount?.type === 'fixed_deposit' && goal.linkedAccount.interestRate != null
  const projected = isFd
    ? projectedFdDate(saved, goal.targetAmount, goal.linkedAccount!.interestRate!, goal.monthlyPlan, todayIso)
    : projectedSaveUpDate(remaining, goal.monthlyPlan, todayIso)
  if (!projected) return `${formatAmount(goal.monthlyPlan)}/mo planned`
  const onTrack = !goal.targetDate || projected <= goal.targetDate
  return onTrack
    ? `${formatAmount(goal.monthlyPlan)}/mo planned · on track for ${monthLabel(projected)}`
    : `${formatAmount(goal.monthlyPlan)}/mo planned · projected ${monthLabel(projected)} — later than the ${monthLabel(goal.targetDate!)} target`
}

/** pay_down pace: the app never computes a payoff projection for a debt (Debts.jsx just echoes the stored target_date) — mirrored here rather than inventing one. */
function payDownPaceLine(goal: GoalRecord): string | null {
  if (!goal.monthlyPlan || goal.monthlyPlan <= 0) return null
  const clear = goal.targetDate ? ` · clear by ${monthLabel(goal.targetDate)}` : ''
  return `${formatAmount(goal.monthlyPlan)}/mo${clear}`
}

function byPriority(a: GoalRecord, b: GoalRecord): number {
  const ap = a.priority ?? Number.POSITIVE_INFINITY
  const bp = b.priority ?? Number.POSITIVE_INFINITY
  return ap - bp
}

function gridLinesFor(goal: GoalRecord, fxRates: Record<string, number>, todayIso: string): string[] {
  const icon = goal.icon ? `${goal.icon} ` : ''
  if (goal.kind === 'save_up') {
    const saved = savedAed(goal, fxRates)
    const pct = savedPct(goal, saved)
    const savedText = saved === null ? '—' : formatAmount(saved)
    const targetText = goal.targetAmount ? formatAmount(goal.targetAmount) : '—'
    const pctText = pct !== null ? `  ${Math.round(pct)}%` : ''
    const header = `${icon}${goal.name}  ${savedText} / ${targetText}${pctText}`
    const pace = saveUpPaceLine(goal, saved, todayIso)
    return pace ? [header, `  ${pace}`] : [header]
  }
  const current = currentAed(goal, fxRates)
  const paidOff = paidOffAed(goal, current)
  const pct = paidOffPct(goal, paidOff)
  const starting = goal.startingBalance ?? 0
  const currentText = current === null ? '—' : formatAmount(current)
  const pctText = pct !== null ? `  ${Math.round(pct)}% paid` : ''
  const header = `${icon}${goal.name} (pay down)  ${currentText} left of ${formatAmount(starting)}${pctText}`
  const pace = payDownPaceLine(goal)
  return pace ? [header, `  ${pace}`] : [header]
}

function formatGoalGrid(goals: GoalRecord[], fxRates: Record<string, number>, todayIso: string): string {
  const saveUp = goals.filter((g) => g.kind === 'save_up').sort(byPriority)
  const payDown = goals.filter((g) => g.kind === 'pay_down').sort(byPriority)
  const lines: string[] = ['Goals', '']
  for (const goal of [...saveUp, ...payDown]) {
    lines.push(...gridLinesFor(goal, fxRates, todayIso), '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

function formatSingleGoal(goal: GoalRecord, fxRates: Record<string, number>, todayIso: string): string {
  const icon = goal.icon ? `${goal.icon} ` : ''
  if (goal.kind === 'save_up') {
    const saved = savedAed(goal, fxRates)
    if (saved === null) {
      return `${icon}${goal.name}\nI can't convert the linked account's balance — its currency has no FX rate right now.`
    }
    const pct = savedPct(goal, saved)
    const lines = [`${icon}${goal.name}`]
    lines.push(
      goal.targetAmount
        ? `${formatAmount(saved)} of ${formatAmount(goal.targetAmount)} AED${pct !== null ? ` · ${Math.round(pct)}%` : ''}`
        : `${formatAmount(saved)} AED saved`
    )
    const pace = saveUpPaceLine(goal, saved, todayIso)
    if (pace) lines.push(pace)
    const last = lastContribution(goal)
    lines.push(last ? `Last contribution: ${formatAmount(last.amount)} AED on ${formatDate(last.date)}` : 'Nothing contributed yet.')
    return lines.join('\n')
  }

  const current = currentAed(goal, fxRates)
  if (current === null) {
    return `${icon}${goal.name} (pay down)\nI can't convert the linked account's balance — its currency has no FX rate right now.`
  }
  const paidOff = paidOffAed(goal, current)
  const pct = paidOffPct(goal, paidOff)
  const starting = goal.startingBalance ?? 0
  const lines = [
    `${icon}${goal.name} (pay down)`,
    `${formatAmount(current)} left of ${formatAmount(starting)}${pct !== null ? ` · ${Math.round(pct)}% paid` : ''}`,
  ]
  const pace = payDownPaceLine(goal)
  if (pace) lines.push(pace)
  if (!goal.linkedAccount) lines.push("Linked account not found — this figure falls back to the starting balance.")
  return lines.join('\n')
}

export function formatGoalProgressReply(result: GoalProgressResult): string {
  if (result.status === 'needs_clarification') {
    return `Which goal did you mean — ${result.candidates.join(', ')}?`
  }
  if (result.goals.length === 0) {
    return "You don't have any goals set up yet."
  }
  if (result.goals.length === 1) {
    return formatSingleGoal(result.goals[0], result.fxRates, result.todayIso)
  }
  return formatGoalGrid(result.goals, result.fxRates, result.todayIso)
}
