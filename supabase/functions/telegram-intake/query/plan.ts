// The planner (Taskiv #51). The model's only job is to pick one entry from a
// closed enum and fill in its parameters — Postgres computes every digit.
// Everything the model returns is treated as untrusted input: validated
// against the enum in code, never trusted by shape alone. `null` is not a
// failure state, it is the honest-refusal path (its own Sprint 3 task) —
// callers should treat it as "ask again", not throw an error at the household.
//
// Reuses extract.ts's JSON hardening (fence-stripping, brace extraction) so
// the same "models wrap JSON in prose or fences often enough to handle it"
// tolerance applies here too.

import { ExtractionError, matchCategory, parseJsonObject } from '../extract.ts'
import type { PromptContext } from '../prompt.ts'
import type { ModelClient } from '../../_shared/types.ts'
import type { Period, QueryPlan } from './types.ts'

const KNOWN_QUERIES = ['category_spend', 'total_spend', 'merchant_spend', 'account_spend', 'recent_transactions', 'budget_status', 'net_worth', 'goal_progress', 'upcoming_bills'] as const
type KnownQuery = (typeof KNOWN_QUERIES)[number]

const KNOWN_PERIOD_KINDS = ['this_month', 'last_month', 'this_week', 'last_week', 'ytd', 'last_n_days', 'explicit'] as const

const MIN_LIMIT = 1
const MAX_LIMIT = 20

const OUTPUT_CONTRACT = `Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "q": "category_spend" | "total_spend" | "merchant_spend" | "account_spend" | "recent_transactions" | "budget_status" | "net_worth" | "goal_progress" | "upcoming_bills",
  "category": string | null,
  "merchant": string | null,
  "account": string | null,
  "goal": string | null,
  "owner": string | null,
  "limit": number | null,
  "days": number | null,
  "period": {
    "kind": "this_month" | "last_month" | "this_week" | "last_week" | "ytd" | "last_n_days" | "explicit",
    "n": number | null,
    "from": "YYYY-MM-DD" | null,
    "to": "YYYY-MM-DD" | null
  },
  "compare": null | {
    "kind": "this_month" | "last_month" | "this_week" | "last_week" | "ytd" | "last_n_days" | "explicit",
    "n": number | null,
    "from": "YYYY-MM-DD" | null,
    "to": "YYYY-MM-DD" | null
  }
}
Use null for any field the chosen q doesn't need. Never invent a category,
account or owner name that isn't in the lists below — if nothing fits, still
return the closest q with the field null rather than a name you made up.`

function buildSystemPrompt(ctx: PromptContext): string {
  return `You turn a household member's question about their own finances into ONE query from a fixed catalogue. Today's date is ${ctx.today} (Asia/Dubai).

${OUTPUT_CONTRACT}

The queries:
- category_spend: how much was spent in one category ("how much on groceries this month"). Set category.
- total_spend: overall spend across every category ("how much did I spend in July").
- merchant_spend: spend at one named merchant/place ("how much at Carrefour this week"). Set merchant to whatever name the person used — it does not need to match a known account or category.
- account_spend: spend on one card/account ("how much on the ENBD card this month"). Set account.
- recent_transactions: a plain list of the latest spends ("what did I spend on today", "show my last 5"). Set limit (default 10 if the person didn't say a number).
- budget_status: how spend compares to the household's budget — either one category ("are we over on groceries", "how's dining out this month") or the whole grid ("how's the budget looking", "are we over anywhere"). Set category for a single category, leave it null for the full grid.
- net_worth: current net worth, total or for one person ("what's our net worth", "what's Tarika's net worth"). Set owner for one person, leave it null for the household total. Only set compare when the person explicitly asks how it's changed ("how has our net worth changed this month", "are we up or down this year") — leave compare null for a plain "what's our net worth" question, since that only wants the current figure. period is not used for net_worth; leave it as the default.
- goal_progress: progress on a savings goal or a debt payoff ("how's the emergency fund", "are we on track for the car loan", "how are we doing on our goals"). Set goal to whatever name the person used — it will be matched to one of the household's real goals automatically, so paraphrasing is fine. Leave goal null for "how are the goals doing" style questions that want every goal at once.
- upcoming_bills: what's due soon ("what bills are coming up", "what do we owe this week", "anything due in the next month"). Set days to the number of days the person means ("this week" → 7, "next month" → 30) — default to 14 when they don't say.

category must be EXACTLY one of these, copied character for character, or null:
${ctx.categories.map((c) => `  - ${c}`).join('\n')}

account: the household's real accounts are:
${ctx.accounts.length ? ctx.accounts.map((a) => `  - ${a}`).join('\n') : '  (no accounts configured)'}
Set account to whatever the person called it ("the ENBD card", "Wio") — it will be matched to one of the above automatically, so paraphrasing is fine; it does not need to be copied exactly.

owner, when the question is scoped to one person, is one of: ${ctx.people.join(', ') || 'unknown'}. Leave it null for a household-wide question.

period.kind:
- this_month / last_month / this_week / last_week / ytd — use these whenever the question maps to one of them ("this month", "this week", "so far this year").
- last_n_days — set n to the number of days ("last 7 days", "past two weeks" → n: 14).
- explicit — only when the person names specific dates or a named past month other than this one or last one; set from/to as YYYY-MM-DD, both inclusive. Never return a future date for "to".
If the question doesn't say a period at all, default to this_month.

compare uses the same kind values as period, and is only ever set for net_worth — null for every other q.`
}

