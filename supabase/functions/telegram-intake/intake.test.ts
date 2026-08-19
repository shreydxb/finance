import assert from 'node:assert/strict'
import test from 'node:test'

import { ACCOUNTS, FakeMessenger, FakeModel, FakeQueryStore, FakeStore, FakeTranscriber, household } from './fixtures/fakes.ts'
import { TODAY } from './fixtures/receipts.ts'
import {
  albumPhotoUpdate,
  callbackUpdate,
  CHAT_ID,
  documentUpdate,
  photoUpdate,
  replyUpdate,
  SHREY_ID,
  STRANGER_ID,
  TARIKA_ID,
  textUpdate,
  voiceUpdate,
} from './fixtures/updates.ts'
import { errorHint, handleUpdate, matchAccount, matchAccountTies } from './intake.ts'
import type { IntakeDeps } from './intake.ts'
import type { TransactionRow } from '../_shared/types.ts'

function json(fields: Record<string, unknown>): string {
  return JSON.stringify({
    date: TODAY,
    currency: 'AED',
    paid_by: null,
    paid_with: null,
    note: null,
    ...fields,
  })
}

const CLEAN = json({
  amount: 84,
  category: 'Dining Out',
  paid_with: 'ENBD Credit Card 4412',
  note: 'Noon',
  confidence: 0.95,
})

interface Harness {
  deps: IntakeDeps
  store: FakeStore
  messenger: FakeMessenger
  model: FakeModel
  classifierModel: FakeModel
  transcriber: FakeTranscriber
}

/**
 * classifierModel defaults to a fixed "spend, high confidence" answer — a
 * separate FakeModel instance from `model`, so the router's extra call
 * never consumes an entry meant for extraction. Every pre-#50 test still
 * routes to spend exactly as before; tests that want question/chatter/action
 * routing pass their own `classifierResponses` (or overwrite
 * `h.deps.classifierModel` directly for a THROW:/malformed case).
 */
const DEFAULT_CLASSIFIER_RESPONSE = JSON.stringify({ intent: 'spend', confidence: 0.99 })

function harness(
  responses: string | string[] = CLEAN,
  opts: {
    transcript?: string
    withTranscriber?: boolean
    defaultAccountId?: string | null
    classifierResponses?: string | string[]
  } = {}
): Harness {
  const store = new FakeStore(household({ defaultAccountId: opts.defaultAccountId ?? null }))
  const messenger = new FakeMessenger()
  const model = new FakeModel(responses)
  const classifierModel = new FakeModel(opts.classifierResponses ?? DEFAULT_CLASSIFIER_RESPONSE)
  const transcriber = new FakeTranscriber(opts.transcript ?? 'spent 84 dirhams at karak house')
  return {
    store,
    messenger,
    model,
    classifierModel,
    transcriber,
    deps: {
      store,
      queryStore: new FakeQueryStore(),
      messenger,
      model,
      classifierModel,
      pendingActionHandlers: {},
      transcriber: opts.withTranscriber === false ? null : transcriber,
      defaultCurrency: 'AED',
      now: () => new Date(`${TODAY}T09:00:00Z`),
      // Real setTimeout would make every album test take ALBUM_DEBOUNCE_MS;
      // tests that need to exercise the debounce race override this directly.
      wait: () => Promise.resolve(),
    },
  }
}

test('a sender outside the household is ignored silently', async () => {
  const h = harness()
  const outcome = await handleUpdate(textUpdate('84 aed lunch', STRANGER_ID), h.deps)

  assert.equal(outcome.status, 'ignored')
  assert.equal(h.store.rows.size, 0)
  assert.equal(h.messenger.sent.length, 0, 'a stranger learns nothing about the bot')
  assert.equal(h.model.calls.length, 0, 'and never costs a model call')
})

test('/id answers anyone, so the two household ids can be found during setup', async () => {
  const h = harness()
  await handleUpdate(textUpdate('/id', STRANGER_ID), h.deps)

  assert.match(h.messenger.last().text ?? '', new RegExp(String(STRANGER_ID)))
  assert.equal(h.store.rows.size, 0)
})

test('high confidence auto-logs with a one-line FYI and no buttons', async () => {
  const h = harness()
  const outcome = await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.deepEqual(outcome, { status: 'logged', transactionId: 'tx-1', needsReview: false })

  const row = h.store.only()
  assert.equal(row.needs_review, false)
  assert.equal(row.amount, 84)
  assert.equal(row.category, 'Dining Out')
  assert.equal(row.account_id, 'acc-enbd')
  assert.equal(row.owner, 'Shrey')
  assert.equal(row.source, 'telegram')
  assert.equal(row.telegram_chat_id, CHAT_ID)
  assert.ok(row.telegram_msg_id)

  const sent = h.messenger.last()
  assert.equal(sent.text, 'Logged: Dining Out · 84 AED · Noon · ENBD Credit Card 4412 ✓')
  assert.equal(sent.opts?.inlineKeyboard, undefined)
})

test('a high-confidence itemized receipt grows the FYI with a capped breakdown', async () => {
  const items = [
    { name: 'Makhana', qty: 1, price: 12 },
    { name: 'Dosa Batter', qty: 2, price: 9.5 },
    { name: 'Oats', qty: null, price: 8 },
    { name: 'Cucumber', qty: null, price: 3.45 },
    { name: 'Red Onion', qty: null, price: 9 },
    { name: 'Tomato', qty: null, price: 4 },
    { name: 'Yogurt', qty: null, price: 6 },
    { name: 'Bread', qty: null, price: 5 },
    { name: 'Eggs', qty: null, price: 15 },
    { name: 'Milk', qty: null, price: 7 },
  ]
  const h = harness(
    json({ amount: 79.95, category: 'Groceries', paid_with: 'ENBD Credit Card 4412', note: 'Carrefour', confidence: 0.95, items })
  )
  await handleUpdate(textUpdate('carrefour groceries'), h.deps)

  const row = h.store.only()
  assert.deepEqual(row.items, items, 'the full item list is stored even though the reply caps display')

  const sent = h.messenger.last()
  assert.equal(
    sent.text,
    [
      'Logged: Groceries · 79.95 AED · Carrefour · ENBD Credit Card 4412 ✓',
      '  • Makhana 12',
      '  • 2× Dosa Batter 9.5',
      '  • Oats 8',
      '  • Cucumber 3.45',
      '  • Red Onion 9',
      '  • Tomato 4',
      '  • Yogurt 6',
      '  • Bread 5',
      '  +2 more',
    ].join('\n')
  )
})

test('a source with no line items gets the plain one-line reply, unchanged', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Noon', confidence: 0.95 }))
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(h.store.only().items, null)
  assert.equal(h.messenger.last().text, 'Logged: Dining Out · 84 AED · Noon · ENBD Credit Card 4412 ✓')
})

test('the first allowlisted message captures the chat id for future pushes', async () => {
  const h = harness()
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(h.store.putSettingCalls.length, 1)
  assert.equal(h.store.putSettingCalls[0].key, 'tg_chat_id')
  assert.equal((h.store.putSettingCalls[0].value as { chat_id: number }).chat_id, CHAT_ID)
})

test('a second message does not re-capture an already-stored chat id', async () => {
  const h = harness([CLEAN, CLEAN])
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)
  await handleUpdate(textUpdate('50 aed coffee'), h.deps)

  assert.equal(h.store.putSettingCalls.length, 1)
})

test('a message from a different chat than the stored one is logged, not followed', async () => {
  const h = harness()
  h.store.settings.set('tg_chat_id', { chat_id: -999 })
  const logs: Array<[string, Record<string, unknown> | undefined]> = []
  h.deps.log = (message, data) => logs.push([message, data])

  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(h.store.putSettingCalls.length, 0)
  assert.deepEqual(h.store.settings.get('tg_chat_id'), { chat_id: -999 })
  assert.ok(logs.some(([msg]) => msg.includes('second chat')))
})

// Taskiv #49 — the outbound chat-id allowlist. The household allowlist above
// gates on `from.id`, a field read straight out of the request body; these
// three cover the guard that stops a forged `from.id` from also redirecting
// where the reply goes.

