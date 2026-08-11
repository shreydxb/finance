// Bulk input — several spends described in one typed message
// (docs/telegram-bot-round2-design.md §2). "45 groceries, 12 coffee, paid
// rent 3000" is three transactions, not one — extractFromText is built for
// exactly one and would silently pick just one of them.
//
// Still write-then-flag, scaled to N (rule #3: transactions are never
// propose-then-tap) — see intake.ts's handleBulk for the write path.
//
// Scope: typed text only, same restriction as cashback (§4) and transfers
// (§3) — a receipt photo is still exactly one purchase, and a voice note's
// words aren't available until after transcription happens deeper in the
// pipeline than the router check that calls looksLikeBulk.

import { extractBulkFromText } from './extract.ts'
import type { PromptContext } from './prompt.ts'
import type { Extraction, ModelClient } from '../_shared/types.ts'

const AMOUNT_PATTERN = /\d+(?:\.\d+)?\s*(?:aed|dhs|rs|₹|\$)?/gi

/**
 * The router's cheap, deterministic gate — no real intent classifier exists
 * yet (docs/telegram-bot-expansion.md §1). More than one amount-like token in
 * the text is worth asking the model for the array shape instead of the
 * single-object shape; the model call is the same either way, just a
 * different response schema requested.
 */
export function looksLikeBulk(text: string): boolean {
  const matches = text.match(AMOUNT_PATTERN)
  return (matches?.length ?? 0) > 1
}

export function extractBulk(text: string, ctx: PromptContext, model: ModelClient): Promise<Extraction[]> {
  return extractBulkFromText(text, ctx, model)
}
