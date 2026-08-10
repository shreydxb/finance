// Cashback logging (docs/telegram-bot-round2-design.md §4). Cashback is real
// income, not a spend — it logs to `income` with kind='other'. Unlike a
// transaction it's propose-then-tap: nothing is written until the household
// taps Apply (CLAUDE.md, "Telegram bot expansion" rule #3). A missed cashback
// message costs nothing but a slightly-off income total, so it can safely
// follow the softer gate.
//
// Scope: typed text only, same restriction as bulk input (§2) — a receipt
// photo is still always a spend, and a voice note's words aren't available
// until after transcription, which happens deeper in the pipeline than the
// router check that calls looksLikeCashback.

import { cleanString, normalizeAmount, normalizeCurrency, normalizeDate, parseJsonObject } from './extract.ts'
import type { PromptContext } from './prompt.ts'
import type { ChatMessage, ModelClient } from '../_shared/types.ts'

const CASHBACK_PATTERN = /\bcash\s?back/i

/**
 * The router's cheap, deterministic gate. Only an explicit "cashback"/"cash
 * back" mention routes here — CLAUDE.md rule #2 ("the router defaults to
 * spend on any doubt") means everything else stays a spend.
 */
export function looksLikeCashback(text: string): boolean {
  return CASHBACK_PATTERN.test(text)
}

export interface CashbackExtraction {
  amount: number | null
  currency: string
  source: string | null
  date: string
}

export async function extractCashback(text: string, ctx: PromptContext, model: ModelClient): Promise<CashbackExtraction> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCashbackPrompt(ctx) },
    { role: 'user', content: `Message:\n"""\n${text}\n"""` },
  ]
  const parsed = parseJsonObject(await model.chat(messages))
  return {
    amount: normalizeAmount(parsed.amount),
    currency: normalizeCurrency(parsed.currency, ctx.defaultCurrency),
    source: cleanString(parsed.source, 60),
    date: normalizeDate(parsed.date, ctx.today),
  }
}

function buildCashbackPrompt(ctx: PromptContext): string {
  return `A member of a Dubai household is telling you about cashback they received — money credited back by a card or app, the opposite of a purchase.

Today's date is ${ctx.today}. The household's default currency is ${ctx.defaultCurrency}.

Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "amount": number,
  "currency": "AED" | "INR" | "USD",
  "source": string,
  "date": "YYYY-MM-DD"
}
Use null for any value you genuinely cannot determine — never invent a plausible
number to fill a gap.

Field rules:
- amount: the cashback amount credited. If the message also mentions the
  original purchase total, that is NOT the amount — only the cashback figure is.
- currency: as printed or said, defaulting to ${ctx.defaultCurrency} when unmarked.
- source: a short description of where it came from — "ENBD Credit Card cashback",
  "Noon app cashback". Keep under 60 characters, no newlines.
- date: the date it was credited. Use today unless the message says otherwise.
  Never return a future date.`
}