test('#49 forged chat: an allowlisted sender in an unrecognised chat gets the spend logged but no reply sent there', async () => {
  const h = harness()
  h.store.settings.set('tg_chat_id', { chat_id: -999 }) // the real household chat, already captured

  // Same shape a forged request would have: a real allowlisted from.id, but
  // chat.id pointed somewhere the household chat was never captured to.
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps) // textUpdate's chat.id is CHAT_ID, not -999

  assert.equal(h.store.only().amount, 84, 'the spend itself is still written — never silently lost')
  assert.deepEqual(h.messenger.sent, [], 'no Confirm/Fix prompt (or anything else) reached the unrecognised chat')
})

test('#49 normal group: a reply to the captured household chat is not blocked', async () => {
  const h = harness()
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.ok(h.messenger.sent.some((s) => s.method === 'sendMessage' && s.chatId === CHAT_ID), 'ordinary traffic still gets its reply')
})

test('#49 /id answers even in a chat nothing has captured yet (setup path)', async () => {
  const h = harness()
  // A brand new household: no tg_chat_id captured, sender not yet in the allowlist either.
  h.store.context = household()

  await handleUpdate(textUpdate('/id', STRANGER_ID), h.deps)

  const reply = h.messenger.last()
  assert.equal(reply.method, 'sendMessage')
  assert.equal(reply.chatId, CHAT_ID)
  assert.match(reply.text ?? '', new RegExp(`${STRANGER_ID}`))
})

test('a settings-write failure while capturing the chat id still logs the spend', async () => {
  const h = harness()
  h.store.failPutSetting = true

  const outcome = await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.only().amount, 84)
})

test('the prompt is told the Gulf calendar date, not the UTC one, across the midnight boundary', async () => {
  const h = harness()
  h.deps.now = () => new Date('2026-08-10T21:30:00Z') // 01:30 next day in Asia/Dubai
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.match(h.model.lastPromptText(), /Today's date is 2026-08-11/)
})

test('low confidence still writes the row, then asks with Confirm/Fix', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.6 }))
  const outcome = await handleUpdate(textUpdate('lunch somewhere'), h.deps)

  assert.equal(outcome.status, 'logged')
  const row = h.store.only()
  assert.equal(row.needs_review, true)
  assert.equal(row.amount, 84, 'nothing is held back waiting for a confirmation')

  const sent = h.messenger.last()
  const buttons = sent.opts?.inlineKeyboard?.[0] ?? []
  assert.deepEqual(
    buttons.map((b) => b.callback_data),
    [`confirm:${row.id}`, `fix:${row.id}`]
  )
  assert.equal(row.telegram_prompt_msg_id, 5001, 'the prompt is remembered for reply-threading')
})

test('a needs-review itemized reply lists the items between the summary and the date', async () => {
  const items = [
    { name: 'Makhana', qty: 1, price: 12 },
    { name: 'Dosa Batter', qty: 2, price: 9.5 },
  ]
  const h = harness(json({ amount: 21.5, category: 'Groceries', paid_with: null, confidence: 0.6, items }))
  await handleUpdate(textUpdate('groceries'), h.deps)

  assert.equal(
    h.messenger.last().text,
    [
      'Logged — worth a quick check:',
      'Groceries · 21.5 AED · account unknown',
      '  • Makhana 12',
      '  • 2× Dosa Batter 9.5',
      'Thu 6 Aug',
      'Not sure about: which account.',
    ].join('\n')
  )
})

test('an unreadable amount is written as a flagged zero, never dropped', async () => {
  const h = harness(json({ amount: null, category: 'Groceries', paid_with: 'Joint Current', confidence: 0.9 }))
  await handleUpdate(photoUpdate(), h.deps)

  const row = h.store.only()
  assert.equal(row.amount, 0)
  assert.equal(row.needs_review, true)
  assert.match(h.messenger.last().text ?? '', /amount unreadable/)
  assert.match(h.messenger.last().text ?? '', /Not sure about: the amount/)
})

test('an unmatched category or account forces review even at high confidence', async () => {
  const h = harness(json({ amount: 210, category: 'Pet Supplies', paid_with: 'some wallet', confidence: 0.99 }))
  await handleUpdate(textUpdate('210 for cat food'), h.deps)

  const row = h.store.only()
  assert.equal(row.category, null)
  assert.equal(row.account_id, null)
  assert.equal(row.needs_review, true)
  assert.match(h.messenger.last().text ?? '', /the category, which account/)
})

test('a configured default account rescues an unrecognised payment method', async () => {
  const h = harness(json({ amount: 45, category: 'Groceries', paid_with: 'cash', confidence: 0.95 }), {
    defaultAccountId: 'acc-joint',
  })
  await handleUpdate(textUpdate('45 groceries'), h.deps)

  const row = h.store.only()
  assert.equal(row.account_id, 'acc-joint')
  assert.equal(row.needs_review, false)
})

test('photos go to the vision model at the largest available size', async () => {
  const h = harness()
  await handleUpdate(photoUpdate('weekly shop'), h.deps)

  assert.equal(h.messenger.sent.filter((s) => s.method === 'sendMessage').length, 1)
  assert.equal(h.model.lastHadImage(), true)
  assert.match(h.model.lastPromptText(), /weekly shop/)
})

test('a single-photo album still logs normally after the debounce wait', async () => {
  const h = harness()
  const outcome = await handleUpdate(albumPhotoUpdate('grp-solo', 'photo-a', 'weekly shop'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.rows.size, 1)
  assert.equal(h.model.calls.length, 1)
})

test('two photos in one album become ONE transaction, extracted from both images together', async () => {
  const h = harness(CLEAN)
  let secondOutcome: unknown
  let triggered = false
  // Simulate the second album photo arriving while the first is "waiting" —
  // this is the actual race extractFromAlbumPhoto is built to resolve.
  h.deps.wait = async () => {
    if (triggered) return
    triggered = true
    secondOutcome = await handleUpdate(albumPhotoUpdate('grp-1', 'photo-b', null), h.deps)
  }

  const firstOutcome = await handleUpdate(albumPhotoUpdate('grp-1', 'photo-a', 'weekly shop'), h.deps)

  assert.equal(firstOutcome.status, 'ignored', 'the first photo stands down once a second one joins after it')
  assert.deepEqual(secondOutcome, { status: 'logged', transactionId: h.store.only().id, needsReview: false })
  assert.equal(h.store.rows.size, 1, 'one album, one transaction — not two')
  assert.equal(h.model.calls.length, 1, 'exactly one extraction call for the whole album')
  assert.equal(
    (h.model.lastPromptText().match(/\[image/g) ?? []).length,
    2,
    'both photos went into the same extraction call'
  )
  assert.match(h.model.lastPromptText(), /weekly shop/, 'the caption from whichever photo carried one is kept')
  assert.equal(h.messenger.sent.filter((s) => s.method === 'sendMessage').length, 1, 'only one reply for the whole album')
})

test('voice notes are transcribed and then run through the text pipeline', async () => {
  const h = harness(CLEAN, { transcript: 'spent eighty four dirhams at karak house' })
  await handleUpdate(voiceUpdate(), h.deps)

  assert.equal(h.transcriber.calls.length, 1)
  assert.equal(h.model.lastHadImage(), false)
  assert.match(h.model.lastPromptText(), /transcript of a voice note/)
  assert.match(h.model.lastPromptText(), /eighty four dirhams/)
  assert.equal(h.store.only().owner, 'Tarika', 'the sender is the payer by default')
})

test('without a transcription key a voice note is answered, not swallowed', async () => {
  const h = harness(CLEAN, { withTranscriber: false })
  const outcome = await handleUpdate(voiceUpdate(), h.deps)

  assert.equal(outcome.status, 'ignored')
  assert.equal(h.store.rows.size, 0)
  assert.match(h.messenger.last().text ?? '', /Voice notes aren't switched on/)
})

test('a PDF or other document is refused, never logged as a garbage row', async () => {
  const h = harness()
  const outcome = await handleUpdate(documentUpdate("Hello! I've attached my noon document"), h.deps)

  assert.equal(outcome.status, 'ignored')
  assert.equal(h.store.rows.size, 0, 'the caption alone must never become a spend')
  assert.match(h.messenger.last().text ?? '', /can't read PDFs/)
  assert.equal(h.model.calls.length, 0)
})

test('paid_by naming the other person overrides the sender', async () => {
  const h = harness(json({ amount: 60, category: 'Groceries', paid_by: 'Tarika', paid_with: 'Wio Personal', confidence: 0.95 }))
  await handleUpdate(textUpdate('Tarika paid 60 for groceries', SHREY_ID), h.deps)

  assert.equal(h.store.only().owner, 'Tarika')
})

test('Confirm clears the flag and retires the buttons', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.5 }))
  await handleUpdate(textUpdate('lunch'), h.deps)
  const id = h.store.only().id

  const outcome = await handleUpdate(callbackUpdate('confirm', id), h.deps)

  assert.deepEqual(outcome, { status: 'confirmed', transactionId: id })
  assert.equal(h.store.only().needs_review, false)
  assert.equal(h.store.only().telegram_prompt_msg_id, null)

  const edit = h.messenger.sent.find((s) => s.method === 'editMessageText')
  assert.ok(edit, 'the original prompt is rewritten')
  assert.match(edit.text ?? '', /✓$/)
  assert.equal(edit.opts?.inlineKeyboard, undefined, 'a stale message cannot be tapped twice')
  assert.ok(h.messenger.sent.some((s) => s.method === 'answerCallbackQuery'))
})

