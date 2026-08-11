// Fund transfers between the household's own accounts (docs/telegram-bot-round2-design.md
// §3). A transfer is not a spend — categorizing it as one double-counts it
// against a budget — but it still writes straight to `transactions` (rule #3:
// transactions keep write-then-flag), unlike cashback/income which propose-then-tap.
// Two rows land immediately, both category='Transfer', linked by a shared
// split_group_id; either half gets needs_review when an account or the amount
// couldn't be resolved. accounts.value is never touched — the money-data rule
// forbids a balance update from a chat message, full stop.
//
// Scope: typed text only, same restriction as bulk input (§2) and cashback (§4).

import { cleanString, normalizeAmount, normalizeCurrency, normalizeDate, parseJsonObject } from './extract.ts'
import type { PromptContext } from './prompt.ts'
import type { ChatMessage, ModelClient } from '../_shared/types.ts'

const TRANSFER_WORD = /\btransfer(?:red|ring)?\b/i
const MOVE_VERB = /\b(?:transfer(?:red|ring)?|moved?|move|sent|put)\b/i
const FROM_TO = /\bfrom\b[\s\S]*\bto\b/i

/**
 * The router's cheap, deterministic gate. An explicit "transfer" mention
 * always qualifies; otherwise a move-verb plus a "from ... to ..." shape is
 * required — CLAUDE.md rule #2 ("the router defaults to spend on any doubt")
 * means a bare "paid from Wio" without a "to" stays a spend.
 */
export function looksLikeTransfer(text: string): boolean {
  return TRANSFER_WORD.test(text) || (MOVE_VERB.test(text) && FROM_TO.test(text))
}

export interface TransferExtraction {
  amount: number | null
  currency: string
  fromAccount: string | null
  toAccount: string | null
  date: string
}

export async function extractTransfer(text: string, ctx: PromptContext, model: ModelClient): Promise<TransferExtraction> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildTransferPrompt(ctx) },
    { role: 'user', content: `Message:\n"""\n${text}\n"""` },
  ]
  const parsed = parseJsonObject(await model.chat(messages))
  return {
    amount: normalizeAmount(parsed.amount),
    currency: normalizeCurrency(parsed.currency, ctx.defaultCurrency),
    fromAccount: cleanString(parsed.from_account, 60),
    toAccount: cleanString(parsed.to_account, 60),
    date: normalizeDate(parsed.date, ctx.today),
  }
}

function buildTransferPrompt(ctx: PromptContext): string {
  return `A member of a Dubai household is describing moving money between two of their own accounts — not a purchase.

Today's date is ${ctx.today}. The household's default currency is ${ctx.defaultCurrency}.

Known accounts:
${ctx.accounts.length ? ctx.accounts.map((a) => `  - ${a}`).join('\n') : '  (no accounts configured)'}

Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "amount": number,
  "currency": "AED" | "INR" | "USD",
  "from_account": string,
  "to_account": string,
  "date": "YYYY-MM-DD"
}
Use null for any value you genuinely cannot determine — never invent a plausible
number to fill a gap.

Field rules:
- amount: the amount moved.
- currency: as printed or said, defaulting to ${ctx.defaultCurrency} when unmarked.
- from_account / to_account: match to one of the known accounts above when you
  can, copied character for character; otherwise return what the message says,
  verbatim. Never the same account for both — if the message only names one
  account, that's from_account and to_account is null.
- date: use today unless the message says otherwise. Never return a future date.`
}
