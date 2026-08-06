import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampConfidence,
  ExtractionError,
  extractFromImage,
  extractFromText,
  matchCategory,
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  OpenRouterClient,
  parseExtraction,
} from './extract.ts'
import { CATEGORIES, FakeModel } from './fixtures/fakes.ts'
import { RECEIPT_CASES, TODAY } from './fixtures/receipts.ts'
import type { PromptContext } from './prompt.ts'

const ctx: PromptContext = {
  today: TODAY,
  categories: CATEGORIES.map((c) => c.name),
  accounts: ['Joint Current', 'ENBD Credit Card 4412', 'Wio Personal'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

test('receipt corpus normalises to clean, valid extractions', async (t) => {
  for (const receipt of RECEIPT_CASES) {
    await t.test(receipt.label, () => {
      const result = parseExtraction(receipt.raw, ctx)

      assert.equal(result.amount, receipt.expect.amount)
      assert.equal(result.currency, receipt.expect.currency)
      assert.equal(result.category, receipt.expect.category)
      assert.equal(result.date, receipt.expect.date ?? result.date)
      assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(result.date <= TODAY, 'never dated in the future')
      assert.ok(result.confidence >= 0 && result.confidence <= 1)

      if (receipt.expect.confidence !== undefined) {
        assert.equal(result.confidence, receipt.expect.confidence)
      }
      if (receipt.expect.confidenceAtMost !== undefined) {
        assert.ok(
          result.confidence <= receipt.expect.confidenceAtMost,
          `confidence ${result.confidence} should be capped at ${receipt.expect.confidenceAtMost}`
        )
      }
    })
  }
})

test('unusable model output raises rather than guessing', () => {
  assert.throws(() => parseExtraction('', ctx), ExtractionError)
  assert.throws(() => parseExtraction('I could not read that receipt.', ctx), ExtractionError)
  assert.throws(() => parseExtraction('{"amount": 12,}', ctx), ExtractionError)
})

test('an array of transactions collapses to the first object', () => {
  // The contract is one transaction per message; a model that volunteers a list
  // shouldn't cost the household the row.
  assert.equal(parseExtraction('[{"amount": 12, "confidence": 0.9}]', ctx).amount, 12)
})

test('missing keys degrade instead of throwing', () => {
  const result = parseExtraction('{}', ctx)
  assert.equal(result.amount, null)
  assert.equal(result.category, null)
  assert.equal(result.currency, 'AED')
  assert.equal(result.date, TODAY)
  assert.equal(result.confidence, 0)
  assert.equal(result.note, null)
})

test('note is squashed to a single line and trimmed', () => {
  const long = 'x'.repeat(400)
  const result = parseExtraction(`{"note":"Carrefour\\n  weekly  shop","amount":10,"confidence":0.9}`, ctx)
  assert.equal(result.note, 'Carrefour weekly shop')
  assert.equal(parseExtraction(`{"note":"${long}","amount":10}`, ctx).note?.length, 200)
  assert.equal(parseExtraction('{"note":"unknown","amount":10}', ctx).note, null)
})

test('normalizeAmount', () => {
  assert.equal(normalizeAmount(84), 84)
  assert.equal(normalizeAmount('AED 1,234.56'), 1234.56)
  assert.equal(normalizeAmount('84,50'), 84.5)
  assert.equal(normalizeAmount('₹ 12,500'), 12500)
  assert.equal(normalizeAmount(84.567), 84.57)
  assert.equal(normalizeAmount(0), null)
  assert.equal(normalizeAmount('free'), null)
  assert.equal(normalizeAmount(null), null)
  assert.equal(normalizeAmount(Number.NaN), null)
})

test('normalizeCurrency', () => {
  assert.equal(normalizeCurrency('Dhs', 'AED'), 'AED')
  assert.equal(normalizeCurrency('₹', 'AED'), 'INR')
  assert.equal(normalizeCurrency('$', 'AED'), 'USD')
  assert.equal(normalizeCurrency('gbp', 'AED'), 'GBP')
  assert.equal(normalizeCurrency('', 'AED'), 'AED')
  assert.equal(normalizeCurrency(null, 'AED'), 'AED')
})

test('normalizeDate resolves receipts, relative words and nonsense', () => {
  assert.equal(normalizeDate('2026-08-01', TODAY), '2026-08-01')
  assert.equal(normalizeDate('01/08/2026', TODAY), '2026-08-01')
  assert.equal(normalizeDate('1-8-26', TODAY), '2026-08-01')
  assert.equal(normalizeDate('yesterday', TODAY), '2026-08-05')
  assert.equal(normalizeDate('today', TODAY), TODAY)
  assert.equal(normalizeDate('2026-02-30', TODAY), TODAY, 'impossible dates fall back')
  assert.equal(normalizeDate('sometime last week', TODAY), TODAY)
  assert.equal(normalizeDate(null, TODAY), TODAY)
})

test('clampConfidence', () => {
  assert.equal(clampConfidence(0.87), 0.87)
  assert.equal(clampConfidence(87), 0.87)
  assert.equal(clampConfidence(1.4), 1)
  assert.equal(clampConfidence(-2), 0)
  assert.equal(clampConfidence('high'), 0)
})

test('matchCategory only ever returns a category the household has', () => {
  const names = CATEGORIES.map((c) => c.name)
  assert.equal(matchCategory('Groceries', names), 'Groceries')
  assert.equal(matchCategory('groceries ', names), 'Groceries')
  assert.equal(matchCategory('Transport and Fuel', names), 'Transport & Fuel')
  assert.equal(matchCategory('dining', names), 'Dining Out')
  assert.equal(matchCategory('Pet Supplies', names), null)
  assert.equal(matchCategory('', names), null)
  assert.equal(matchCategory(null, names), null)
})

test('every outgoing header stays inside Latin-1', async () => {
  // Regression: 'x-title' once contained an em dash. HTTP header values are
  // ByteString, so Deno threw "not a valid ByteString" while constructing the
  // request — the call never left the Edge Function, and the symptom (silent
  // extraction failure, zero requests recorded at OpenRouter) pointed nowhere
  // near the real cause.
  let captured: Record<string, string> = {}
  const fetchImpl = ((_url: string, init: RequestInit) => {
    captured = init.headers as Record<string, string>
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"amount":84,"confidence":0.9}' } }] }))
    )
  }) as unknown as typeof fetch

  await new OpenRouterClient('test-key', 'google/gemini-2.5-flash-lite', fetchImpl).chat([
    { role: 'user', content: 'hi' },
  ])

  assert.ok(Object.keys(captured).length > 0, 'headers were captured')
  for (const [name, value] of Object.entries(captured)) {
    assert.ok(/^[\x00-\xFF]*$/.test(value), `header ${name} must be Latin-1, got: ${value}`)
  }
})

