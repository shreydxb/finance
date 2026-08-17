// Intent router (Taskiv #50). Every non-command, non-photo, non-voice,
// non-correction text message passes through here before intake.ts decides
// whether to extract a spend from it.
//
// The one rule that governs this file: A MISROUTED SPEND IS A LOST SPEND. A
// question wrongly routed to intake costs one flagged row and an /undo. A
// spend wrongly routed to Q&A is money that never enters the ledger and that
// nobody will remember to re-type. So every failure mode here — a regex
// near-miss, a malformed classifier response, a thrown model call, low
// classifier confidence — resolves to 'spend', never to silence.
//
// Reuses extract.ts's JSON hardening (fence-stripping, brace extraction)
// rather than re-implementing it — same "models wrap JSON in prose or
// fences often enough to handle it" tolerance the extraction pipeline needs.

import { ExtractionError, parseJsonObject } from './extract.ts'
import type { ModelClient } from '../_shared/types.ts'

export const INTENTS = ['spend', 'question', 'action', 'chatter'] as const
export type Intent = (typeof INTENTS)[number]

/** Below this, a classifier answer is treated the same as a failure to classify at all — fall back to spend. */
const CONFIDENCE_FLOOR = 0.6

// Case-insensitive message prefixes that read as a question with very high
// certainty and cost nothing to detect — checked before ever calling the model.
const QUESTION_STARTS = [
  'how much', 'how many', "what's", 'what is', 'what are', 'whats',
  'when is', "when's", 'when do', 'where are', 'how are', "how's",
  'show me', 'list', 'tell me', 'did we', 'did i', 'am i', 'are we', 'can you tell',
]

const AMOUNT_TOKEN = /\d+(?:\.\d+)?/
// A capitalised word not at the very start of the message — "Carrefour" in
// "how much was that Carrefour trip" reads as a merchant name, not a
// sentence-initial capital.
const MID_MESSAGE_CAPITAL_WORD = /\S+\s+.*\b[A-Z][a-z]{2,}\b/

/**
 * The regex fast path. Returns true only when the message reads as a
 * question with no real ambiguity — a currency amount alongside a
 * merchant-ish word ("how much was that Carrefour trip, 240?") falls through
 * to the classifier instead of being assumed a question, since that shape is
 * genuinely ambiguous between "tell me the total" and "log this spend".
 */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  const matchesStart = QUESTION_STARTS.some((prefix) => lower.startsWith(prefix))
  const endsWithQuestionMark = trimmed.endsWith('?')
  if (!matchesStart && !endsWithQuestionMark) return false

  if (AMOUNT_TOKEN.test(trimmed) && MID_MESSAGE_CAPITAL_WORD.test(trimmed)) return false
  return true
}

const CLASSIFIER_SYSTEM_PROMPT = `Classify one Telegram message from a household member of a Dubai couple's personal finance bot into exactly one intent.

Return ONLY JSON, no prose, no markdown fences: {"intent": "spend" | "question" | "action" | "chatter", "confidence": number}

Intents:
- spend: describes money that was paid or spent, whether typed, a receipt caption, or a correction ("84 lunch", "just paid rent 3000", "carrefour 45.50").
- question: asks about existing data — totals, history, balances, budgets, goals ("how much on groceries", "what did I spend at Noon last week", "are we over budget").
- action: asks the bot to DO something other than log a spend — move money into a goal, update a balance, log income ("put 500 into the car fund", "I got paid today", "update my Wio balance to 4000").
- chatter: not a finance message at all — greetings, thanks, reactions, small talk ("thanks!", "ok", "😂", "good morning").

Examples:
"84 lunch noon" → {"intent":"spend","confidence":0.95}
"how much did we spend on groceries this month" → {"intent":"question","confidence":0.97}
"put 200 towards the emergency fund" → {"intent":"action","confidence":0.9}
"thanks!" → {"intent":"chatter","confidence":0.95}
"lol" → {"intent":"chatter","confidence":0.9}
"what's my net worth" → {"intent":"question","confidence":0.95}
"paid the DEWA bill 340" → {"intent":"spend","confidence":0.9}
"good morning" → {"intent":"chatter","confidence":0.9}

When genuinely unsure between spend and anything else, prefer spend — a missed question costs one tap to correct, a missed spend is money nobody tracks.`

interface Classification {
  intent: Intent
  confidence: number
}

/**
 * Calls the model classifier. Returns null on any failure — a thrown call,
 * malformed JSON, an out-of-enum intent, a non-numeric confidence — which
 * `routeMessage` treats identically to a low-confidence answer: fall back to
 * spend. Exported for route.test.ts; intake.ts only ever calls `routeMessage`.
 */
export async function classifyIntent(text: string, model: ModelClient): Promise<Classification | null> {
  let raw: string
  try {
    raw = await model.chat([
      { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
      { role: 'user', content: text },
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

  const intent = parsed.intent
  if (typeof intent !== 'string' || !(INTENTS as readonly string[]).includes(intent)) return null

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
  if (!Number.isFinite(confidence)) return null

  return { intent: intent as Intent, confidence }
}

/**
 * The router's single entry point. Steps 5–7 of the routing order in the
 * task description — callback/reply-correction/photo/voice/command routing
 * all happen in intake.ts before this is ever called, and never reach here.
 */
export async function routeMessage(text: string, model: ModelClient): Promise<Intent> {
  if (looksLikeQuestion(text)) return 'question'

  const classified = await classifyIntent(text, model)
  if (!classified || classified.confidence < CONFIDENCE_FLOOR) return 'spend'
  return classified.intent
}
