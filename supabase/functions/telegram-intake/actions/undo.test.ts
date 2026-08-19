// Taskiv #61: /undo's actual write. The propose/expire/allowlist plumbing
// is already covered generically in pending.test.ts — this file only tests
// what undoHandler.apply does once a tap has already been claimed.

import assert from 'node:assert/strict'
import test from 'node:test'

import { FakeMessenger, FakeStore, household } from '../fixtures/fakes.ts'
import { undoHandler } from './undo.ts'
import type { TransactionRow } from '../../_shared/types.ts'

function baseRow(overrides: Partial<TransactionRow> = {}): Partial<TransactionRow> {
  return {
    date: '2026-08-06',
    amount: 84,
    currency: 'AED',
    category: 'Dining Out',
    note: 'Noon',
    source: 'telegram',
    needs_review: false,
    telegram_chat_id: 999,
    telegram_msg_id: 1,
    ...overrides,
  }
}

test('apply soft-deletes the row (deleted_at set) and never hard-deletes it', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow(), 'key-1')
  const messenger = new FakeMessenger()

  const message = await undoHandler.apply({ transactionId: row.id }, { store, messenger })

  const after = await store.getTransaction(row.id)
  assert.ok(after?.deleted_at, 'deleted_at must be set')
  assert.equal(after?.id, row.id, 'the row itself still exists — soft delete, not DELETE')
  assert.equal(message, "Removed. It's gone from the app too.")
})

test('an open Confirm/Fix prompt on the removed row is edited to drop its keyboard', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow({ telegram_prompt_msg_id: 4242 }), 'key-2')
  const messenger = new FakeMessenger()

  await undoHandler.apply({ transactionId: row.id }, { store, messenger })

  const edit = messenger.sent.find((s) => s.method === 'editMessageText')
  assert.ok(edit, 'expected an editMessageText call')
  assert.equal(edit?.messageId, 4242)
  assert.match(edit?.text ?? '', /removed via \/undo/)
})

test('a row with no open prompt (telegram_prompt_msg_id null) is removed without any edit call', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow(), 'key-3')
  const messenger = new FakeMessenger()

  await undoHandler.apply({ transactionId: row.id }, { store, messenger })

  assert.equal(messenger.sent.find((s) => s.method === 'editMessageText'), undefined)
})

test('applying to an already-deleted row is a plain no-op, not a crash or a double-delete', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow(), 'key-4')
  await store.updateTransaction(row.id, { deleted_at: '2026-08-01T00:00:00Z' })
  const messenger = new FakeMessenger()

  const message = await undoHandler.apply({ transactionId: row.id }, { store, messenger })

  assert.match(message, /already gone/)
  assert.equal(messenger.sent.length, 0)
})

test('a nonexistent transaction id is handled the same honest way, never a thrown error', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()

  const message = await undoHandler.apply({ transactionId: 'does-not-exist' }, { store, messenger })

  assert.match(message, /already gone/)
})
