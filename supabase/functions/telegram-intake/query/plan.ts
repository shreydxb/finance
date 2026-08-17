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

const KNOWN_QUERIES = ['category_spend', 'total_spend', 'merchant_spend', 'account_spend', 'recent_transactions'] as const
type KnownQuery = (typeof KNOWN_QUERIES)[number]

const KNOWN_PERIOD_KINDS = ['this_month', 'last_month', 'this_week', 'last_week', 'ytd', 'last_n_days', 'explicit'] as const

const MIN_LIMIT = 1
const MAX_LIMIT = 20

const OUTPUT_CONTRACT = `Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "q": "category_spend" | "total_spend" | "merchant_spend" | "account_spend" | "recent_transactions",
  "category": string | null,
  "merchant": string | null,
  "account": string | null,
  "owner": string | null,
  "limit": number | null,
  "period": {
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

The five queries:
- category_spend: how much was spent in one category ("how much on groceries this month"). Set category.
- total_spend: overall spend across every category ("how much did I spend in July").
- merchant_spend: spend at one named merchant/place ("how much at Carrefour this week"). Set merchant to whatever name the person used — it does not need to match a known account or category.
- account_spend: spend on one card/account ("how much on the ENBD card this month"). Set account.
- recent_transactions: a plain list of the latest spends ("what did I spend on today", "show my last 5"). Set limit (default 10 if the person didn't say a number).

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
If the question doesn't say a period at all, default to this_month.`
}

function buildUserPrompt(question: string): string {
  return `Household member's question:\n"""\n${question}\n"""`
}

/**
 * Picks exactly one entry from the closed query enum, or `null` when the
 * question doesn't map cleanly onto it — an unrecognised model response, an
 * unknown category/account/owner, an out-of-enum `q`, or a malformed period
 * all take this same honest-refusal path rather than guessing.
 */
export async function planQuery(question: string, ctx: PromptContext, model: ModelClient): Promise<QueryPlan | null> {
  let raw: string
  try {
    raw = await model.chat([
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: buildUserPrompt(question) },
    ])
  } catch {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseJsonObject(raw)
  } catch (error) {
    if (error instanceof ExtractionError) return null
    throw error
  }

  return validatePlan(parsed, ctx)
}

function validatePlan(parsed: Record<string, unknown>, ctx: PromptContext): QueryPlan | null {
  const q = parsed.q
  if (typeof q !== 'string' || !(KNOWN_QUERIES as readonly string[]).includes(q)) return null
  const query = q as KnownQuery

  const owner = validateOwner(parsed.owner, ctx.people)
  if (parsed.owner != null && owner === null) return null // an owner was named but didn't match anyone real

  const period = validatePeriodShape(parsed.period)
  if (period === null) return null

  switch (query) {
    case 'category_spend': {
      const category = typeof parsed.category === 'string' ? matchCategory(parsed.category, ctx.categories) : null
      if (!category) return null
      return { q: 'category_spend', category, period, ...(owner ? { owner } : {}) }
    }
    case 'total_spend':
      return { q: 'total_spend', period, ...(owner ? { owner } : {}) }
    case 'merchant_spend': {
      const merchant = cleanFreeText(parsed.merchant)
      if (!merchant) return null
      return { q: 'merchant_spend', merchant, period }
    }
    case 'account_spend': {
      // Free text, not matched against ctx.accounts here — an account name is
      // exactly the kind of thing people paraphrase ("the ENBD card"), and
      // run.ts resolves it with the same matchAccount() scorer a receipt's
      // paid_with goes through, tie-handling included. See the QueryPlan
      // comment in types.ts.
      const account = cleanFreeText(parsed.account)
      if (!account) return null
      return { q: 'account_spend', account, period }
    }
    case 'recent_transactions': {
      const limit = clampLimit(parsed.limit)
      return { q: 'recent_transactions', limit, ...(owner ? { owner } : {}) }
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
