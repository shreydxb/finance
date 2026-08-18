// A corpus of real-shaped messages for the intent router (route.ts), pinning
// down the one rule that governs it: A MISROUTED SPEND IS A LOST SPEND. This
// runs in CI with no keys — it is what stops a router regression from ever
// reaching production, the same role fixtures/receipts.ts plays for extraction.
//
// Each case names the intent it must resolve to. Most spend/action/chatter
// text, and one question example, never trip the regex fast path
// (looksLikeQuestion) — those carry a `classifierResponse` that stands in for
// a plausible model answer. Cases that resolve purely off the regex fast path
// leave `classifierResponse` undefined; routing.test.ts proves those never
// even call the model. A few cases are genuinely hopeless for a classifier to
// resolve (a bare number, a bare category word) — those also leave
// `classifierResponse` undefined, but for the opposite reason: they exist to
// prove that even a classifier that throws or answers nonsense still falls
// back to 'spend', per the router's core bias.

import type { Intent } from '../route.ts'

export interface RoutingCase {
  label: string
  text: string
  expectedIntent: Intent
  /** A plausible model answer for cases that reach the classifier. Leave unset when the case resolves via the regex fast path, or is meant to prove the classifier-failure fallback to 'spend'. */
  classifierResponse?: { intent: Intent; confidence: number }
}

export const ROUTING_CASES: RoutingCase[] = [
  // ── spend — must never be misrouted; this is the expensive direction ────
  { label: 'plain typed spend', text: '84 lunch noon', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.95 } },
  { label: 'spend with a verb and merchant', text: 'spent 240 at carrefour', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.95 } },
  { label: 'amount-first spend', text: '1200 dhs rent', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.93 } },
  { label: 'bare amount with a verb, no merchant', text: 'paid 84', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.85 } },
  { label: 'merchant, amount, category and payer all typed', text: 'carrefour 240 groceries tarika paid', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.96 } },
  { label: 'decimal amount, two-word merchant', text: '45.50 karak house', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.92 } },
  { label: 'a typed stock buy — spend-shaped even though Sprint 4 gives it an action reading', text: 'bought 12 SKHY at 21.40 today', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.8 } },
  { label: 'round-number shopping spend', text: '5000 dubai mall shopping', expectedIntent: 'spend', classifierResponse: { intent: 'spend', confidence: 0.88 } },

  // ── question — most of these hit the regex fast path and never call the model ──
  { label: '"how much" + a period, caught by regex', text: 'how much did we spend on groceries this month', expectedIntent: 'question' },
  { label: '"what\'s", caught by regex', text: "what's our net worth", expectedIntent: 'question' },
  { label: '"how much" + budget wording, caught by regex', text: 'how much is left in the dining budget', expectedIntent: 'question' },
  {
    label: '"what did" is not a listed prefix — the one question case that needs the classifier',
    text: 'what did tarika spend last week',
    expectedIntent: 'question',
    classifierResponse: { intent: 'question', confidence: 0.9 },
  },
  { label: '"when is", caught by regex', text: 'when is the car emi due', expectedIntent: 'question' },
  { label: '"how are", caught by regex', text: 'how are we doing on the emergency fund', expectedIntent: 'question' },
  { label: 'bare trailing "?", caught by regex', text: 'spending this month?', expectedIntent: 'question' },
  { label: '"how much" + account wording, caught by regex', text: 'how much on the enbd card in july', expectedIntent: 'question' },

  // ── action — Sprint 4 targets, none reachable by regex ──────────────────
  { label: 'move money into a goal', text: 'put 2000 into the emergency fund', expectedIntent: 'action', classifierResponse: { intent: 'action', confidence: 0.9 } },
  { label: 'update an account balance', text: 'wio savings is now 41300', expectedIntent: 'action', classifierResponse: { intent: 'action', confidence: 0.85 } },
  { label: 'set a standing categorisation rule', text: 'always put talabat under dining out', expectedIntent: 'action', classifierResponse: { intent: 'action', confidence: 0.8 } },

  // ── chatter — must produce silence ───────────────────────────────────────
  { label: 'bare acknowledgement', text: 'ok', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.9 } },
  { label: 'thanks', text: 'thanks', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.95 } },
  { label: 'emoji reaction', text: '👍', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.9 } },
  { label: 'laughter', text: 'haha', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.9 } },
  { label: 'bare confirmation word', text: 'yes', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.85 } },
  { label: 'bare past-tense word', text: 'done', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.85 } },
  { label: 'a second emoji reaction', text: '😂', expectedIntent: 'chatter', classifierResponse: { intent: 'chatter', confidence: 0.92 } },

  // ── ambiguous / adversarial — the expected answer and why ───────────────
  {
    label: 'question-shaped opener, but an amount + capitalised merchant name makes it genuinely ambiguous — the regex guard hands this to the classifier, which resolves it to spend',
    text: 'how much was that Carrefour trip, 240?',
    expectedIntent: 'spend',
    classifierResponse: { intent: 'spend', confidence: 0.7 },
  },
  {
    label: 'bare number, nothing else — no classifier can meaningfully resolve this, so it must fall back to spend even if the model call fails outright',
    text: '240',
    expectedIntent: 'spend',
  },
  {
    label: 'bare category word, most likely a correction fragment threaded onto a prior message — must fall back to spend',
    text: 'groceries',
    expectedIntent: 'spend',
  },
  {
    label: 'bare amount, no context at all — must fall back to spend',
    text: '84',
    expectedIntent: 'spend',
  },
]
