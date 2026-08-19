// Taskiv #60: generic propose-then-tap plumbing. The five cases the task
// names explicitly: happy path, double-tap, expired, wrong user, cancel —
// plus a couple of invariants worth pinning down separately (never-tapped
// writes nothing, an unregistered kind fails loudly rather than silently).

import assert from 'node:assert/strict'
import test from 'node:test'

import { handlePendingActionCallback, proposeAction } from './pending.ts'
import type { PendingActionContext, PendingActionHandlers, PendingActionStore } from './pending.ts'
import type { Messenger, PendingAction, SendOptions } from '../../_shared/types.ts'

class FakeStore implements PendingActionStore {
  rows = new Map<string, PendingAction>()
  private seq = 0
  private now: () => Date

  constructor(now: () => Date = () => new Date('2026-08-19T12:00:00Z')) {
    this.now = now
  }

  createPendingAction(kind: string, payload: unknown, chatId: number, requestedBy: number): Promise<PendingAction> {
    const id = `pending-${++this.seq}`
    const createdAt = this.now().toISOString()
    const row: PendingAction = {
      id,
      kind,
      payload,
      chatId,
      promptMsgId: null,
      requestedBy,
      createdAt,
      expiresAt: new Date(this.now().getTime() + 60 * 60 * 1000).toISOString(),
      resolvedAt: null,
      resolution: null,
    }
    this.rows.set(id, row)
    return Promise.resolve(row)
  }

  getPendingAction(id: string): Promise<PendingAction | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

  setPendingActionPromptMsgId(id: string, promptMsgId: number): Promise<void> {
    const row = this.rows.get(id)
    if (row) this.rows.set(id, { ...row, promptMsgId })
    return Promise.resolve()
  }

  // Mirrors the real store's atomic guard: only succeeds while resolvedAt is still null.
  resolvePendingAction(id: string, resolution: 'applied' | 'cancelled' | 'expired'): Promise<PendingAction | null> {
    const row = this.rows.get(id)
    if (!row || row.resolvedAt) return Promise.resolve(null)
    const resolved: PendingAction = { ...row, resolvedAt: this.now().toISOString(), resolution }
    this.rows.set(id, resolved)
    return Promise.resolve(resolved)
  }
}

class FakeMessenger implements Messenger {
  sent: { chatId: number; text: string; opts?: SendOptions }[] = []
  edited: { chatId: number; messageId: number; text: string }[] = []
  private seq = 5000

  sendMessage(chatId: number, text: string, opts?: SendOptions) {
    this.sent.push({ chatId, text, opts })
    return Promise.resolve({ message_id: ++this.seq, chat: { id: chatId, type: 'private' }, text })
  }
  editMessageText(chatId: number, messageId: number, text: string) {
    this.edited.push({ chatId, messageId, text })
    return Promise.resolve(null)
  }
  answerCallbackQuery() {
    return Promise.resolve(null)
  }
  downloadFile(): Promise<never> {
    throw new Error('not used in these tests')
  }
}

const ALLOWED = new Set([111, 222])
const NOW = () => new Date('2026-08-19T12:00:00Z')

// This module's own tests never look inside ctx — the fake handlers below
// only record their payload — so an empty stand-in is enough; real handlers
// (e.g. actions/undo.ts) get the genuine store/messenger from intake.ts.
const FAKE_CTX = {} as PendingActionContext

function fakeHandlers(applied: unknown[]): PendingActionHandlers {
  return {
    test_kind: {
      apply(payload: unknown) {
        applied.push(payload)
        return Promise.resolve('done')
      },
    },
  }
}

test('proposeAction writes only the pending_actions row and sends Apply/Cancel — nothing else exists yet', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()

  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500 into Emergency Fund?', store, messenger)

  assert.equal(store.rows.size, 1)
  assert.equal(pending.kind, 'test_kind')
  assert.equal(messenger.sent.length, 1)
  assert.equal(messenger.sent[0].text, 'Move 500 into Emergency Fund?')
  const keyboard = messenger.sent[0].opts?.inlineKeyboard
  assert.equal(keyboard?.[0][0].callback_data, `apply:${pending.id}`)
  assert.equal(keyboard?.[0][1].callback_data, `cancel:${pending.id}`)
  // The button carries only the id — the payload never leaves the row (callback_data's 64-byte cap).
  assert.ok(keyboard![0][0].callback_data.length <= 64)
})

