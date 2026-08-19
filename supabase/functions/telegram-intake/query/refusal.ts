// The honest-refusal path (Taskiv #59). `planQuery` returning null used to
// mean one generic "I'm not sure how to answer that yet" for every failure —
// this module tells them apart and answers each one specifically, without
// ever handing the raw question to the model for a free-text answer. That
// fallback is the exact hole this task exists to close: an LLM asked
// something the query enum doesn't cover will happily produce a number, and
// that number would be fabricated.
//
// `answerQuestion` is the single entry point intake.ts calls for the
// question path — it owns the advice check, the planner, and the query
// execution, so the whole thing is testable here without a Telegram harness.

import { planQueryDetailed } from './plan.ts'
import { runQuery } from './run.ts'
import { formatQueryReply } from './reply.ts'
import { errorHint } from '../errorHint.ts'
import type { PromptContext } from '../prompt.ts'
import type { AccountRef, ModelClient } from '../../_shared/types.ts'
import type { QueryResult, QueryStore } from './types.ts'

// Deliberately not model-classified — advice is a product boundary, not a
// judgement call the classifier should ever get to make. "should we/I",
// "can we/I afford", "is it a good idea", "worth it/buying", "what should
// I do" all read the same way: someone wants a recommendation, not a number.
const ADVICE_PATTERN = /\b(should (we|i)\b|can (we|i) afford|is it (a )?good idea|worth (it|buying|the money)|what should (we|i) do|\brecommend)/i

export function looksLikeAdvice(text: string): boolean {
  return ADVICE_PATTERN.test(text.trim())
}

export const ADVICE_REFUSAL_TEXT = "I only report what's in the ledger — I won't give advice on what to do with it."

export const PLANNER_FAILED_TEXT = "I couldn't work that one out — try rephrasing?"

// Taskiv #59: keep this listing only what's actually built, same rule as
// HELP_TEXT (Taskiv #53). Sprint 3 adds budget_status, net_worth,
// goal_progress, upcoming_bills and portfolio_summary — add each to this
// line in the sprint that ships it, never before.
export const UNSUPPORTED_REFUSAL_TEXT = [
  "I can't answer that one yet.",
  '',
  'I can tell you about: spend by category, merchant, account or total for a period, your recent transactions, budget status, net worth, goal/debt progress, and upcoming bills.',
].join('\n')

export function formatUnknownCategoryRefusal(attempted: string, categories: string[]): string {
  return [`I don't have a category called "${attempted}".`, '', 'The real ones are:', ...categories.map((c) => `  • ${c}`)].join('\n')
}

export interface AnswerQuestionResult {
  text: string
  success: boolean
  /** Set on every non-success path — the backlog signal for which queries to add next (Taskiv #59). */
  refusalReason?: string
}

export async function answerQuestion(
  question: string,
  ctx: PromptContext,
  model: ModelClient,
  queryStore: QueryStore,
  accounts: AccountRef[],
  now: () => Date
): Promise<AnswerQuestionResult> {
  if (looksLikeAdvice(question)) {
    return { text: ADVICE_REFUSAL_TEXT, success: false, refusalReason: 'advice-shaped question' }
  }

  const outcome = await planQueryDetailed(question, ctx, model)

  if (outcome.kind === 'call_failed') {
    return { text: PLANNER_FAILED_TEXT, success: false, refusalReason: 'planner call failed' }
  }
  if (outcome.kind === 'unknown_category') {
    return {
      text: formatUnknownCategoryRefusal(outcome.attempted, ctx.categories),
      success: false,
      refusalReason: `unknown category: ${outcome.attempted}`,
    }
  }
  if (outcome.kind === 'unsupported') {
    return { text: UNSUPPORTED_REFUSAL_TEXT, success: false, refusalReason: 'outside the query enum' }
  }

  let result: QueryResult
  try {
    result = await runQuery(outcome.plan, queryStore, accounts, now)
  } catch (error) {
    const hint = errorHint(error)
    return {
      text: hint ? `I couldn't get that — ${hint}` : "I couldn't get that. Try again in a bit.",
      success: false,
      refusalReason: error instanceof Error ? error.message : String(error),
    }
  }

  return { text: formatQueryReply(result), success: true }
}
