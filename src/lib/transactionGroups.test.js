// DATA-01: display entries must branch on what a group actually is.
//
// Before this, every non-null group id was rendered as a category split,
// because that was the column's only meaning when the code was written. The
// three cases below are the ones that were being conflated.

import assert from 'node:assert/strict'
import test from 'node:test'

import { entryKey, groupEntries } from './transactionGroups.js'

const row = (over) => ({
  id: 'x',
  date: '2026-08-10',
  amount: 100,
  currency: 'AED',
  account_id: 'acc-1',
  owner: 'Shrey',
  category: 'Groceries',
  note: null,
  transaction_group_id: null,
  group_kind: null,
  transfer_direction: null,
  ...over,
})

test('an ungrouped transaction is a single entry', () => {
  const entries = groupEntries([row({ id: 'a' })])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'single')
  assert.equal(entryKey(entries[0]), 'a')
})

// ── category split ───────────────────────────────────────────────────────────

test('a category split collapses into one entry holding its lines', () => {
  const entries = groupEntries([
    row({ id: 'a', amount: 60, category: 'Groceries', transaction_group_id: 'g1', group_kind: 'category_split' }),
    row({ id: 'b', amount: 40, category: 'Household', transaction_group_id: 'g1', group_kind: 'category_split' }),
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'split')
  assert.equal(entries[0].lines.length, 2)
  assert.equal(entryKey(entries[0]), 'g1')
})

// ── transfer ─────────────────────────────────────────────────────────────────

test('a transfer is its own kind, not a split', () => {
  // The regression: two positive rows rendered as a "split" whose total was
  // the sum — double the money that actually moved.
  const entries = groupEntries([
    row({ id: 'out', amount: 500, category: 'Transfer', account_id: 'acc-wio', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'out' }),
    row({ id: 'in', amount: 500, category: 'Transfer', account_id: 'acc-joint', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'in' }),
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'transfer')
  assert.notEqual(entries[0].kind, 'split')
})

test('a transfer exposes its two sides so direction can be shown', () => {
  const entries = groupEntries([
    row({ id: 'in', amount: 500, account_id: 'acc-joint', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'in' }),
    row({ id: 'out', amount: 500, account_id: 'acc-wio', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'out' }),
  ])

  // Order in the input must not decide which side is which.
  assert.equal(entries[0].out.id, 'out')
  assert.equal(entries[0].into.id, 'in')
  assert.equal(entries[0].out.account_id, 'acc-wio')
  assert.equal(entries[0].into.account_id, 'acc-joint')
})

// ── bulk batch ───────────────────────────────────────────────────────────────

test('a bulk batch stays as independent rows', () => {
  // These arrived in one Telegram message but are unrelated spends. Merging
  // them showed one row carrying only the first line's date, account and note.
  const entries = groupEntries([
    row({ id: 'a', amount: 40, date: '2026-08-01', account_id: 'acc-1', note: 'coffee', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
    row({ id: 'b', amount: 90, date: '2026-08-03', account_id: 'acc-2', note: 'taxi', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
    row({ id: 'c', amount: 12, date: '2026-08-04', account_id: 'acc-2', note: 'snack', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
  ])

  assert.equal(entries.length, 3, 'three spends, three rows')
  assert.ok(entries.every((e) => e.kind === 'single'))
  assert.deepEqual(entries.map((e) => e.transaction.note), ['coffee', 'taxi', 'snack'])
})

test('each bulk row keeps its own identity as its key', () => {
  const entries = groupEntries([
    row({ id: 'a', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
    row({ id: 'b', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
  ])
  // Sharing the group id as a key would make selecting one select both.
  assert.deepEqual(entries.map(entryKey), ['a', 'b'])
})

// ── safety ───────────────────────────────────────────────────────────────────

test('an unknown group_kind falls back to independent rows', () => {
  // The safe direction: show each row as it really is rather than merging rows
  // that may not belong together.
  const entries = groupEntries([
    row({ id: 'a', transaction_group_id: 'g4', group_kind: 'something_new' }),
    row({ id: 'b', transaction_group_id: 'g4', group_kind: 'something_new' }),
  ])
  assert.equal(entries.length, 2)
  assert.ok(entries.every((e) => e.kind === 'single'))
})

test('a group id with no kind is not treated as a split', () => {
  // The exact ambiguity DATA-01 removes. A legacy row carrying only an id must
  // not be guessed at.
  const entries = groupEntries([
    row({ id: 'a', transaction_group_id: 'g5', group_kind: null }),
    row({ id: 'b', transaction_group_id: 'g5', group_kind: null }),
  ])
  assert.equal(entries.length, 2)
  assert.ok(entries.every((e) => e.kind === 'single'))
})

test('the three kinds coexist in one list without interfering', () => {
  const entries = groupEntries([
    row({ id: 's1', transaction_group_id: 'g1', group_kind: 'category_split' }),
    row({ id: 's2', transaction_group_id: 'g1', group_kind: 'category_split' }),
    row({ id: 't1', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'out' }),
    row({ id: 't2', transaction_group_id: 'g2', group_kind: 'transfer', transfer_direction: 'in' }),
    row({ id: 'b1', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
    row({ id: 'b2', transaction_group_id: 'g3', group_kind: 'bulk_batch' }),
    row({ id: 'plain' }),
  ])

  assert.deepEqual(entries.map((e) => e.kind), ['split', 'transfer', 'single', 'single', 'single'])
  assert.deepEqual(entries.map(entryKey), ['g1', 'g2', 'b1', 'b2', 'plain'])
})