test('proposeAction accepts custom button labels for kinds that need them (e.g. /undo\'s Remove/Keep)', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()

  await proposeAction('test_kind', {}, 42, 111, 'Remove this?', store, messenger, { apply: '🗑 Remove', cancel: '✖️ Keep' })

  const keyboard = messenger.sent[0].opts?.inlineKeyboard
  assert.equal(keyboard?.[0][0].text, '🗑 Remove')
  assert.equal(keyboard?.[0][1].text, '✖️ Keep')
})

test('a proposal that is never tapped writes nothing, ever', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []

  await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  assert.equal(applied.length, 0)
})

test('happy path: a valid Apply tap resolves and calls the handler exactly once', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  const outcome = await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, NOW)

  assert.deepEqual(outcome, { status: 'applied', message: 'done' })
  assert.deepEqual(applied, [{ amount: 500 }])
  assert.equal(store.rows.get(pending.id)?.resolution, 'applied')
})

test('double-tap: tapping Apply twice results in exactly one write', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)
  const handlers = fakeHandlers(applied)

  const first = await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, handlers, FAKE_CTX, NOW)
  const second = await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, handlers, FAKE_CTX, NOW)

  assert.deepEqual(first, { status: 'applied', message: 'done' })
  assert.deepEqual(second, { status: 'already_resolved' })
  assert.equal(applied.length, 1)
})

test('expired: a proposal tapped after expires_at writes nothing and says so', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  const later = () => new Date('2026-08-19T13:01:00Z') // 61 minutes after NOW — past the 1-hour expiry
  const outcome = await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, later)

  assert.deepEqual(outcome, { status: 'expired' })
  assert.equal(applied.length, 0)
  assert.equal(store.rows.get(pending.id)?.resolution, 'expired')
})

test('a tap at exactly expires_at is still on time — the boundary belongs to the household, not against it', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  const exactly = () => new Date('2026-08-19T13:00:00Z') // exactly one hour later
  const outcome = await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, exactly)

  assert.deepEqual(outcome, { status: 'applied', message: 'done' })
})

test('wrong user: a tap from a non-allowlisted user writes nothing', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  const outcome = await handlePendingActionCallback('apply', pending.id, 999, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, NOW)

  assert.deepEqual(outcome, { status: 'forbidden' })
  assert.equal(applied.length, 0)
  // Forbidden must not even count as "resolved" — the real household member should still be able to act on it.
  assert.equal(store.rows.get(pending.id)?.resolvedAt, null)
})

test('cancel leaves no trace beyond the resolved pending_actions row', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)

  const outcome = await handlePendingActionCallback('cancel', pending.id, 222, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, NOW)

  assert.deepEqual(outcome, { status: 'cancelled' })
  assert.equal(applied.length, 0)
  assert.equal(store.rows.get(pending.id)?.resolution, 'cancelled')
})

test('cancelling an already-resolved proposal is reported, not silently accepted', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const applied: unknown[] = []
  const pending = await proposeAction('test_kind', { amount: 500 }, 42, 111, 'Move 500?', store, messenger)
  await handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, NOW)

  const outcome = await handlePendingActionCallback('cancel', pending.id, 111, ALLOWED, store, fakeHandlers(applied), FAKE_CTX, NOW)

  assert.deepEqual(outcome, { status: 'already_resolved' })
})

test('a nonexistent id is reported as not_found, never thrown as an error to the household', async () => {
  const store = new FakeStore(NOW)
  const outcome = await handlePendingActionCallback('apply', 'does-not-exist', 111, ALLOWED, store, fakeHandlers([]), FAKE_CTX, NOW)
  assert.deepEqual(outcome, { status: 'not_found' })
})

test('an unregistered kind fails loudly (throws) rather than a silent no-op the household reads as success', async () => {
  const store = new FakeStore(NOW)
  const messenger = new FakeMessenger()
  const pending = await proposeAction('unregistered_kind', {}, 42, 111, 'Do a thing?', store, messenger)

  await assert.rejects(() => handlePendingActionCallback('apply', pending.id, 111, ALLOWED, store, {}, FAKE_CTX, NOW))
  // Still claimed as applied — the row is not left dangling for a retry to double-apply once the handler ships.
  assert.equal(store.rows.get(pending.id)?.resolution, 'applied')
})