test('text extraction sends the household context in the prompt', async () => {
  const model = new FakeModel('{"amount":84,"currency":"AED","category":"Dining Out","confidence":0.9}')
  const result = await extractFromText('84 dhs lunch at Noon', ctx, model)

  assert.equal(result.amount, 84)
  const prompt = model.lastPromptText()
  assert.match(prompt, /Dining Out/)
  assert.match(prompt, /ENBD Credit Card 4412/)
  assert.match(prompt, new RegExp(TODAY))
  assert.match(prompt, /84 dhs lunch at Noon/)
  assert.equal(model.lastHadImage(), false)
})

test('voice transcripts are flagged as spoken so numbers are treated cautiously', async () => {
  const model = new FakeModel('{"amount":84,"confidence":0.9,"category":"Dining Out"}')
  await extractFromText('spent eighty four dirhams at karak', ctx, model, { spoken: true })
  assert.match(model.lastPromptText(), /transcript of a voice note/)
})

test('image extraction attaches the data URL and any caption', async () => {
  const model = new FakeModel('{"amount":184.25,"currency":"AED","category":"Groceries","confidence":0.94}')
  await extractFromImage({ dataUrl: 'data:image/jpeg;base64,AAAA', caption: 'weekly shop' }, ctx, model)

  assert.equal(model.lastHadImage(), true)
  assert.match(model.lastPromptText(), /weekly shop/)
})
