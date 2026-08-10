// Extraction prompts. One prompt shared by every input path: a typed message, a
// Whisper transcript of a voice note, and the caption/OCR of a receipt photo all
// land on the same instructions, so behaviour can't drift between them.

import type { Extraction, HouseholdContext } from '../_shared/types.ts'

export interface PromptContext {
  today: string
  categories: string[]
  accounts: string[]
  people: string[]
  defaultCurrency: string
}

export function promptContextFrom(
  household: HouseholdContext,
  today: string,
  defaultCurrency: string
): PromptContext {
  return {
    today,
    categories: household.categories.map((c) => c.name),
    accounts: household.accounts.map((a) => a.name),
    people: Array.from(new Set(household.people.values())),
    defaultCurrency,
  }
}

const OUTPUT_CONTRACT = `Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "date": "YYYY-MM-DD",
  "amount": number,
  "currency": "AED" | "INR" | "USD",
  "category": string,
  "paid_by": string,
  "paid_with": string,
  "note": string,
  "confidence": number
}
Use null for any value you genuinely cannot determine. Never invent a plausible
number to fill a gap — null plus a low confidence is always the better answer.`

export function buildSystemPrompt(ctx: PromptContext): string {
  return `You extract one personal-finance transaction from a message sent by a couple living in Dubai, UAE.

Today's date is ${ctx.today}. The household's default currency is ${ctx.defaultCurrency}.

${OUTPUT_CONTRACT}

Field rules:
- date: the date the money was actually spent. Use the date printed on a receipt
  when one is legible; otherwise use today. Never return a future date. If a
  message says "yesterday" or "on Friday", resolve it relative to today.
- amount: the grand total actually paid — after discounts, including VAT,
  delivery and service charge. Never the subtotal, never the VAT line, never the
  cash tendered or change given, never a single line item when a total exists.
- currency: AED for "AED", "Dhs", "DHS", "د.إ" or an unmarked UAE receipt.
  INR for "₹", "Rs", "Rs.", "INR" (India remittances, Zerodha/Indian brokerage
  and utility receipts). USD for "$" or "USD". When nothing indicates otherwise,
  use ${ctx.defaultCurrency}.
- category: EXACTLY one of these, copied character for character:
${ctx.categories.map((c) => `  - ${c}`).join('\n')}
  If none of them is a defensible fit, return null rather than forcing "Other".
- paid_by: which person spent it, one of: ${ctx.people.join(', ') || 'unknown'}.
  Default to the sender unless the message clearly says otherwise ("Tarika paid").
- paid_with: the account or card used, matched to one of these when you can:
${ctx.accounts.length ? ctx.accounts.map((a) => `  - ${a}`).join('\n') : '  (no accounts configured)'}
  Receipts often print a card scheme and last 4 digits ("VISA ****1234",
  "Mastercard 5412"), or "CASH" / "Apple Pay" / "Tabby". Return what you see if
  it doesn't match a known account; return null if the payment method is absent.
- note: a short human summary — merchant first, then what was bought.
  "Carrefour · groceries + household", "Zomato · dinner for two". Keep under 80
  characters. No newlines.

Merchant hints common to this household: Noon and Amazon.ae are usually Shopping
unless the items are clearly food; Carrefour, Lulu, Union Coop, Waitrose and
Talabat Mart are Groceries; Talabat, Deliveroo, Zomato and restaurant bills are
Dining Out; ENOC, ADNOC and Emarat are Transport & Fuel; Salik, RTA and Careem
are Transport & Fuel; DEWA and Etisalat/du are Utilities; a Zerodha, Groww or
mutual-fund contract note is Savings & Investments (an INR amount).

confidence, on a 0–1 scale:
- 0.90–1.00: total, date and merchant all legible/explicit, and the category
  follows obviously from the merchant.
- 0.70–0.89: total is certain, but the category or the payment method is an
  inference rather than something stated.
- 0.40–0.69: the total is readable but something material is ambiguous — a
  multi-currency receipt, a split bill, a blurred line, an unfamiliar merchant.
- 0.00–0.39: you could not read the total, or you are guessing at more than one
  field.
Be honest and calibrated. A low score costs the household one tap; a
falsely-high score puts a wrong number into their budget silently.`
}

export function buildImageUserPrompt(caption: string | null, imageCount = 1): string {
  const base =
    imageCount > 1
      ? // A Telegram album send — see intake.ts's extractFromAlbumPhoto. Treated
        // as one purchase by default (a cropped total, an order confirmation
        // split across shots) since that's what a phone's multi-select usually
        // means; the confidence rubric below is the guard against the rarer
        // case where the photos are actually unrelated.
        `These ${imageCount} images were sent together as one album and are almost certainly one purchase — ` +
        'a receipt with the total cropped out of the first shot, an order confirmation split across screenshots, ' +
        "or a bill's front and back. Read all of them together and extract ONE transaction. " +
        'If they clearly show two unrelated purchases instead, use the one with the clearer total, ' +
        'lower your confidence, and mention the ambiguity in the note.'
      : 'This image is a receipt, an invoice, or a screenshot of a payment confirmation. ' +
        'Read it and extract the transaction. Prefer printed text over your expectations of what a receipt usually says.'
  return caption ? `${base}\n\nThe sender added this caption: "${caption}"` : base
}

export function buildTextUserPrompt(text: string, spokenLabel = false): string {
  const source = spokenLabel
    ? 'This is a transcript of a voice note describing a spend. Transcription errors are possible, especially in numbers — if a number sounds implausible, lower your confidence rather than "correcting" it.'
    : 'This is a typed message describing a spend.'
  return `${source}\n\nMessage:\n"""\n${text}\n"""`
}

/** Corrections re-enter the same pipeline: current JSON + the fix, full JSON out. */
export function buildCorrectionUserPrompt(current: Extraction, correction: string): string {
  return `A transaction was already extracted from an earlier message and shown to the household. They are now correcting it.

Current extracted JSON:
${JSON.stringify(current, null, 2)}

Their correction:
"""
${correction}
"""

Apply the correction and return the COMPLETE corrected JSON object with every
key present — not just the changed fields. Keep values the correction does not
touch exactly as they are. Because a human has now looked at this and told you
what is wrong, the corrected fields are reliable: set confidence to at least
0.95 unless their correction itself is ambiguous.`
}