function buildUserPrompt(question: string): string {
  return `Household member's question:\n"""\n${question}\n"""`
}

/**
 * The detailed outcome of planning a question — richer than a plain
 * `QueryPlan | null` so a caller (query/refusal.ts, Taskiv #59) can give a
 * specific reply instead of one generic "I don't understand" for every
 * failure. The distinction that matters: 'call_failed' means the model
 * didn't give us anything usable at all (network error, timeout, malformed
 * JSON) — worth a "try rephrasing"; 'unknown_category' means the model
 * understood the question but named a category that doesn't exist — worth
 * listing the real ones; 'unsupported' covers everything else the closed
 * query enum doesn't reach (an out-of-enum `q`, an unmatched owner, a
 * malformed period, an empty merchant/account).
 */
export type PlanOutcome =
  | { kind: 'ok'; plan: QueryPlan }
  | { kind: 'call_failed' }
  | { kind: 'unknown_category'; attempted: string }
  | { kind: 'unsupported' }

/**
 * Picks exactly one entry from the closed query enum, or a typed refusal
 * reason when the question doesn't map cleanly onto it. See `planQuery`
 * below for the simpler `QueryPlan | null` shape most callers actually need.
 */
export async function planQueryDetailed(question: string, ctx: PromptContext, model: ModelClient): Promise<PlanOutcome> {
  let raw: string
  try {
    raw = await model.chat([
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: buildUserPrompt(question) },
    ])
  } catch {
    return { kind: 'call_failed' }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseJsonObject(raw)
  } catch (error) {
    if (error instanceof ExtractionError) return { kind: 'call_failed' }
    throw error
  }

  return validatePlanDetailed(parsed, ctx)
}

/**
 * Thin wrapper over `planQueryDetailed` for callers that only need to know
 * whether planning succeeded, not why it didn't — `null` is not a failure
 * state, it is the honest-refusal path (see query/refusal.ts for the actual
 * refusal wording).
 */
export async function planQuery(question: string, ctx: PromptContext, model: ModelClient): Promise<QueryPlan | null> {
  const outcome = await planQueryDetailed(question, ctx, model)
  return outcome.kind === 'ok' ? outcome.plan : null
}

