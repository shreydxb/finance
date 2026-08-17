import assert from 'node:assert/strict'
import test from 'node:test'

import { FakeModel } from './fixtures/fakes.ts'
import { classifyIntent, looksLikeQuestion, routeMessage } from './route.ts'

function json(obj: unknown): string {
  return JSON.stringify(obj)
}

// ── looksLikeQuestion ────────────────────────────────────────────────────

test('every listed question-starting prefix is recognised, case-insensitively', () => {
  const examples = [
    'How much did we spend on groceries',
    'how many transactions this week',
    "What's my net worth",
    'what is left in the budget',
    'What are our goals',
    'whats the balance on Wio',
    'When is rent due',
    "when's the next bill",
    'when do we get paid',
    'where are we on the car fund',
    'How are we doing on budget',
    "how's the emergency fund",
    'Show me recent transactions',
    'list my accounts',
    'tell me about groceries',
    'did we spend on dining out',
    'did I pay rent yet',
    'am I over budget',
    'are we on track',
    'can you tell me the total',
  ]
  for (const text of examples) {
    assert.equal(looksLikeQuestion(text), true, `expected a question: "${text}"`)
  }
})

test('a bare "?" ending is recognised even without a listed prefix', () => {
  assert.equal(looksLikeQuestion('are we broke?'), true)
})

test('an ordinary spend message is not a question', () => {
  assert.equal(looksLikeQuestion('84 lunch at Noon'), false)
  assert.equal(looksLikeQuestion('paid rent 3000'), false)
})

test('empty or whitespace-only text is not a question', () => {
  assert.equal(looksLikeQuestion(''), false)
  assert.equal(looksLikeQuestion('   '), false)
})

test('an amount plus a merchant-ish capitalised word falls through to the classifier (ambiguous)', () => {
  assert.equal(looksLikeQuestion('how much was that Carrefour trip, 240?'), false)
})

test('a question with an amount but no merchant-ish capitalised word still matches', () => {
  assert.equal(looksLikeQuestion('how much is 45 in AED?'), true)
})

test('a question with a capitalised word but no amount still matches', () => {
  assert.equal(looksLikeQuestion("what's Carrefour's opening time?"), true)
})

// ── classifyIntent ───────────────────────────────────────────────────────

test('a well-formed classifier response parses cleanly', async () => {
  const model = new FakeModel(json({ intent: 'spend', confidence: 0.95 }))
  const result = await classifyIntent('84 lunch', model)
  assert.deepEqual(result, { intent: 'spend', confidence: 0.95 })
})

test('a fenced/prose-wrapped response is tolerated, same as extract.ts', async () => {
  const model = new FakeModel('Sure, here you go:\n```json\n{"intent":"chatter","confidence":0.9}\n```')
  const result = await classifyIntent('thanks!', model)
  assert.deepEqual(result, { intent: 'chatter', confidence: 0.9 })
})

test('malformed JSON returns null, not a thrown error', async () => {
  const model = new FakeModel('not json at all')
  const result = await classifyIntent('hmm', model)
  assert.equal(result, null)
})

test('an out-of-enum intent returns null', async () => {
  const model = new FakeModel(json({ intent: 'drop_table', confidence: 0.9 }))
  const result = await classifyIntent('anything', model)
  assert.equal(result, null)
})

test('a non-numeric confidence returns null', async () => {
  const model = new FakeModel(json({ intent: 'spend', confidence: 'very' }))
  const result = await classifyIntent('anything', model)
  assert.equal(result, null)
})

test('a thrown model call returns null, not a thrown error', async () => {
  const model = new FakeModel('THROW:OpenRouter 500: server error')
  const result = await classifyIntent('anything', model)
  assert.equal(result, null)
})

// ── routeMessage ─────────────────────────────────────────────────────────

test('the regex fast path short-circuits before ever calling the model', async () => {
  const model = new FakeModel('THROW:should never be called')
  const intent = await routeMessage('how much did we spend on groceries', model)
  assert.equal(intent, 'question')
  assert.equal(model.calls.length, 0)
})

test('the classifier is used when the regex fast path does not fire', async () => {
  const model = new FakeModel(json({ intent: 'chatter', confidence: 0.95 }))
  const intent = await routeMessage('lol nice', model)
  assert.equal(intent, 'chatter')
  assert.equal(model.calls.length, 1)
})

test('classifier confidence below the floor falls back to spend', async () => {
  const model = new FakeModel(json({ intent: 'chatter', confidence: 0.4 }))
  const intent = await routeMessage('hmm not sure what this is', model)
  assert.equal(intent, 'spend')
})

test('a classifier failure (malformed JSON) falls back to spend', async () => {
  const model = new FakeModel('garbage response')
  const intent = await routeMessage('some ambiguous text', model)
  assert.equal(intent, 'spend')
})

test('a classifier throw falls back to spend', async () => {
  const model = new FakeModel('THROW:network error')
  const intent = await routeMessage('some ambiguous text', model)
  assert.equal(intent, 'spend')
})

test('action intent passes through at sufficient confidence', async () => {
  const model = new FakeModel(json({ intent: 'action', confidence: 0.85 }))
  const intent = await routeMessage('put 200 into the car fund', model)
  assert.equal(intent, 'action')
})
