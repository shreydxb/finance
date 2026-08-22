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

test('undo soft-deletes the row and retains it for audit', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow(), 'key-1')
  const messenger = new FakeMessenger()

  const message = await undoHandler.apply({ transactionId: row.id }, { store, messenger })

  const after = await store.getTransaction(row.id)
  assert.ok(after?.deleted_at)
  assert.equal(after?.id, row.id)
  assert.equal(message, "Removed. It's gone from the app too.")
})

test('undo drops an old Confirm/Fix keyboard and is idempotent for an already-gone row', async () => {
  const store = new FakeStore(household())
  const row = await store.insertTransactionOnce(baseRow({ telegram_prompt_msg_id: 4242 }), 'key-2')
  const messenger = new FakeMessenger()

  await undoHandler.apply({ transactionId: row.id }, { store, messenger })
  assert.equal(messenger.sent.find((sent) => sent.method === 'editMessageText')?.messageId, 4242)

  const replayMessage = await undoHandler.apply({ transactionId: row.id }, { store, messenger })
  assert.match(replayMessage, /already gone/)
})

test('undo handles a nonexistent transaction without hard failure', async () => {
  const store = new FakeStore(household())
  const messenger = new FakeMessenger()
  assert.match(await undoHandler.apply({ transactionId: 'missing' }, { store, messenger }), /already gone/)
})
