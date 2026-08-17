// Demo mode: run mocked Telegram payloads through the real intake flow with no
// bot, no OpenRouter key and no database.
//
//   npm run demo:telegram
//
// The model responses are canned (that's the only part being faked) — the
// allowlist, confidence gate, row writes and confirm/fix loop are the real code
// paths. Use it to eyeball the wording of the bot's replies after a change.
//
// To exercise the *deployed* function against a mocked payload instead, see
// "Demo mode against the deployed function" in README.md.

import { FakeMessenger, FakeModel, FakeQueryStore, FakeStore, FakeTranscriber, household } from './fixtures/fakes.ts'
import {
  callbackUpdate,
  photoUpdate,
  replyUpdate,
  SHREY_ID,
  STRANGER_ID,
  TARIKA_ID,
  textUpdate,
  voiceUpdate,
} from './fixtures/updates.ts'
import { handleUpdate } from './intake.ts'
import type { TelegramUpdate, TransactionRow } from '../_shared/types.ts'

const TODAY = new Date().toISOString().slice(0, 10)

function reply(fields: Record<string, unknown>): string {
  return JSON.stringify({ date: TODAY, currency: 'AED', paid_by: null, paid_with: null, note: null, ...fields })
}

const store = new FakeStore(household())
const messenger = new FakeMessenger()
const model = new FakeModel([
  reply({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Noon · lunch', confidence: 0.95 }),
  reply({ amount: 184.25, category: 'Groceries', paid_with: 'Joint Current', note: 'Carrefour · weekly shop', confidence: 0.93 }),
  reply({ amount: 48, category: 'Dining Out', paid_with: 'unclear', note: 'Karak stop', confidence: 0.55 }),
  reply({ amount: 84, category: 'Dining Out', paid_with: 'Wio Personal', note: 'Karak House', confidence: 0.97 }),
  reply({ amount: null, category: 'Groceries', paid_with: 'Joint Current', note: 'Waitrose · total unreadable', confidence: 0.4 }),
])
// A separate FakeModel from `model` — the intent router (Taskiv #50) calls
// this one, and it must never eat an entry off the extraction queue above.
// Every demo message here is spend-shaped, so it always answers the same way.
const classifierModel = new FakeModel(JSON.stringify({ intent: 'spend', confidence: 0.99 }))

const deps = {
  store,
  queryStore: new FakeQueryStore(),
  messenger,
  model,
  classifierModel,
  transcriber: new FakeTranscriber('spent forty eight dirhams on karak'),
  defaultCurrency: 'AED',
  log: (message: string, data?: Record<string, unknown>) => console.log(`      · ${message}`, data ?? ''),
}

async function step(label: string, update: TelegramUpdate): Promise<void> {
  const before = messenger.sent.length
  console.log(`\n▸ ${label}`)
  const outcome = await handleUpdate(update, deps)
  for (const sent of messenger.sent.slice(before)) {
    if (sent.method === 'answerCallbackQuery') {
      console.log(`   ↩︎ toast: ${sent.text ?? '(silent)'}`)
      continue
    }
    const prefix = sent.method === 'editMessageText' ? '   ✎ edited:' : '   💬 bot:'
    console.log(`${prefix} ${(sent.text ?? '').replace(/\n/g, '\n           ')}`)
    if (sent.opts?.inlineKeyboard) {
      console.log(`      [${sent.opts.inlineKeyboard[0].map((b) => b.text).join('] [')}]`)
    }
  }
  console.log(`   → ${JSON.stringify(outcome)}`)
}

function printLedger(rows: TransactionRow[]): void {
  console.log('\n── transactions written ──────────────────────────────────────')
  for (const row of rows) {
    const flag = row.needs_review ? '⚠️  needs review' : '✓ clean'
    console.log(
      `  ${row.date}  ${String(row.amount).padStart(8)} ${row.currency}  ${(row.category ?? 'Uncategorised').padEnd(22)} ${(row.owner ?? '—').padEnd(8)} ${flag}`
    )
  }
  console.log(`\n  ${rows.length} row(s), ${rows.filter((r) => r.needs_review).length} awaiting review.`)
}

await step('Shrey types "84 aed lunch at Noon" (high confidence)', textUpdate('84 aed lunch at Noon', SHREY_ID))

await step('Tarika sends a Carrefour receipt photo', photoUpdate('weekly shop', TARIKA_ID))

await step('Tarika sends a voice note (low confidence)', voiceUpdate(TARIKA_ID))
const flagged = Array.from(store.rows.values()).find((row) => row.needs_review)
if (flagged) {
  await step('…she taps ✏️ Fix', callbackUpdate('fix', flagged.id, TARIKA_ID))
  const promptId = (await store.getTransaction(flagged.id))?.telegram_prompt_msg_id ?? 0
  await step('…and replies "84, paid from my Wio"', replyUpdate('84, paid from my Wio', promptId, TARIKA_ID))
}

await step('Shrey sends a blurred receipt (amount unreadable)', photoUpdate(null, SHREY_ID))
const unreadable = Array.from(store.rows.values()).find((row) => row.amount === 0)
if (unreadable) {
  await step('…he taps ✅ Confirm anyway (the bot refuses to bless a zero)', callbackUpdate('confirm', unreadable.id, SHREY_ID))
}

await step('Someone outside the household tries to log a spend', textUpdate('10000 aed watch', STRANGER_ID))

printLedger(Array.from(store.rows.values()))
