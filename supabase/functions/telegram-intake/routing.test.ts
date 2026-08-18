// Runs the fixture corpus (fixtures/routing.ts) against the real router —
// see that file for what each case is pinning down and why.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ROUTING_CASES } from './fixtures/routing.ts'
import { FakeModel } from './fixtures/fakes.ts'
import { looksLikeQuestion, routeMessage } from './route.ts'

const SPEND_CASES = ROUTING_CASES.filter((c) => c.expectedIntent === 'spend')

test('the regex fast path alone misroutes no spend case as a question', () => {
  for (const { label, text } of SPEND_CASES) {
    assert.equal(looksLikeQuestion(text), false, `expected "${text}" (${label}) not to read as a question via regex alone`)
  }
})

test('every corpus case reaches its expected intent', async () => {
  for (const { label, text, expectedIntent, classifierResponse } of ROUTING_CASES) {
    // Cases without a classifierResponse resolve without a working model call
    // — either the regex fast path decides it before the model is ever
    // reached, or the case is deliberately hopeless for a classifier and must
    // fall back to 'spend' regardless of what the model says. THROW proves
    // both: routeMessage still gets the right answer even when the model is
    // unusable.
    const model = classifierResponse ? new FakeModel(JSON.stringify(classifierResponse)) : new FakeModel('THROW:classifier not needed for this case')
    const intent = await routeMessage(text, model)
    assert.equal(intent, expectedIntent, `"${text}" (${label}): expected ${expectedIntent}, got ${intent}`)
  }
})

test('every spend and ambiguous-toward-spend case still resolves to spend even when the classifier throws', async () => {
  const alwaysSpend = ROUTING_CASES.filter((c) => c.expectedIntent === 'spend')
  for (const { label, text } of alwaysSpend) {
    const model = new FakeModel('THROW:simulated model outage')
    const intent = await routeMessage(text, model)
    assert.equal(intent, 'spend', `"${text}" (${label}): expected spend under total classifier failure, got ${intent}`)
  }
})