test('Confirm on a row with no amount asks for the number instead of blessing a zero', async () => {
  const h = harness(json({ amount: null, category: 'Groceries', paid_with: 'Joint Current', confidence: 0.9 }))
  await handleUpdate(photoUpdate(), h.deps)
  const id = h.store.only().id

  const outcome = await handleUpdate(callbackUpdate('confirm', id), h.deps)

  assert.deepEqual(outcome, { status: 'fix_requested', transactionId: id })
  assert.equal(h.store.only().needs_review, true, 'a zero-amount row never goes clean')
  assert.equal(h.messenger.last().opts?.forceReply, true)
  assert.match(h.messenger.last().text ?? '', /never got an amount/)
})

test('a repeat of an already-logged spend gets a duplicate warning, but is still written', async () => {
  const h = harness([
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
  ])
  await handleUpdate(textUpdate('84 aed karak house'), h.deps)
  const firstId = h.store.only().id

  const outcome = await handleUpdate(textUpdate('84 aed karak house again'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.rows.size, 2, 'the repeat is written too — a warning never blocks the write')
  const secondId = Array.from(h.store.rows.keys()).find((id) => id !== firstId)!

  const sent = h.messenger.last()
  assert.equal(
    sent.text,
    'Logged: Dining Out · 84 AED · Karak House · ENBD Credit Card 4412 ✓\n⚠️ Looks like a duplicate of Thu 6 Aug, 84 AED · Karak House.'
  )
  assert.deepEqual(sent.opts?.inlineKeyboard, [[{ text: '🗑 Delete this one', callback_data: `delete:${secondId}` }]])
})

test('a needs-review duplicate keeps Confirm/Fix and adds a delete row underneath', async () => {
  const h = harness([
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
    // category null forces needs_review while keeping the same resolved account, so the dedupe match still holds.
    json({ amount: 84, category: null, paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
  ])
  await handleUpdate(textUpdate('84 aed karak house'), h.deps)
  const firstId = h.store.only().id

  await handleUpdate(textUpdate('84 aed karak house again'), h.deps)
  const secondId = Array.from(h.store.rows.keys()).find((id) => id !== firstId)!

  const sent = h.messenger.last()
  assert.match(sent.text ?? '', /⚠️ Looks like a duplicate of Thu 6 Aug, 84 AED · Karak House\./)
  assert.deepEqual(sent.opts?.inlineKeyboard, [
    [
      { text: '✅ Confirm', callback_data: `confirm:${secondId}` },
      { text: '✏️ Fix', callback_data: `fix:${secondId}` },
    ],
    [{ text: '🗑 Delete this one', callback_data: `delete:${secondId}` }],
  ])
})

test('a same-amount spend more than a day apart is not flagged as a duplicate', async () => {
  const h = harness([
    json({ amount: 200, category: 'Utilities', paid_with: 'ENBD Credit Card 4412', note: 'DEWA', confidence: 0.95 }),
    json({
      amount: 200,
      category: 'Utilities',
      paid_with: 'ENBD Credit Card 4412',
      note: 'DEWA',
      confidence: 0.95,
      date: '2026-08-01',
    }),
  ])
  await handleUpdate(textUpdate('200 aed dewa'), h.deps)
  await handleUpdate(textUpdate('200 aed dewa last month'), h.deps)

  const sent = h.messenger.last()
  assert.doesNotMatch(sent.text ?? '', /duplicate/i)
  assert.equal(sent.opts?.inlineKeyboard, undefined)
})

test('an unreadable amount never triggers a duplicate lookup — every flagged zero would "match"', async () => {
  const h = harness(json({ amount: null, category: 'Groceries', paid_with: 'Joint Current', confidence: 0.9 }))
  const store = h.store
  let calls = 0
  const real = store.findPossibleDuplicate.bind(store)
  store.findPossibleDuplicate = (params) => {
    calls++
    return real(params)
  }

  await handleUpdate(photoUpdate(), h.deps)

  assert.equal(calls, 0)
})

test('"Delete this one" soft-deletes just the tapped row and retires the message', async () => {
  const h = harness([
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', note: 'Karak House', confidence: 0.95 }),
  ])
  await handleUpdate(textUpdate('84 aed karak house'), h.deps)
  const firstId = h.store.only().id
  await handleUpdate(textUpdate('84 aed karak house again'), h.deps)
  const secondId = Array.from(h.store.rows.keys()).find((id) => id !== firstId)!

  const outcome = await handleUpdate(callbackUpdate('delete', secondId), h.deps)

  assert.deepEqual(outcome, { status: 'deleted', transactionId: secondId })
  assert.ok(h.store.rows.get(secondId)?.deleted_at, 'the tapped row is soft-deleted')
  assert.equal(h.store.rows.get(firstId)?.deleted_at, null, 'the other row is untouched')

  const edit = h.messenger.sent.find((s) => s.method === 'editMessageText')
  assert.ok(edit, 'the duplicate prompt is rewritten so it cannot be tapped again')
  assert.match(edit.text ?? '', /— deleted 🗑$/)
  assert.ok(h.messenger.sent.some((s) => s.method === 'answerCallbackQuery' && s.text === 'Deleted'))
})

test('tapping Delete twice is a no-op, not an error', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.95 }))
  await handleUpdate(textUpdate('84 aed lunch'), h.deps)
  const id = h.store.only().id

  await handleUpdate(callbackUpdate('delete', id), h.deps)
  const outcome = await handleUpdate(callbackUpdate('delete', id), h.deps)

  assert.deepEqual(outcome, { status: 'deleted', transactionId: id })
  const acks = h.messenger.sent.filter((s) => s.method === 'answerCallbackQuery')
  assert.equal(acks.length, 2)
  assert.equal(acks[1].text, 'Already deleted')
})

test('a cashback message proposes instead of writing a transaction', async () => {
  const h = harness('{"amount":15,"currency":"AED","source":"ENBD Credit Card cashback","date":"2026-08-06"}')
  const outcome = await handleUpdate(textUpdate('got 15 aed cashback from the ENBD card'), h.deps)

  assert.equal(outcome.status, 'cashback_proposed')
  assert.equal(h.store.rows.size, 0, 'nothing is written to transactions')
  assert.equal(h.store.income.length, 0, 'nothing is written to income yet either — propose-then-tap')
  assert.equal(h.store.pendingIncome.size, 1)

  const pendingId = (outcome as { pendingId: string }).pendingId
  const sent = h.messenger.last()
  assert.equal(sent.text, 'Log cashback?\n15 AED · ENBD Credit Card cashback · Shrey · Thu 6 Aug')
  assert.deepEqual(sent.opts?.inlineKeyboard, [
    [
      { text: '✅ Apply', callback_data: `cashback_apply:${pendingId}` },
      { text: '✖️ Cancel', callback_data: `cashback_cancel:${pendingId}` },
    ],
  ])
})

