// Taskiv #59: the honest-refusal path. Every case here is one of the five
// the task names — null plan (unsupported), planner throw, store throw,
// advice question, unknown category — proven through answerQuestion itself
// rather than through intake.ts's full Telegram harness, since none of this
// logic touches Telegram at all.

import assert from 'node:assert/strict'
import test from 'node:test'

import { FakeModel, FakeQueryStore } from '../fixtures/fakes.ts'
import {
  ADVICE_REFUSAL_TEXT,
  PLANNER_FAILED_TEXT,
  UNSUPPORTED_REFUSAL_TEXT,
  answerQuestion,
  formatUnknownCategoryRefusal,
  looksLikeAdvice,
} from './refusal.ts'
import type { QueryStore, RecentTransaction, SpendResult, TotalSpendResult } from './types.ts'
import type { PromptContext } from '../prompt.ts'
import type { AccountRef } from '../../_shared/types.ts'

const CTX: PromptContext = {
  today: '2026-08-18',
  categories: ['Groceries', 'Dining Out', 'Transport & Fuel'],
  accounts: ['ENBD Credit Card 4412', 'Joint Current'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

const ACCOUNTS: AccountRef[] = [{ id: 'acc-1', name: 'Joint Current', type: 'cash', owner: null }]

const NOW = () => new Date('2026-08-18T09:00:00Z')

function json(obj: unknown): string {
  return JSON.stringify(obj)
}

// ── looksLikeAdvice ──────────────────────────────────────────────────────

test('advice-shaped phrasing is recognised', () => {
  const examples = [
    'should we buy a new car',
    'should I switch banks',
    'can we afford a holiday this year',
    'is it a good idea to pay off the car loan early',
    'is it worth buying the extended warranty',
    'what should we do with the bonus',
    'can you recommend a savings account',
  ]
  for (const text of examples) {
    assert.equal(looksLikeAdvice(text), true, `expected advice: "${text}"`)
  }
})

test('an ordinary data question is not read as advice', () => {
  assert.equal(looksLikeAdvice('how much did we spend on groceries this month'), false)
  assert.equal(looksLikeAdvice('what did Tarika spend last week'), false)
})

// ── answerQuestion: advice question ─────────────────────────────────────

test('an advice-shaped question is refused without ever calling the model', async () => {
  const model = new FakeModel('THROW:should never be called')
  const result = await answerQuestion('should we buy a new car', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.equal(result.text, ADVICE_REFUSAL_TEXT)
  assert.equal(result.success, false)
  assert.equal(model.calls.length, 0)
})

// ── answerQuestion: planner throw ───────────────────────────────────────

test('a planner call failure gets the "try rephrasing" wording, not the generic refusal', async () => {
  const model = new FakeModel('THROW:OpenRouter 500: server error')
  const result = await answerQuestion('how much on Pet Supplies this month', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.equal(result.text, PLANNER_FAILED_TEXT)
  assert.equal(result.success, false)
  assert.equal(result.refusalReason, 'planner call failed')
})

test('malformed JSON from the model is treated the same as a call failure', async () => {
  const model = new FakeModel('not json at all')
  const result = await answerQuestion('anything', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.equal(result.text, PLANNER_FAILED_TEXT)
  assert.equal(result.success, false)
})

// ── answerQuestion: null plan / outside the enum ────────────────────────

test('an out-of-enum question gets the generic honest refusal, not silence', async () => {
  const model = new FakeModel(json({ q: 'average_weekend_spend', period: { kind: 'this_month' } }))
  const result = await answerQuestion('what is my average weekend spend', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.equal(result.text, UNSUPPORTED_REFUSAL_TEXT)
  assert.equal(result.success, false)
  assert.equal(result.refusalReason, 'outside the query enum')
})

// ── answerQuestion: unknown category ────────────────────────────────────

test('formatUnknownCategoryRefusal names the real categories', () => {
  const text = formatUnknownCategoryRefusal('Pet Supplies', CTX.categories)
  assert.match(text, /Pet Supplies/)
  assert.match(text, /Groceries/)
  assert.match(text, /Dining Out/)
  assert.match(text, /Transport & Fuel/)
})

test('a named-but-unmatched category lists the real ones instead of the generic refusal', async () => {
  const model = new FakeModel(json({ q: 'category_spend', category: 'Pet Supplies', period: { kind: 'this_month' } }))
  const result = await answerQuestion('how much on pet supplies this month', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.match(result.text, /Pet Supplies/)
  assert.match(result.text, /Groceries/)
  assert.equal(result.success, false)
  assert.equal(result.refusalReason, 'unknown category: Pet Supplies')
})

// ── answerQuestion: store throw ──────────────────────────────────────────

class ThrowingQueryStore implements QueryStore {
  categorySpend(): Promise<SpendResult> {
    return Promise.reject(new Error('Supabase GET v_transactions_aed failed (503): upstream timeout'))
  }
  totalSpend(): Promise<TotalSpendResult> {
    return Promise.reject(new Error('unused'))
  }
  merchantSpend(): Promise<SpendResult> {
    return Promise.reject(new Error('unused'))
  }
  accountSpend(): Promise<SpendResult> {
    return Promise.reject(new Error('unused'))
  }
  recentTransactions(): Promise<RecentTransaction[]> {
    return Promise.reject(new Error('unused'))
  }
}

test('a store failure surfaces the real error, the same way the receipt pipeline does', async () => {
  const model = new FakeModel(json({ q: 'category_spend', category: 'Groceries', period: { kind: 'this_month' } }))
  const result = await answerQuestion('how much on groceries this month', CTX, model, new ThrowingQueryStore(), ACCOUNTS, NOW)
  assert.match(result.text, /upstream timeout/)
  assert.equal(result.success, false)
  assert.match(result.refusalReason ?? '', /upstream timeout/)
})

// ── answerQuestion: the success path still works ─────────────────────────

test('a well-formed, resolvable question still gets a real answer', async () => {
  const model = new FakeModel(json({ q: 'total_spend', period: { kind: 'this_month' } }))
  const result = await answerQuestion('how much have we spent this month', CTX, model, new FakeQueryStore(), ACCOUNTS, NOW)
  assert.equal(result.success, true)
  assert.equal(result.refusalReason, undefined)
})
