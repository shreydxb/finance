import assert from 'node:assert/strict'
import test from 'node:test'

import { FakeModel } from '../fixtures/fakes.ts'
import { planQuery } from './plan.ts'
import type { PromptContext } from '../prompt.ts'

const CTX: PromptContext = {
  today: '2026-08-17',
  categories: ['Groceries', 'Dining Out', 'Transport & Fuel'],
  accounts: ['ENBD Credit Card 4412', 'Joint Current'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

function json(obj: unknown): string {
  return JSON.stringify(obj)
}

test('a valid category_spend plan round-trips', async () => {
  const model = new FakeModel(
    json({ q: 'category_spend', category: 'Groceries', merchant: null, account: null, owner: null, limit: null, period: { kind: 'this_month', n: null, from: null, to: null } })
  )
  const plan = await planQuery('how much on groceries this month', CTX, model)
  assert.deepEqual(plan, { q: 'category_spend', category: 'Groceries', period: { kind: 'this_month' } })
})

test('category matching reuses matchCategory\'s tolerance (case/whitespace)', async () => {
  const model = new FakeModel(json({ q: 'category_spend', category: 'groceries ', period: { kind: 'this_month' } }))
  const plan = await planQuery('groceries this month', CTX, model)
  assert.equal(plan?.q === 'category_spend' ? plan.category : null, 'Groceries')
})

test('an unknown category returns null, never a made-up category', async () => {
  const model = new FakeModel(json({ q: 'category_spend', category: 'Pet Supplies', period: { kind: 'this_month' } }))
  const plan = await planQuery('how much on pets', CTX, model)
  assert.equal(plan, null)
})

test('an out-of-enum q is refused, not passed through', async () => {
  const model = new FakeModel(json({ q: 'drop_table', period: { kind: 'this_month' } }))
  const plan = await planQuery('anything', CTX, model)
  assert.equal(plan, null)
})

test('a SQL string injected into a validated field never survives — it just fails to match and the whole plan is refused', async () => {
  const model = new FakeModel(
    json({ q: 'account_spend', account: "Joint Current'; drop table transactions; --", period: { kind: 'this_month' } })
  )
  const plan = await planQuery('drop everything', CTX, model)
  assert.equal(plan, null, 'an account name that does not exactly match a real account is refused outright')
})

test('total_spend needs no category/account/merchant and defaults owner to household-wide', async () => {
  const model = new FakeModel(json({ q: 'total_spend', period: { kind: 'last_month' } }))
  const plan = await planQuery('how much did I spend in total last month', CTX, model)
  assert.deepEqual(plan, { q: 'total_spend', period: { kind: 'last_month' } })
})

test('an owner is included when it matches a real person, case-insensitively', async () => {
  const model = new FakeModel(json({ q: 'total_spend', owner: 'shrey', period: { kind: 'this_month' } }))
  const plan = await planQuery('how much has Shrey spent', CTX, model)
  assert.equal(plan?.q === 'total_spend' ? plan.owner : undefined, 'Shrey')
})

test('an owner that is not a real person refuses the whole plan', async () => {
  const model = new FakeModel(json({ q: 'total_spend', owner: 'Stranger', period: { kind: 'this_month' } }))
  const plan = await planQuery('how much has Stranger spent', CTX, model)
  assert.equal(plan, null)
})

test('merchant_spend keeps free-text merchant names — merchants are not a closed list', async () => {
  const model = new FakeModel(json({ q: 'merchant_spend', merchant: 'Karak House', period: { kind: 'this_week' } }))
  const plan = await planQuery('how much at Karak House this week', CTX, model)
  assert.deepEqual(plan, { q: 'merchant_spend', merchant: 'Karak House', period: { kind: 'this_week' } })
})

test('an empty merchant string refuses the plan', async () => {
  const model = new FakeModel(json({ q: 'merchant_spend', merchant: '  ', period: { kind: 'this_week' } }))
  const plan = await planQuery('how much there', CTX, model)
  assert.equal(plan, null)
})

test('account_spend matches an account exactly (case-insensitive), never invents one', async () => {
  const model = new FakeModel(json({ q: 'account_spend', account: 'enbd credit card 4412', period: { kind: 'this_month' } }))
  const plan = await planQuery('spend on the ENBD card', CTX, model)
  assert.equal(plan?.q === 'account_spend' ? plan.account : null, 'ENBD Credit Card 4412')
})

test('recent_transactions defaults limit to 10 when the model omits it', async () => {
  const model = new FakeModel(json({ q: 'recent_transactions', limit: null }))
  const plan = await planQuery('what did I spend today', CTX, model)
  assert.deepEqual(plan, { q: 'recent_transactions', limit: 10 })
})

test('recent_transactions clamps an oversized limit to 20', async () => {
  const model = new FakeModel(json({ q: 'recent_transactions', limit: 500 }))
  const plan = await planQuery('show me everything', CTX, model)
  assert.deepEqual(plan, { q: 'recent_transactions', limit: 20 })
})

test('recent_transactions clamps a zero/negative limit up to 1', async () => {
  const model = new FakeModel(json({ q: 'recent_transactions', limit: 0 }))
  const plan = await planQuery('show me nothing?', CTX, model)
  assert.deepEqual(plan, { q: 'recent_transactions', limit: 1 })
})

test('a missing period defaults to this_month rather than refusing the whole plan', async () => {
  const model = new FakeModel(json({ q: 'total_spend' }))
  const plan = await planQuery('how much have I spent', CTX, model)
  assert.deepEqual(plan, { q: 'total_spend', period: { kind: 'this_month' } })
})

test('an out-of-enum period kind refuses the plan', async () => {
  const model = new FakeModel(json({ q: 'total_spend', period: { kind: 'next_month' } }))
  const plan = await planQuery('how much will I spend next month', CTX, model)
  assert.equal(plan, null)
})

test('last_n_days without a usable n refuses the plan', async () => {
  const model = new FakeModel(json({ q: 'total_spend', period: { kind: 'last_n_days', n: 'a lot' } }))
  const plan = await planQuery('spend recently', CTX, model)
  assert.equal(plan, null)
})

test('explicit period with a malformed date refuses the plan (structural check, before resolvePeriod ever runs)', async () => {
  const model = new FakeModel(json({ q: 'total_spend', period: { kind: 'explicit', from: '17 Aug', to: '2026-08-17' } }))
  const plan = await planQuery('spend between 17 Aug and today', CTX, model)
  assert.equal(plan, null)
})

test('a non-JSON model response is an honest refusal, not a crash', async () => {
  const model = new FakeModel('Sure! Let me help with that.')
  const plan = await planQuery('anything', CTX, model)
  assert.equal(plan, null)
})

test('a model/network failure is an honest refusal, not a thrown error', async () => {
  const model = new FakeModel('THROW:OpenRouter 500: server error')
  const plan = await planQuery('anything', CTX, model)
  assert.equal(plan, null)
})