test('Apply writes the income row and clears the pending proposal', async () => {
  const h = harness('{"amount":15,"currency":"AED","source":"ENBD Credit Card cashback","date":"2026-08-06"}')
  await handleUpdate(textUpdate('got 15 aed cashback from the ENBD card'), h.deps)
  const pendingId = Array.from(h.store.pendingIncome.keys())[0]

  const outcome = await handleUpdate(callbackUpdate('cashback_apply', pendingId), h.deps)

  assert.deepEqual(outcome, { status: 'cashback_applied', pendingId })
  assert.equal(h.store.pendingIncome.size, 0, 'the proposal is cleared once applied')
  assert.deepEqual(h.store.income, [
    { person: 'Shrey', source: 'ENBD Credit Card cashback', kind: 'other', amount: 15, currency: 'AED', date: '2026-08-06' },
  ])

  const edit = h.messenger.sent.find((s) => s.method === 'editMessageText')
  assert.equal(edit?.text, 'Logged: 15 AED · ENBD Credit Card cashback · Shrey · Thu 6 Aug ✓')
})

test('tapping Apply twice logs the cashback once', async () => {
  // The old path inserted the income and then deleted the proposal as two
  // calls, so a retry between them — or an impatient second tap — recorded the
  // same cashback twice. The delete is now the guard.
  const h = harness('{"amount":25,"currency":"AED","source":"ENBD cashback","person":"Shrey","date":"2026-08-06","kind":"other","confidence":0.95}')
  await handleUpdate(textUpdate('got 25 cashback from ENBD'), h.deps)

  const pendingId = Array.from(h.store.pendingIncome.keys())[0]
  assert.ok(pendingId, 'a proposal was created')

  await handleUpdate(callbackUpdate('cashback_apply', pendingId), h.deps)
  assert.equal(h.store.income.length, 1, 'logged once')

  const second = await handleUpdate(callbackUpdate('cashback_apply', pendingId), h.deps)

  assert.equal(h.store.income.length, 1, 'still once after a replayed tap')
  assert.equal(second.status, 'ignored')
})

test('Cancel discards the proposal without writing anything', async () => {
  const h = harness('{"amount":15,"currency":"AED","source":"ENBD Credit Card cashback","date":"2026-08-06"}')
  await handleUpdate(textUpdate('got 15 aed cashback from the ENBD card'), h.deps)
  const pendingId = Array.from(h.store.pendingIncome.keys())[0]

  const outcome = await handleUpdate(callbackUpdate('cashback_cancel', pendingId), h.deps)

  assert.deepEqual(outcome, { status: 'cashback_cancelled', pendingId })
  assert.equal(h.store.pendingIncome.size, 0)
  assert.equal(h.store.income.length, 0, 'Cancel never writes income')
})

test('a cashback message with no readable amount asks for it instead of proposing', async () => {
  const h = harness('{"amount":null,"currency":"AED","source":"some cashback","date":"2026-08-06"}')
  const outcome = await handleUpdate(textUpdate('got some cashback the other day'), h.deps)

  assert.equal(outcome.status, 'error')
  assert.equal(h.store.pendingIncome.size, 0, 'nothing is proposed without a number')
  assert.match(h.messenger.last().text ?? '', /How much cashback/)
})

test('a cashback extraction failure is reported back, nothing proposed', async () => {
  const h = harness('THROW:OpenRouter 500: server error')
  const outcome = await handleUpdate(textUpdate('cashback landed today'), h.deps)

  assert.equal(outcome.status, 'error')
  assert.equal(h.store.pendingIncome.size, 0)
  assert.match(h.messenger.last().text ?? '', /couldn't read that cashback message/)
})

test('applying a cashback proposal that no longer exists is a graceful no-op', async () => {
  const h = harness()
  const outcome = await handleUpdate(callbackUpdate('cashback_apply', 'pending-999'), h.deps)

  assert.equal(outcome.status, 'ignored')
  assert.match(h.messenger.last().text ?? '', /gone/)
})

test('a plain spend message never gets routed into the cashback flow', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.95 }))
  await handleUpdate(textUpdate('84 aed lunch at Noon, paid cash'), h.deps)

  assert.equal(h.store.rows.size, 1)
  assert.equal(h.store.pendingIncome.size, 0)
})

// ── BOT-01: redelivery must not duplicate money ──────────────────────────────
//
// Telegram retries an update when the webhook times out or answers 5xx, so the
// same message arriving twice is a normal operating condition, not an edge
// case. Before 027 each retry wrote a second copy of the money.

test('a redelivered single spend updates one row instead of adding another', async () => {
  // Exactly what happened live on 13 Aug 2026. The transaction is written
  // *before* the reply is sent, so when sendMessage failed against a revoked
  // bot token the function errored, Telegram retried, and eight identical
  // "Karak House" rows landed in the ledger. Bulk and transfer were keyed;
  // the single-spend path — much the most common — was not.
  const h = harness([CLEAN, CLEAN, CLEAN])
  const update = textUpdate('84 dhs lunch at karak house')

  await handleUpdate(update, h.deps)
  assert.equal(h.store.rows.size, 1)

  await handleUpdate(update, h.deps)
  await handleUpdate(update, h.deps)

  assert.equal(h.store.rows.size, 1, 'three deliveries, one spend')
})

test('two genuinely different messages still write two rows', async () => {
  // The keying must not collapse real spends that merely look alike.
  const h = harness([CLEAN, CLEAN])
  await handleUpdate(textUpdate('84 dhs lunch at karak house'), h.deps)
  await handleUpdate(textUpdate('84 dhs lunch at karak house'), h.deps)

  assert.equal(h.store.rows.size, 2, 'different messages, different rows')
})

test('a redelivered transfer message writes nothing the second time', async () => {
  const h = harness([
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":"Joint Current","date":"2026-08-06"}',
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":"Joint Current","date":"2026-08-06"}',
  ])
  const update = textUpdate('moved 2000 from Wio to Joint Current')

  await handleUpdate(update, h.deps)
  assert.equal(h.store.rows.size, 2, 'the pair lands once')

  // Same update id, same message id — exactly what Telegram resends.
  const outcome = await handleUpdate(update, h.deps)

  assert.equal(h.store.rows.size, 2, 'still two rows, not four')
  assert.equal(outcome.status, 'ignored')
})

test('a redelivered bulk message writes nothing the second time', async () => {
  const bulk = '[{"amount":40,"currency":"AED","category":"Dining Out","note":"coffee","date":"2026-08-06","confidence":0.95},{"amount":90,"currency":"AED","category":"Transport & Fuel","note":"taxi","date":"2026-08-06","confidence":0.95}]'
  const h = harness([bulk, bulk])
  const update = textUpdate('coffee 40 and taxi 90')

  await handleUpdate(update, h.deps)
  assert.equal(h.store.rows.size, 2, 'both spends land once')

  await handleUpdate(update, h.deps)
  assert.equal(h.store.rows.size, 2, 'a replay adds nothing')
})

test('a clean transfer writes two linked rows, never touches accounts.value, and is not a spend', async () => {
  const h = harness(
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":"Joint Current","date":"2026-08-06"}'
  )
  const outcome = await handleUpdate(textUpdate('moved 2000 from Wio to Joint Current'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal((outcome as { needsReview: boolean }).needsReview, false)
  assert.equal(h.store.rows.size, 2, 'exactly two rows, never one and never a proposal')
  assert.equal(h.store.pendingIncome.size, 0)

  const rows = Array.from(h.store.rows.values())
  const out = rows.find((r) => r.account_id === 'acc-wio')!
  const inn = rows.find((r) => r.account_id === 'acc-joint')!
  assert.ok(out && inn, 'one row per account')
  assert.equal(out.category, 'Transfer')
  assert.equal(inn.category, 'Transfer')
  assert.equal(out.amount, 2000)
  assert.equal(inn.amount, 2000)
  assert.equal(out.note, 'Transfer out → Joint Current')
  assert.equal(inn.note, 'Transfer in ← Wio Personal')
  assert.equal(out.needs_review, false)
  assert.equal(inn.needs_review, false)
  assert.ok(out.transaction_group_id, 'linked by a shared transaction_group_id')
  assert.equal(out.transaction_group_id, inn.transaction_group_id)
  // DATA-01: the pair declares what it is, so the UI shows one movement rather
  // than guessing "category split" and doubling the amount.
  assert.equal(out.group_kind, 'transfer')
  assert.equal(inn.group_kind, 'transfer')
  assert.equal(out.transfer_direction, 'out')
  assert.equal(inn.transfer_direction, 'in')

  assert.equal(h.messenger.last().text, 'Logged: Transfer 2,000 AED · Wio Personal → Joint Current ✓')
  assert.equal(h.messenger.last().opts?.inlineKeyboard, undefined, 'no buttons on a clean transfer')
})

test('a transfer with an unresolved account flags both rows and offers Confirm only', async () => {
  const h = harness(
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":"some savings account","date":"2026-08-06"}'
  )
  await handleUpdate(textUpdate('moved 2000 from Wio to some savings account'), h.deps)

  const rows = Array.from(h.store.rows.values())
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.needs_review === true), 'both halves flagged, not just the unresolved one')

  const sent = h.messenger.last()
  assert.equal(
    sent.text,
    [
      'Logged — worth a quick check:',
      'Transfer 2,000 AED · Wio Personal → some savings account',
      'Thu 6 Aug',
      'Not sure about: which account it landed in.',
    ].join('\n')
  )
  assert.deepEqual(sent.opts?.inlineKeyboard, [[{ text: '✅ Confirm', callback_data: `confirm:${rows[0].id}` }]])
})