function validatePlanDetailed(parsed: Record<string, unknown>, ctx: PromptContext): PlanOutcome {
  const q = parsed.q
  if (typeof q !== 'string' || !(KNOWN_QUERIES as readonly string[]).includes(q)) return { kind: 'unsupported' }
  const query = q as KnownQuery

  const owner = validateOwner(parsed.owner, ctx.people)
  if (parsed.owner != null && owner === null) return { kind: 'unsupported' } // an owner was named but didn't match anyone real

  const period = validatePeriodShape(parsed.period)
  if (period === null) return { kind: 'unsupported' }

  switch (query) {
    case 'category_spend': {
      if (typeof parsed.category !== 'string' || !parsed.category.trim()) return { kind: 'unsupported' }
      const category = matchCategory(parsed.category, ctx.categories)
      if (!category) return { kind: 'unknown_category', attempted: parsed.category.trim() }
      return { kind: 'ok', plan: { q: 'category_spend', category, period, ...(owner ? { owner } : {}) } }
    }
    case 'total_spend':
      return { kind: 'ok', plan: { q: 'total_spend', period, ...(owner ? { owner } : {}) } }
    case 'merchant_spend': {
      const merchant = cleanFreeText(parsed.merchant)
      if (!merchant) return { kind: 'unsupported' }
      return { kind: 'ok', plan: { q: 'merchant_spend', merchant, period } }
    }
    case 'account_spend': {
      // Free text, not matched against ctx.accounts here — an account name is
      // exactly the kind of thing people paraphrase ("the ENBD card"), and
      // run.ts resolves it with the same matchAccount() scorer a receipt's
      // paid_with goes through, tie-handling included. See the QueryPlan
      // comment in types.ts.
      const account = cleanFreeText(parsed.account)
      if (!account) return { kind: 'unsupported' }
      return { kind: 'ok', plan: { q: 'account_spend', account, period } }
    }
    case 'recent_transactions': {
      const limit = clampLimit(parsed.limit)
      return { kind: 'ok', plan: { q: 'recent_transactions', limit, ...(owner ? { owner } : {}) } }
    }
    case 'budget_status': {
      // null/missing/blank category is the full-grid request, not a refusal —
      // only a named-but-unmatched category is 'unknown_category'.
      if (typeof parsed.category !== 'string' || !parsed.category.trim()) {
        return { kind: 'ok', plan: { q: 'budget_status', period } }
      }
      const category = matchCategory(parsed.category, ctx.categories)
      if (!category) return { kind: 'unknown_category', attempted: parsed.category.trim() }
      return { kind: 'ok', plan: { q: 'budget_status', category, period } }
    }
    case 'net_worth': {
      // `compare` is optional and structurally separate from `period` — a
      // plain "what's our net worth" question has no compare at all, so
      // null/absent is the ordinary case, not a fallback to this_month the
      // way every other query's missing period is.
      let compare: Period | undefined
      if (parsed.compare != null) {
        const validatedCompare = validatePeriodShape(parsed.compare)
        if (validatedCompare === null) return { kind: 'unsupported' }
        compare = validatedCompare
      }
      return { kind: 'ok', plan: { q: 'net_worth', ...(owner ? { owner } : {}), ...(compare ? { compare } : {}) } }
    }
    case 'goal_progress': {
      // Free text, not matched against a goal list here — same reasoning as
      // account_spend: a goal name is exactly the kind of thing people
      // paraphrase ("the emergency fund", "EF"), and run.ts resolves it with
      // the same matchGoal() scorer accountMatch.ts's matchAccount uses,
      // tie-handling included.
      const goal = cleanFreeText(parsed.goal)
      return { kind: 'ok', plan: { q: 'goal_progress', ...(goal ? { goal } : {}) } }
    }
    case 'upcoming_bills': {
      // Clamping to 1-90 is bills.ts's job (run against a real default, not
      // duplicated here) — plan.ts only needs to pass through a plausible number.
      const raw = parsed.days
      const days = raw === null || raw === undefined ? undefined : typeof raw === 'number' ? raw : Number(raw)
      return { kind: 'ok', plan: { q: 'upcoming_bills', ...(days !== undefined && Number.isFinite(days) ? { days } : {}) } }
    }
  }
}

function validateOwner(raw: unknown, people: string[]): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const match = people.find((p) => p.toLowerCase() === raw.trim().toLowerCase())
  return match ?? null
}

/** Shared by merchant and account — both are free text at plan time, resolved (or not) downstream. */
function cleanFreeText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, 60)
  return trimmed || null
}

const DEFAULT_LIMIT = 10

function clampLimit(raw: unknown): number {
  if (raw === null || raw === undefined) return DEFAULT_LIMIT
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(n)))
}

/**
 * Structural validation only — kind is one of the known values and its
 * required sub-fields are present and roughly shaped. Full resolution
 * (including rejecting a backwards explicit range) is period.ts's job, run
 * against a real clock at query-execution time, not here.
 */
function validatePeriodShape(raw: unknown): Period | null {
  if (!raw || typeof raw !== 'object') return { kind: 'this_month' }
  const obj = raw as Record<string, unknown>
  const kind = obj.kind
  if (typeof kind !== 'string' || !(KNOWN_PERIOD_KINDS as readonly string[]).includes(kind)) return null

  if (kind === 'last_n_days') {
    const n = typeof obj.n === 'number' ? obj.n : Number(obj.n)
    if (!Number.isFinite(n) || n <= 0) return null
    return { kind: 'last_n_days', n: Math.round(n) }
  }

  if (kind === 'explicit') {
    const from = obj.from
    const to = obj.to
    if (typeof from !== 'string' || typeof to !== 'string' || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return null
    return { kind: 'explicit', from, to }
  }

  return { kind } as Period
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
