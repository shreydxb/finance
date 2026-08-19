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

test('a SQL string injected into a strictly-validated field never survives — it just fails to match and the whole plan is refused', async () => {
  const model = new FakeModel(
    json({ q: 'category_spend', category: "Bitcoin Wallet'; drop table transactions; --", period: { kind: 'this_month' } })
  )
  const plan = await planQuery('drop everything', CTX, model)
  assert.equal(plan, null, 'a category that does not match a real one is refused outright')
})

test('a SQL string in the free-text account field passes plan.ts (matchAccount, in run.ts, is what rejects it)', async () => {
  const model = new FakeModel(
    json({ q: 'account_spend', account: "Joint Current'; drop table transactions; --", period: { kind: 'this_month' } })
  )
  const plan = await planQuery('drop everything', CTX, model)
  // account_spend's account is free text at plan time by design (see types.ts)
  // — it is never used to build SQL here or in run.ts, only ever passed as a
  // parameterised filter value or matched in-memory by matchAccount.
  assert.equal(plan?.q === 'account_spend' ? plan.account : null, "Joint Current'; drop table transactions; --")
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

test('account_spend keeps the model\'s free-text guess as-is — resolution is run.ts\'s job (matchAccount)', async () => {
  const model = new FakeModel(json({ q: 'account_spend', account: 'the ENBD card', period: { kind: 'this_month' } }))
  const plan = await planQuery('spend on the ENBD card', CTX, model)
  assert.equal(plan?.q === 'account_spend' ? plan.account : null, 'the ENBD card')
})

test('an empty account string refuses the plan', async () => {
  const model = new FakeModel(json({ q: 'account_spend', account: '  ', period: { kind: 'this_month' } }))
  const plan = await planQuery('spend on nothing', CTX, model)
  assert.equal(plan, null)
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

test('budget_status with no category is the full-grid plan', async () => {
  const model = new FakeModel(json({ q: 'budget_status', category: null, period: { kind: 'this_month' } }))
  const plan = await planQuery('how is the budget looking', CTX, model)
  assert.deepEqual(plan, { q: 'budget_status', period: { kind: 'this_month' } })
})

test('budget_status with a real category matches it the same way category_spend does', async () => {
  const model = new FakeModel(json({ q: 'budget_status', category: 'groceries ', period: { kind: 'this_month' } }))
  const plan = await planQuery('are we over on groceries', CTX, model)
  assert.deepEqual(plan, { q: 'budget_status', category: 'Groceries', period: { kind: 'this_month' } })
})

test('budget_status with an unknown category refuses the plan, never inventing one', async () => {
  const model = new FakeModel(json({ q: 'budget_status', category: 'Pet Supplies', period: { kind: 'this_month' } }))
  const plan = await planQuery('are we over on pets', CTX, model)
  assert.equal(plan, null)
})

test('net_worth with no owner and no compare is a bare plan', async () => {
  const model = new FakeModel(json({ q: 'net_worth', owner: null, compare: null }))
  const plan = await planQuery("what's our net worth", CTX, model)
  assert.deepEqual(plan, { q: 'net_worth' })
})

test('net_worth with an owner carries it through', async () => {
  const model = new FakeModel(json({ q: 'net_worth', owner: 'Tarika', compare: null }))
  const plan = await planQuery("what's Tarika's net worth", CTX, model)
  assert.deepEqual(plan, { q: 'net_worth', owner: 'Tarika' })
})

test('net_worth with a compare period carries it through, structurally validated the same as period', async () => {
  const model = new FakeModel(json({ q: 'net_worth', compare: { kind: 'this_month' } }))
  const plan = await planQuery('how has our net worth changed this month', CTX, model)
  assert.deepEqual(plan, { q: 'net_worth', compare: { kind: 'this_month' } })
})

test('net_worth with a malformed compare refuses the plan, never silently dropping it', async () => {
  const model = new FakeModel(json({ q: 'net_worth', compare: { kind: 'explicit', from: 'not a date', to: '2026-08-17' } }))
  const plan = await planQuery('how has our net worth changed since not a date', CTX, model)
  assert.equal(plan, null)
})

test('goal_progress with no goal name is the all-goals plan', async () => {
  const model = new FakeModel(json({ q: 'goal_progress', goal: null }))
  const plan = await planQuery('how are the goals doing', CTX, model)
  assert.deepEqual(plan, { q: 'goal_progress' })
})

test('goal_progress with a goal name is carried through as free text, not matched at plan time', async () => {
  const model = new FakeModel(json({ q: 'goal_progress', goal: 'the emergency fund' }))
  const plan = await planQuery("how's the emergency fund", CTX, model)
  assert.deepEqual(plan, { q: 'goal_progress', goal: 'the emergency fund' })
})

test('upcoming_bills with no days is the default-window plan', async () => {
  const model = new FakeModel(json({ q: 'upcoming_bills', days: null }))
  const plan = await planQuery('what bills are coming up', CTX, model)
  assert.deepEqual(plan, { q: 'upcoming_bills' })
})

test('upcoming_bills with a days value carries it through untouched — clamping is bills.ts\'s job, not plan.ts\'s', async () => {
  const model = new FakeModel(json({ q: 'upcoming_bills', days: 30 }))
  const plan = await planQuery('what do we owe this month', CTX, model)
  assert.deepEqual(plan, { q: 'upcoming_bills', days: 30 })
})

test('portfolio_summary with no owner is the combined plan', async () => {
  const model = new FakeModel(json({ q: 'portfolio_summary', owner: null }))
  const plan = await planQuery("how's the portfolio doing", CTX, model)
  assert.deepEqual(plan, { q: 'portfolio_summary' })
})

test('portfolio_summary with an owner carries it through', async () => {
  const model = new FakeModel(json({ q: 'portfolio_summary', owner: 'Shrey' }))
  const plan = await planQuery("what's Shrey's portfolio worth", CTX, model)
  assert.deepEqual(plan, { q: 'portfolio_summary', owner: 'Shrey' })
})

test('needs_review_count has no parameters', async () => {
  const model = new FakeModel(json({ q: 'needs_review_count' }))
  const plan = await planQuery('anything need review', CTX, model)
  assert.deepEqual(plan, { q: 'needs_review_count' })
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