test('the same account on both sides is flagged, not silently accepted', async () => {
  const h = harness(
    '{"amount":500,"currency":"AED","from_account":"Wio Personal","to_account":"Wio Personal","date":"2026-08-06"}'
  )
  await handleUpdate(textUpdate('moved 500 from Wio to Wio'), h.deps)

  assert.match(h.messenger.last().text ?? '', /the two accounts look the same/)
  assert.ok(Array.from(h.store.rows.values()).every((r) => r.needs_review === true))
})

test('Confirm on a transfer clears needs_review on both halves of the pair', async () => {
  const h = harness(
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":null,"date":"2026-08-06"}'
  )
  await handleUpdate(textUpdate('moved 2000 from Wio to somewhere'), h.deps)
  const [first, second] = Array.from(h.store.rows.values())
  const promptedId = h.messenger.last().opts?.inlineKeyboard?.[0]?.[0]?.callback_data?.split(':')[1]

  const outcome = await handleUpdate(callbackUpdate('confirm', promptedId!), h.deps)

  assert.equal(outcome.status, 'confirmed')
  assert.equal(h.store.rows.get(first.id)?.needs_review, false)
  assert.equal(h.store.rows.get(second.id)?.needs_review, false)
})

test('Confirm on a transfer with no amount points at the app, not a forceReply into the spend correction pipeline', async () => {
  const h = harness(
    '{"amount":null,"currency":"AED","from_account":"Wio Personal","to_account":"Joint Current","date":"2026-08-06"}'
  )
  await handleUpdate(textUpdate('moved from Wio to Joint Current'), h.deps)
  const outRow = Array.from(h.store.rows.values()).find((r) => r.account_id === 'acc-wio')!

  const outcome = await handleUpdate(callbackUpdate('confirm', outRow.id), h.deps)

  assert.equal(outcome.status, 'fix_requested')
  assert.equal(h.store.rows.get(outRow.id)?.needs_review, true, 'still flagged — nothing was confirmed')
  const edit = h.messenger.sent.find((s) => s.method === 'editMessageText')
  assert.match(edit?.text ?? '', /edit it in the app/)
  assert.equal(h.messenger.sent.some((s) => s.opts?.forceReply), false, 'never threads into the spend correction pipeline')
})

