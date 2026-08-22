import assert from 'node:assert/strict'
import test from 'node:test'

import { FakeMessenger, FakeStore, household } from '../fixtures/fakes.ts'
import { CHAT_ID, SHREY_ID, TARIKA_ID } from '../fixtures/updates.ts'
import { handlePendingActionCallback, proposeAction } from './pending.ts'
import type { PendingActionHandlers } from './pending.ts'

const ALLOWED = new Set([SHREY_ID, TARIKA_ID])

async function proposal(store: FakeStore, messenger: FakeMessenger, requestKey = 'telegram:chat:message:undo') {
  return proposeAction(
    'test_kind',
    { amount: 500 },
    CHAT_ID,
    SHREY_ID,
    requestKey,
    'Move 500?',
    store,
    messenger
  )
}

function handlers(applied: unknown[]): PendingActionHandlers {
  return {
    test_kind: {
      apply(payload: unknown) {
        applied.push(payload)
        return Promise.resolve('done')
      },
    },
  }
}

test('proposal creation is request-key idempotent and prompt identity binds once', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()

  const first = await proposal(store, messenger)
  const replay = await proposal(store, messenger)

  assert.equal(first.id, replay.id)
  assert.equal(first.promptMsgId, replay.promptMsgId)
  assert.equal(store.pendingActions.size, 1)
  assert.equal(messenger.texts().length, 1, 'a sequential Telegram replay must not send another actionable prompt')

  const rebound = await store.bindPendingActionPrompt(first.id, SHREY_ID, CHAT_ID, (first.promptMsgId ?? 0) + 1)
  assert.equal(rebound, null, 'prompt identity can never be overwritten')
})

test('Apply claims once, runs the handler once, then records applied', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  const pending = await proposal(store, messenger)
  const applied: unknown[] = []

  const results = await Promise.all([
    handlePendingActionCallback(
      'apply', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, handlers(applied), { store, messenger }
    ),
    handlePendingActionCallback(
      'apply', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, handlers(applied), { store, messenger }
    ),
  ])

  assert.equal(results.filter((result) => result.status === 'applied').length, 1)
  assert.equal(results.filter((result) => result.status === 'already_resolved').length, 1)
  assert.deepEqual(applied, [{ amount: 500 }])
  assert.equal(store.pendingActions.get(pending.id)?.resolution, 'applied')
})

test('another allowlisted user, another chat, and another prompt cannot act', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  const pending = await proposal(store, messenger)
  const applied: unknown[] = []

  for (const [userId, chatId, promptId] of [
    [TARIKA_ID, CHAT_ID, pending.promptMsgId!],
    [SHREY_ID, CHAT_ID - 1, pending.promptMsgId!],
    [SHREY_ID, CHAT_ID, pending.promptMsgId! + 1],
  ] as const) {
    const outcome = await handlePendingActionCallback(
      'apply', pending.id, userId, chatId, promptId, ALLOWED, store, handlers(applied), { store, messenger }
    )
    assert.deepEqual(outcome, { status: 'forbidden' })
  }

  assert.equal(applied.length, 0)
  assert.equal(store.pendingActions.get(pending.id)?.claimedAt, null)
})

test('database-time expiry uses [created_at, expires_at): exact deadline is expired', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  const pending = await proposal(store, messenger)
  store.pendingNow = () => new Date(pending.expiresAt)
  const applied: unknown[] = []

  const outcome = await handlePendingActionCallback(
    'apply', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, handlers(applied), { store, messenger }
  )

  assert.deepEqual(outcome, { status: 'expired' })
  assert.equal(applied.length, 0)
  assert.equal(store.pendingActions.get(pending.id)?.resolution, 'expired')
})

test('only the requester can cancel an open unexpired action', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  const pending = await proposal(store, messenger)

  const forbidden = await handlePendingActionCallback(
    'cancel', pending.id, TARIKA_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, {}, { store, messenger }
  )
  const cancelled = await handlePendingActionCallback(
    'cancel', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, {}, { store, messenger }
  )

  assert.deepEqual(forbidden, { status: 'forbidden' })
  assert.deepEqual(cancelled, { status: 'cancelled' })
  assert.equal(store.pendingActions.get(pending.id)?.resolution, 'cancelled')
})

test('a missing or throwing handler leaves a claimed unresolved audit row and cannot replay', async () => {
  for (const [label, currentHandlers] of [
    ['missing', {}],
    ['throwing', { test_kind: { apply: () => Promise.reject(new Error('write outcome unknown')) } }],
  ] satisfies [string, PendingActionHandlers][]) {
    const store = new FakeStore(household())
    const messenger = new FakeMessenger()
    const pending = await proposal(store, messenger, `request-${label}`)

    await assert.rejects(() =>
      handlePendingActionCallback(
        'apply', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, currentHandlers, { store, messenger }
      )
    )

    const row = store.pendingActions.get(pending.id)!
    assert.ok(row.claimedAt)
    assert.equal(row.resolvedAt, null)
    assert.equal(row.resolution, null)

    const replay = await handlePendingActionCallback(
      'apply', pending.id, SHREY_ID, CHAT_ID, pending.promptMsgId!, ALLOWED, store, currentHandlers, { store, messenger }
    )
    assert.deepEqual(replay, { status: 'already_resolved' })
  }
})

test('a request key cannot be reused for a different immutable proposal', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  await proposal(store, messenger, 'same-key')

  await assert.rejects(() =>
    proposeAction('test_kind', { amount: 999 }, CHAT_ID, SHREY_ID, 'same-key', 'Different', store, messenger)
  )
})
