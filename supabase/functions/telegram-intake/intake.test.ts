import assert from 'node:assert/strict'
import test from 'node:test'

import { ACCOUNTS, FakeMessenger, FakeModel, FakeStore, FakeTranscriber, household } from './fixtures/fakes.ts'
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
  transcriber: FakeTranscriber
}

function harness(
  responses: string | string[] = CLEAN,
  opts: { transcript?: string; withTranscriber?: boolean; defaultAccountId?: string | null } = {}
): Harness {
  const store = new FakeStore(household({ defaultAccountId: opts.defaultAccountId ?? null }))
  const messenger = new FakeMessenger()
  const model = new FakeModel(responses)
  const transcriber = new FakeTranscriber(opts.transcript ?? 'spent 84 dirhams at karak house')
  return {
    store,
    messenger,
    model,
    transcriber,
    deps: {
      store,
      messenger,
      model,
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