test('a transfer extraction failure is reported back, nothing written', async () => {
  const h = harness('THROW:OpenRouter 500: server error')
  const outcome = await handleUpdate(textUpdate('transferred 500 to savings'), h.deps)

  assert.equal(outcome.status, 'error')
  assert.equal(h.store.rows.size, 0)
  assert.match(h.messenger.last().text ?? '', /couldn't read that transfer/)
})

test('a 3-amount message writes 3 rows sharing one bulk_batch group, one reply, no buttons when nothing needs review', async () => {
  const h = harness(
    '[' +
      json({ amount: 45, category: 'Groceries', confidence: 0.95 }) +
      ',' +
      json({ amount: 12, category: 'Dining Out', confidence: 0.95 }) +
      ',' +
      json({ amount: 200, category: 'Utilities', confidence: 0.95 }) +
      ']',
    { defaultAccountId: 'acc-joint' }
  )

  const outcome = await handleUpdate(textUpdate('spent 45 on groceries, 12 on coffee, and 200 on utilities'), h.deps)

  assert.deepEqual(outcome, { status: 'logged', transactionId: 'tx-1', needsReview: false })
  assert.equal(h.store.rows.size, 3)
  const rows = Array.from(h.store.rows.values())
  assert.ok(rows.every((r) => r.needs_review === false))
  assert.ok(rows[0].transaction_group_id, 'linked by a shared transaction_group_id')
  assert.ok(rows.every((r) => r.transaction_group_id === rows[0].transaction_group_id))
  // Independent spends that merely arrived together — never a category split.
  assert.ok(rows.every((r) => r.group_kind === 'bulk_batch'))
  assert.ok(rows.every((r) => r.transfer_direction == null), 'direction is transfer-only')
  assert.ok(
    rows.every((r) => r.telegram_msg_id === null),
    'unset — a bare reply to the shared inbound message would otherwise match an arbitrary row'
  )

  assert.equal(
    h.messenger.last().text,
    ['Logged 3:', '① Groceries · 45 AED', '② Dining Out · 12 AED', '③ Utilities · 200 AED', '✓'].join('\n')
  )
  assert.equal(h.messenger.last().opts?.inlineKeyboard, undefined, 'no buttons on a fully clean bulk write')
})

test('a bulk write with a flagged row shows Confirm all + Fix per row, and marks only the flagged line', async () => {
  const h = harness(
    '[' +
      json({ amount: 45, category: 'Groceries', confidence: 0.95 }) +
      ',' +
      json({ amount: 12, category: null, confidence: 0.5 }) +
      ',' +
      json({ amount: 200, category: 'Utilities', confidence: 0.95 }) +
      ']',
    { defaultAccountId: 'acc-joint' }
  )

  await handleUpdate(textUpdate('45 groceries, 12 something, 200 utilities'), h.deps)

  const rows = Array.from(h.store.rows.values())
  assert.equal(rows.filter((r) => r.needs_review).length, 1)

  const sent = h.messenger.last()
  assert.match(sent.text ?? '', /① Groceries · 45 AED\n/)
  assert.match(sent.text ?? '', /② Uncategorised · 12 AED — needs review/)
  assert.match(sent.text ?? '', /③ Utilities · 200 AED$/)
  assert.deepEqual(sent.opts?.inlineKeyboard?.[0], [{ text: '✅ Confirm all', callback_data: `confirm_group:${rows[0].id}` }])
  assert.deepEqual(
    sent.opts?.inlineKeyboard?.[1],
    rows.map((r, i) => ({ text: `✏️ Fix #${i + 1}`, callback_data: `fix:${r.id}` }))
  )
})

test('Fix #2 threads a correction to that row only, leaving its siblings untouched', async () => {
  const h = harness(
    '[' +
      json({ amount: 45, category: 'Groceries', confidence: 0.95 }) +
      ',' +
      json({ amount: 12, category: null, confidence: 0.5 }) +
      ',' +
      json({ amount: 200, category: 'Utilities', confidence: 0.95 }) +
      ']',
    { defaultAccountId: 'acc-joint' }
  )
  await handleUpdate(textUpdate('45 groceries, 12 something, 200 utilities'), h.deps)
  const rows = Array.from(h.store.rows.values())
  const flagged = rows.find((r) => r.needs_review)!
  const others = rows.filter((r) => r.id !== flagged.id)

  const fixOutcome = await handleUpdate(callbackUpdate('fix', flagged.id), h.deps)
  assert.equal(fixOutcome.status, 'fix_requested')
  const promptMsgId = h.store.rows.get(flagged.id)!.telegram_prompt_msg_id!

  h.model.responses = [json({ amount: 12, category: 'Dining Out', note: 'coffee', confidence: 0.97 })]
  const corrected = await handleUpdate(replyUpdate('it was coffee', promptMsgId), h.deps)

  assert.equal(corrected.status, 'corrected')
  assert.equal(h.store.rows.get(flagged.id)?.category, 'Dining Out')
  assert.equal(h.store.rows.get(flagged.id)?.needs_review, false)
  for (const other of others) {
    assert.equal(h.store.rows.get(other.id)?.category, other.category, 'untouched by a correction aimed at a different row')
    assert.equal(h.store.rows.get(other.id)?.amount, other.amount)
  }
})

test('Confirm all clears every row whose amount is nonzero, leaving a zero-amount row still flagged', async () => {
  const h = harness(
    '[' +
      json({ amount: 45, category: 'Groceries', confidence: 0.95 }) +
      ',' +
      json({ amount: null, category: 'Dining Out', confidence: 0.3 }) +
      ',' +
      json({ amount: 200, category: null, confidence: 0.5 }) +
      ']',
    { defaultAccountId: 'acc-joint' }
  )
  await handleUpdate(textUpdate('45 groceries, unreadable amount, 200 something'), h.deps)
  const rows = Array.from(h.store.rows.values())
  const clean = rows.find((r) => r.amount === 45)!
  const zeroAmount = rows.find((r) => r.amount === 0)!
  const flaggedCategory = rows.find((r) => r.amount === 200)!
  assert.equal(clean.needs_review, false)
  assert.equal(zeroAmount.needs_review, true)
  assert.equal(flaggedCategory.needs_review, true)

  const outcome = await handleUpdate(callbackUpdate('confirm_group', rows[0].id), h.deps)

  assert.equal(outcome.status, 'confirmed')
  assert.equal(h.store.rows.get(clean.id)?.needs_review, false)
  assert.equal(
    h.store.rows.get(flaggedCategory.id)?.needs_review,
    false,
    'a nonzero-amount row is cleared even though its category was unresolved'
  )
  assert.equal(h.store.rows.get(zeroAmount.id)?.needs_review, true, 'a zero amount is never blessed, even inside Confirm all')

  const edit = h.messenger.sent.find((s) => s.method === 'editMessageText')
  assert.match(edit?.text ?? '', /Confirmed 2 of 3:/)
  assert.match(edit?.text ?? '', /still needs the amount/)
  assert.equal(edit?.opts?.inlineKeyboard, undefined, 'keyboard dropped so it cannot be tapped twice')
})

test('a bulk-looking message that is really one transaction falls back to the ordinary single-spend reply', async () => {
  const h = harness('[' + CLEAN + ']')

  const outcome = await handleUpdate(textUpdate('84 aed at Noon, order #12345'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.rows.size, 1)
  const row = h.store.only()
  assert.ok(row.telegram_msg_id, 'the ordinary single-spend path sets telegram_msg_id, unlike a real bulk write')
  assert.equal(row.transaction_group_id, null)
  assert.match(h.messenger.last().text ?? '', /^Logged: /, 'reads exactly like a normal single spend, not a numbered list')
})

test('a bulk extraction failure is reported back, nothing written', async () => {
  const h = harness('THROW:OpenRouter 500: server error')

  const outcome = await handleUpdate(textUpdate('45 groceries, 12 coffee'), h.deps)

  assert.equal(outcome.status, 'error')
  assert.equal(h.store.rows.size, 0)
  assert.match(h.messenger.last().text ?? '', /couldn't read that one/)
})

test('Fix asks for the correction and remembers which message it hangs off', async () => {
  const h = harness(json({ amount: 48, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.5 }))
  await handleUpdate(textUpdate('lunch'), h.deps)
  const id = h.store.only().id

  const outcome = await handleUpdate(callbackUpdate('fix', id), h.deps)

  assert.deepEqual(outcome, { status: 'fix_requested', transactionId: id })
  const prompt = h.messenger.last()
  assert.equal(prompt.opts?.forceReply, true)
  assert.match(prompt.text ?? '', /What should it be\?/)
  assert.equal(h.store.only().telegram_prompt_msg_id, 5002)
})

test('a threaded correction updates the same row instead of adding one', async () => {
  const corrected = json({
    amount: 84,
    category: 'Groceries',
    paid_with: 'Joint Current',
    note: 'Carrefour',
    confidence: 0.97,
  })
  const h = harness([json({ amount: 48, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.5 }), corrected])

  await handleUpdate(textUpdate('lunch 48'), h.deps)
  const id = h.store.only().id
  await handleUpdate(callbackUpdate('fix', id), h.deps)

  const outcome = await handleUpdate(replyUpdate('84 not 48, and it was groceries at Carrefour', 5002), h.deps)

  assert.deepEqual(outcome, { status: 'corrected', transactionId: id, needsReview: false })
  assert.equal(h.store.rows.size, 1, 'a correction never forks a second transaction')

  const row = h.store.only()
  assert.equal(row.amount, 84)
  assert.equal(row.category, 'Groceries')
  assert.equal(row.account_id, 'acc-joint')
  assert.equal(row.needs_review, false)
  assert.equal(row.telegram_prompt_msg_id, null)

  // The correction goes back through the same extraction pipeline, carrying the
  // current JSON so untouched fields survive.
  assert.match(h.model.lastPromptText(), /Current extracted JSON/)
  assert.match(h.model.lastPromptText(), /84 not 48/)
  assert.match(h.messenger.last().text ?? '', /^Updated: Groceries · 84 AED · Carrefour · Joint Current ✓$/)
})

test('replying to your own original message works too', async () => {
  const h = harness([
    json({ amount: 48, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.5 }),
    json({ amount: 84, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.97 }),
  ])
  const first = textUpdate('lunch 48')
  await handleUpdate(first, h.deps)

  const outcome = await handleUpdate(replyUpdate('it was 84', first.message?.message_id ?? 0), h.deps)

  assert.equal(outcome.status, 'corrected')
  assert.equal(h.store.rows.size, 1)
  assert.equal(h.store.only().amount, 84)
})

test('a reply that matches nothing is treated as a brand new spend', async () => {
  const h = harness()
  const outcome = await handleUpdate(replyUpdate('84 aed lunch', 424242), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.rows.size, 1)
})

test('callbacks from outside the household do nothing', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', confidence: 0.5 }))
  await handleUpdate(textUpdate('lunch'), h.deps)
  const id = h.store.only().id
  const before = h.messenger.sent.length

  const outcome = await handleUpdate(callbackUpdate('confirm', id, STRANGER_ID), h.deps)

  assert.equal(outcome.status, 'ignored')
  assert.equal(h.store.only().needs_review, true)
  assert.equal(h.messenger.sent.length - before, 1, 'only the empty callback ack')
})

test('a model failure is reported back rather than dropped on the floor', async () => {
  const h = harness('THROW:OpenRouter 402: insufficient credits')
  const outcome = await handleUpdate(textUpdate('84 aed lunch'), h.deps)

  assert.equal(outcome.status, 'error')
  assert.equal(h.store.rows.size, 0)
  const reply = h.messenger.last().text ?? ''
  assert.match(reply, /couldn't read that one/)
  // The cause is shown, not buried: a blurry photo and an unpaid API bill are
  // very different problems, and only one of them is worth retrying.
  assert.match(reply, /OpenRouter 402: insufficient credits/)
  assert.match(reply, /add it by hand in the app/)
})

test('a successful extraction logs an inbound event with model, tokens and the transaction id', async () => {
  const h = harness()
  h.model.usage = { promptTokens: 120, completionTokens: 40, totalTokens: 160 }
  await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(h.store.logs.length, 1)
  const entry = h.store.logs[0]
  assert.equal(entry.direction, 'inbound')
  assert.equal(entry.stage, 'extract_text')
  assert.equal(entry.messageType, 'text')
  assert.equal(entry.success, true)
  assert.equal(entry.person, 'Shrey')
  assert.equal(entry.telegramUserId, SHREY_ID)
  assert.equal(entry.model, 'fake-model')
  assert.deepEqual(entry.usage, { promptTokens: 120, completionTokens: 40, totalTokens: 160 })
  assert.equal(entry.transactionId, h.store.only().id)
  assert.ok(typeof entry.durationMs === 'number')
})

test('a failed extraction logs the error instead of the transaction id', async () => {
  const h = harness('THROW:OpenRouter 402: insufficient credits')
  await handleUpdate(textUpdate('84 aed lunch'), h.deps)

  assert.equal(h.store.logs.length, 1)
  const entry = h.store.logs[0]
  assert.equal(entry.success, false)
  assert.match(entry.error ?? '', /insufficient credits/)
  assert.equal(entry.transactionId, null)
})

test('a photo extraction logs message_type photo with a bracketed summary, not the raw bytes', async () => {
  const h = harness()
  await handleUpdate(photoUpdate(), h.deps)

  assert.equal(h.store.logs.length, 1)
  assert.equal(h.store.logs[0].messageType, 'photo')
  assert.match(h.store.logs[0].inputSummary ?? '', /^\[photo\]/)
})

test('a correction logs its own stage, separate from the original extraction', async () => {
  const h = harness([json({ amount: 48, category: 'Dining Out', confidence: 0.5 }), CLEAN])
  await handleUpdate(textUpdate('lunch 48'), h.deps)
  const id = h.store.only().id
  await handleUpdate(callbackUpdate('fix', id), h.deps)
  h.store.logs.length = 0

  await handleUpdate(replyUpdate('84 not 48', 5002), h.deps)

  assert.equal(h.store.logs.length, 1)
  assert.equal(h.store.logs[0].stage, 'correction')
  assert.equal(h.store.logs[0].success, true)
  assert.equal(h.store.logs[0].transactionId, id)
})

test('a Confirm tap logs a callback event', async () => {
  const h = harness(json({ amount: 84, category: 'Dining Out', confidence: 0.95 }))
  await handleUpdate(textUpdate('lunch'), h.deps)
  const id = h.store.only().id
  h.store.logs.length = 0

  await handleUpdate(callbackUpdate('confirm', id, SHREY_ID), h.deps)

  assert.equal(h.store.logs.length, 1)
  assert.equal(h.store.logs[0].stage, 'callback')
  assert.equal(h.store.logs[0].success, true)
  assert.equal(h.store.logs[0].inputSummary, 'confirm')
})

test('a broken log write never blocks the reply or the write it was logging', async () => {
  const h = harness()
  h.store.failLogEvent = true
  const outcome = await handleUpdate(textUpdate('84 aed lunch at Noon'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.rows.size, 1)
  assert.match(h.messenger.last().text ?? '', /Logged:/)
})

test('errorHint flattens and truncates, and gives up on empty errors', () => {
  assert.equal(errorHint(new Error('OpenRouter 400:\n  bad  request')), 'OpenRouter 400: bad request')
  assert.equal(errorHint(new Error('')), null)
  assert.equal(errorHint(new Error('x'.repeat(400)))?.length, 201)
})

test('/help explains the three ways to send a spend', async () => {
  const h = harness()
  await handleUpdate(textUpdate('/help', TARIKA_ID), h.deps)

  assert.match(h.messenger.last().text ?? '', /voice note/)
  assert.equal(h.store.rows.size, 0)
})

test('/undo with nothing to undo says so and writes nothing', async () => {
  const h = harness()
  await handleUpdate(textUpdate('/undo', SHREY_ID), h.deps)

  assert.match(h.messenger.last().text ?? '', /Nothing of mine to undo/)
  assert.equal(h.store.rows.size, 0)
})

test('/undo on a real bot-logged row proposes removal — asks first, deletes nothing yet', async () => {
  const h = harness()
  const row = await h.store.insertTransactionOnce(
    {
      date: TODAY,
      amount: 84,
      currency: 'AED',
      category: 'Dining Out',
      note: 'Noon',
      account_id: 'acc-enbd',
      source: 'telegram',
      telegram_chat_id: CHAT_ID,
      telegram_msg_id: 1,
      needs_review: false,
    },
    'seed-key'
  )

  await handleUpdate(textUpdate('/undo', SHREY_ID), h.deps)

  const prompt = h.messenger.last()
  assert.match(prompt.text ?? '', /Remove this\?/)
  assert.match(prompt.text ?? '', /Dining Out/)
  assert.equal(prompt.opts?.inlineKeyboard?.[0][0].text, '🗑 Remove')
  assert.equal(prompt.opts?.inlineKeyboard?.[0][1].text, '✖️ Keep')
  // Nothing deleted yet — only a proposal was written, not a soft-delete.
  const stillThere = await h.store.getTransaction(row.id)
  assert.equal(stillThere?.deleted_at, null)
})

test('/undo ignores a manually-entered row even if it is the most recent one in the chat', async () => {
  const h = harness()
  await h.store.insertTransactionOnce(
    {
      date: TODAY,
      amount: 50,
      currency: 'AED',
      category: 'Shopping',
      source: 'manual',
      telegram_chat_id: CHAT_ID,
      needs_review: false,
    },
    'manual-key'
  )

  await handleUpdate(textUpdate('/undo', SHREY_ID), h.deps)

  assert.match(h.messenger.last().text ?? '', /Nothing of mine to undo/)
})

test('matchAccountTies names the accounts a tie was between, matching the real ...1657 case', () => {
  // Two sub-ledgers on one physical card — exactly what broke in production:
  // "paid with card ...1657" is genuinely ambiguous between them.
  const twoOnSameCard: typeof ACCOUNTS = [
    { id: 'acc-a', name: 'Car Down-Payment EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
    { id: 'acc-b', name: 'Mobile EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
  ]
  assert.equal(matchAccount('card ending 1657', twoOnSameCard), null, 'still abstains rather than guessing')
  assert.deepEqual(
    matchAccountTies('card ending 1657', twoOnSameCard).map((a) => a.id).sort(),
    ['acc-a', 'acc-b']
  )
})

test('a tied account match is named in the review prompt, not left as a bare "account unknown"', async () => {
  const twoOnSameCard = household()
  twoOnSameCard.accounts = [
    { id: 'acc-a', name: 'Car Down-Payment EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
    { id: 'acc-b', name: 'Mobile EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
  ]
  const store = new FakeStore(twoOnSameCard)
  const h = harness(json({ amount: 43.05, category: 'Shopping', paid_with: 'card ending 1657', confidence: 0.95 }))
  h.deps.store = store

  await handleUpdate(textUpdate('43.05 to Noon, card ending 1657'), h.deps)

  const reply = h.messenger.last().text ?? ''
  assert.match(reply, /Car Down-Payment EMI/)
  assert.match(reply, /Mobile EMI/)
})

test('matchAccount maps payment hints to accounts, and abstains when unsure', () => {
  assert.equal(matchAccount('ENBD Credit Card 4412', ACCOUNTS)?.id, 'acc-enbd')
  assert.equal(matchAccount('VISA ****4412', ACCOUNTS)?.id, 'acc-enbd')
  assert.equal(matchAccount('enbd', ACCOUNTS)?.id, 'acc-enbd')
  assert.equal(matchAccount('Wio', ACCOUNTS)?.id, 'acc-wio')
  assert.equal(matchAccount('joint current', ACCOUNTS)?.id, 'acc-joint')
  assert.equal(matchAccount('card', ACCOUNTS), null, 'generic words are not enough to pick one')
  assert.equal(matchAccount('Apple Pay', ACCOUNTS), null)
  assert.equal(matchAccount(null, ACCOUNTS), null)
})

// ── Taskiv #50: intent router, end-to-end ─────────────────────────────────

test('a question does not write a transaction', async () => {
  const h = harness()
  const outcome = await handleUpdate(textUpdate('how much did we spend on groceries this month'), h.deps)

  assert.equal(h.store.rows.size, 0)
  assert.equal(outcome.status, 'ignored')
  assert.ok(h.messenger.last(), 'the household still gets an answer, just not a logged spend')
})

test('an ordinary spend message still writes a transaction', async () => {
  const h = harness()
  await handleUpdate(textUpdate('84 lunch noon'), h.deps)

  assert.equal(h.store.only().amount, 84)
})

test('a photo captioned "how much is this?" still routes to spend — captions never reach the router', async () => {
  const h = harness()
  await handleUpdate(photoUpdate('how much is this?'), h.deps)

  assert.equal(h.store.only().amount, 84)
  assert.equal(h.classifierModel.calls.length, 0, 'the router is never even consulted for a photo')
})

test('a classifier returning malformed JSON falls back to spend, not an error', async () => {
  const h = harness(undefined, { classifierResponses: 'not json at all' })
  const outcome = await handleUpdate(textUpdate('grabbed something at the shop'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.only().amount, 84)
})

test('a classifier that throws falls back to spend, not an error', async () => {
  const h = harness(undefined, { classifierResponses: 'THROW:OpenRouter 500: server error' })
  const outcome = await handleUpdate(textUpdate('grabbed something at the shop'), h.deps)

  assert.equal(outcome.status, 'logged')
  assert.equal(h.store.only().amount, 84)
})

test('"thanks!" produces no reply and no row — chatter is silence, not an "ok"', async () => {
  const h = harness(undefined, { classifierResponses: JSON.stringify({ intent: 'chatter', confidence: 0.95 }) })
  const outcome = await handleUpdate(textUpdate('thanks!'), h.deps)

  assert.equal(h.store.rows.size, 0)
  assert.equal(h.messenger.sent.length, 0)
  assert.equal(outcome.status, 'ignored')
})

test('a low-confidence classifier answer falls back to spend rather than trusting a shaky guess', async () => {
  const h = harness(undefined, { classifierResponses: JSON.stringify({ intent: 'chatter', confidence: 0.3 }) })
  await handleUpdate(textUpdate('grabbed something at the shop'), h.deps)

  assert.equal(h.store.only().amount, 84)
})

test('an "action" classification has no handler yet and falls through to spend', async () => {
  const h = harness(undefined, { classifierResponses: JSON.stringify({ intent: 'action', confidence: 0.9 }) })
  await handleUpdate(textUpdate('put 200 into the car fund'), h.deps)

  assert.equal(h.store.only().amount, 84)
})

test('a stranger is rejected before the router (and the classifier) ever runs', async () => {
  const h = harness()
  await handleUpdate(textUpdate('how much did we spend on groceries', STRANGER_ID), h.deps)

  assert.equal(h.classifierModel.calls.length, 0)
  assert.equal(h.messenger.sent.length, 0)
})

test('a reply-correction is resolved before the router ever runs, even if it reads like a question', async () => {
  const h = harness(json({ amount: 48, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.5 }))
  await handleUpdate(textUpdate('lunch'), h.deps)
  const id = h.store.only().id
  const promptId = h.store.only().telegram_prompt_msg_id ?? 0

  const corrected = json({ amount: 48, category: 'Dining Out', paid_with: 'ENBD Credit Card 4412', confidence: 0.97 })
  h.model.responses = [corrected]
  const classifierCallsBefore = h.classifierModel.calls.length
  await handleUpdate(replyUpdate('what did I actually pay?', promptId), h.deps)

  assert.equal(h.classifierModel.calls.length, classifierCallsBefore, 'a threaded reply is a correction, never routed as a question')
  assert.equal(h.store.only().id, id, 'still the same row, updated in place')
})

// ── /review (Taskiv #62) ────────────────────────────────────────────────────

function flagged(h: Harness, patch: Partial<TransactionRow> = {}) {
  return h.store.insertTransaction({
    date: TODAY,
    amount: 48,
    currency: 'AED',
    category: 'Dining Out',
    account_id: ACCOUNTS[1].id,
    note: 'Karak stop',
    needs_review: true,
    ...patch,
  })
}

test('/review with an empty queue says so and offers no buttons', async () => {
  const h = harness()
  const outcome = await handleUpdate(textUpdate('/review'), h.deps)

  assert.deepEqual(outcome, { status: 'review_presented', transactionId: null })
  assert.equal(h.messenger.last().text, 'Nothing flagged. All clean.')
  assert.equal(h.messenger.last().opts?.inlineKeyboard, undefined)
})

test('/review presents the oldest flagged row with all four buttons', async () => {
  const h = harness()
  const first = await flagged(h)
  await flagged(h, { note: 'Second one', amount: 12 })

  const outcome = await handleUpdate(textUpdate('/review'), h.deps)

  assert.deepEqual(outcome, { status: 'review_presented', transactionId: first.id })
  const sent = h.messenger.last()
  assert.match(sent.text ?? '', /^1 of 2\n/)
  assert.match(sent.text ?? '', /Karak stop/)
  assert.deepEqual(sent.opts?.inlineKeyboard, [
    [
      { text: '✅ Confirm', callback_data: `rconfirm:${first.id}` },
      { text: '✏️ Fix', callback_data: `rfix:${first.id}` },
    ],
    [
      { text: '⏭ Skip', callback_data: `rskip:${first.id}` },
      { text: '🗑 Remove', callback_data: `rdelete:${first.id}` },
    ],
  ])
})

test('/review walks a three-row queue via Confirm, Skip and Remove, then reports all clear', async () => {
  const h = harness()
  const a = await flagged(h, { note: 'A' })
  const b = await flagged(h, { note: 'B' })
  const c = await flagged(h, { note: 'C' })

  await handleUpdate(textUpdate('/review'), h.deps)
  assert.equal(h.messenger.last().opts?.inlineKeyboard?.[0]?.[0]?.callback_data, `rconfirm:${a.id}`)

  // Confirm row A — advances straight to B.
  await handleUpdate(callbackUpdate('rconfirm', a.id), h.deps)
  assert.equal((await h.store.getTransaction(a.id))?.needs_review, false)
  assert.equal(h.messenger.last().opts?.inlineKeyboard?.[0]?.[0]?.callback_data, `rconfirm:${b.id}`)

  // Skip row B — untouched, advances to C.
  await handleUpdate(callbackUpdate('rskip', b.id), h.deps)
  assert.equal((await h.store.getTransaction(b.id))?.needs_review, true, 'skip does not resolve the row')
  assert.equal(h.messenger.last().opts?.inlineKeyboard?.[0]?.[0]?.callback_data, `rconfirm:${c.id}`)

  // Remove row C — soft-deleted, queue is now empty.
  await handleUpdate(callbackUpdate('rdelete', c.id), h.deps)
  assert.ok((await h.store.getTransaction(c.id))?.deleted_at, 'remove soft-deletes')
  assert.equal(h.messenger.last().text, 'All clear — nothing else flagged. ✓')
  assert.equal(h.messenger.last().opts?.inlineKeyboard, undefined)

  // B is still flagged (only skipped) and comes back on a fresh /review.
  const again = await handleUpdate(textUpdate('/review'), h.deps)
  assert.deepEqual(again, { status: 'review_presented', transactionId: b.id })
})

test('Confirm from /review refuses a zero amount exactly like the original inline prompt, and does not advance', async () => {
  const h = harness()
  const zero = await flagged(h, { amount: 0 })
  await flagged(h, { note: 'still waiting' })
  await handleUpdate(textUpdate('/review'), h.deps) // captures the chat so outbound replies aren't guard-blocked

  const outcome = await handleUpdate(callbackUpdate('rconfirm', zero.id), h.deps)

  assert.deepEqual(outcome, { status: 'fix_requested', transactionId: zero.id })
  assert.equal((await h.store.getTransaction(zero.id))?.needs_review, true, 'a zero-amount row never goes clean')
  assert.match(h.messenger.last().text ?? '', /never got an amount/)
  assert.equal(h.messenger.last().opts?.forceReply, true, 'no next card yet — still waiting on this row')
})

test('Fix from /review opens the normal correction prompt and does not itself advance the queue', async () => {
  const h = harness()
  const row = await flagged(h)
  await flagged(h, { note: 'next up' })
  await handleUpdate(textUpdate('/review'), h.deps) // captures the chat so outbound replies aren't guard-blocked

  const outcome = await handleUpdate(callbackUpdate('rfix', row.id), h.deps)

  assert.deepEqual(outcome, { status: 'fix_requested', transactionId: row.id })
  assert.match(h.messenger.last().text ?? '', /What should it be\?/)
  assert.equal(h.messenger.last().opts?.forceReply, true)
})

test('two concurrent /review sessions cannot double-resolve the same row', async () => {
  const h = harness()
  const row = await flagged(h)
  await handleUpdate(textUpdate('/review'), h.deps) // captures the chat so outbound replies aren't guard-blocked

  // Both partners' clients fetched the same card before either tapped anything.
  const [first, second] = await Promise.all([
    handleUpdate(callbackUpdate('rconfirm', row.id), h.deps),
    handleUpdate(callbackUpdate('rconfirm', row.id), h.deps),
  ])

  assert.equal(first.status, 'confirmed')
  assert.equal(second.status, 'confirmed', 'a second confirm on an already-clean row is a harmless no-op, not a double-resolve')
  assert.equal((await h.store.getTransaction(row.id))?.needs_review, false)
  // Nothing else was ever flagged, so both sessions land on the empty queue.
  assert.equal(h.messenger.sent.filter((s) => s.text === 'All clear — nothing else flagged. ✓').length, 2)
})
