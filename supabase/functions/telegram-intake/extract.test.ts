import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampConfidence,
  ExtractionError,
  extractBulkFromText,
  extractFromImage,
  extractFromText,
  matchCategory,
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  normalizeItems,
  OpenRouterClient,
  parseExtraction,
  parseExtractionArray,
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

test('normalizeItems parses, sanitizes and caps a line-item array', () => {
  assert.equal(normalizeItems(undefined), null, 'the common case: nothing itemized')
  assert.equal(normalizeItems(null), null)
  assert.equal(normalizeItems([]), null, 'an empty array is the same as none')
  assert.equal(normalizeItems('Makhana, Dosa Batter'), null, 'a string is not an items array')

  const parsed = normalizeItems([
    { name: 'Makhana', qty: 1, price: 12 },
    { name: ' Dosa   Batter ', qty: 2, price: '9.50' },
    { name: 'Cucumber', qty: null, price: 3.449 },
    { notAName: 'skip me', price: 5 },
    { name: '', price: 5 },
    'not an object',
  ])
  assert.deepEqual(parsed, [
    { name: 'Makhana', qty: 1, price: 12 },
    { name: 'Dosa Batter', qty: 2, price: 9.5 },
    { name: 'Cucumber', qty: null, price: 3.45 },
  ])

  const oversized = Array.from({ length: 50 }, (_, i) => ({ name: `Item ${i}`, qty: null, price: 1 }))
  assert.equal(normalizeItems(oversized)?.length, 40, 'a 40-item cap guards against a runaway read')
})

test('parseExtraction wires items through, defaulting to null', () => {
  assert.equal(parseExtraction('{"amount":10,"confidence":0.9}', ctx).items, null)

  const withItems = parseExtraction(
    '{"amount":41.95,"confidence":0.9,"items":[{"name":"Oats","qty":1,"price":8}]}',
    ctx
  )
  assert.deepEqual(withItems.items, [{ name: 'Oats', qty: 1, price: 8 }])
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
    const offending = Array.from(value).find((char) => char.charCodeAt(0) > 0xff)
    assert.equal(offending, undefined, `header ${name} must be Latin-1, but contains ${offending}: ${value}`)
  }
})

test('a truncated response is reported as truncation, not as malformed JSON', async () => {
  // Regression from two real receipt failures on 10 Aug 2026 (intake_logs).
  // The model was cut off at the 500-token cap partway through an itemized
  // array. What it had produced was correct; the tail was simply missing. The
  // parser downstream saw unbalanced JSON and reported "malformed JSON", which
  // read as the model being inaccurate — and that misreading is recorded in
  // CLAUDE.md as "receipt-photo accuracy is unproven". Name the real cause.
  const truncated = '[\n  {\n    "date": "2026-08-08",\n    "amount": 188.36,\n    "confidence'
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: truncated }, finish_reason: 'length' }] }))
    )) as unknown as typeof fetch

  await assert.rejects(
    () =>
      new OpenRouterClient('test-key', 'google/gemini-2.5-flash-lite', fetchImpl).chat([
        { role: 'user', content: 'receipt' },
      ]),
    (error: Error) => {
      assert.match(error.message, /truncated/i)
      assert.doesNotMatch(error.message, /malformed/i)
      return true
    }
  )
})

test('a complete response with finish_reason=stop is returned unchanged', async () => {
  const content = '{"amount":84,"confidence":0.9}'
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
    )) as unknown as typeof fetch

  const result = await new OpenRouterClient('test-key', 'google/gemini-2.5-flash-lite', fetchImpl).chat([
    { role: 'user', content: 'lunch' },
  ])

  assert.equal(result, content)
})

test('the output cap is large enough for a multi-item itemized receipt', async () => {
  // The failures were on arrays, not single spends: an itemized receipt (018)
  // and a bulk message (round2 §2) both return one object per line item.
  let body: Record<string, unknown> = {}
  const fetchImpl = ((_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string)
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"amount":1}' }, finish_reason: 'stop' }] }))
    )
  }) as unknown as typeof fetch

  await new OpenRouterClient('test-key', 'google/gemini-2.5-flash-lite', fetchImpl).chat([
    { role: 'user', content: 'receipt' },
  ])

  // A single item costs roughly 60-80 tokens; the old 500 covered about six
  // before cutting off mid-object.
  assert.ok(
    (body.max_tokens as number) >= 2000,
    `max_tokens must leave room for a long receipt, got ${body.max_tokens}`
  )
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

test('parseExtractionArray: every existing single-transaction fixture still passes, wrapped in [...] once', () => {
  // docs/telegram-bot-round2-design.md §2: "every existing fixture in
  // fixtures/receipts.ts still passes with [response] wrapped once."
  for (const receipt of RECEIPT_CASES) {
    const [result] = parseExtractionArray(`[${receipt.raw}]`, ctx)
    assert.equal(result.amount, receipt.expect.amount, receipt.label)
    assert.equal(result.currency, receipt.expect.currency, receipt.label)
    assert.equal(result.category, receipt.expect.category, receipt.label)
  }
})

test('parseExtractionArray splits a genuine multi-transaction array, one Extraction per element', () => {
  const raw =
    '[{"amount":45,"category":"Groceries","confidence":0.9},{"amount":12,"category":"Dining Out","confidence":0.9},{"amount":3000,"category":null,"confidence":0.6}]'
  const result = parseExtractionArray(raw, ctx)

  assert.equal(result.length, 3)
  assert.deepEqual(result.map((r) => r.amount), [45, 12, 3000])
  assert.deepEqual(result.map((r) => r.category), ['Groceries', 'Dining Out', null])
})

test('parseExtractionArray tolerates markdown fences and a preamble sentence, same as parseExtraction', () => {
  const fenced = '```json\n[{"amount":45,"confidence":0.9},{"amount":12,"confidence":0.9}]\n```'
  assert.equal(parseExtractionArray(fenced, ctx).length, 2)

  const preambled = 'Here are the transactions:\n[{"amount":45,"confidence":0.9},{"amount":12,"confidence":0.9}]'
  assert.equal(parseExtractionArray(preambled, ctx).length, 2)
})

test('parseExtractionArray caps a runaway array at 20 transactions', () => {
  const raw = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ amount: i + 1, confidence: 0.9 })))
  assert.equal(parseExtractionArray(raw, ctx).length, 20)
})

test('parseExtractionArray degrades a bare object into a one-element array instead of failing', () => {
  // The bulk pre-check is a heuristic that can fire on a message that's
  // really one transaction (docs/telegram-bot-round2-design.md §2) — the
  // model reasonably answers with a single object in that case.
  const result = parseExtractionArray('{"amount":43.05,"category":"Shopping","confidence":0.95}', ctx)
  assert.equal(result.length, 1)
  assert.equal(result[0].amount, 43.05)
  assert.equal(result[0].category, 'Shopping')
})

test('parseExtractionArray raises on unusable input, same as parseExtraction', () => {
  assert.throws(() => parseExtractionArray('', ctx), ExtractionError)
  assert.throws(() => parseExtractionArray('I could not read that.', ctx), ExtractionError)
  assert.throws(() => parseExtractionArray('[]', ctx), ExtractionError, 'an empty array is unusable, not zero rows')
})

test('extractBulkFromText sends the household context and asks for the array shape', async () => {
  const model = new FakeModel('[{"amount":45,"category":"Groceries","confidence":0.9},{"amount":12,"category":"Dining Out","confidence":0.9}]')
  const result = await extractBulkFromText('45 groceries, 12 coffee', ctx, model)

  assert.equal(result.length, 2)
  const prompt = model.lastPromptText()
  assert.match(prompt, /JSON array/)
  assert.match(prompt, /Dining Out/)
  assert.match(prompt, /45 groceries, 12 coffee/)
})

test('image extraction attaches the data URL and any caption', async () => {
  const model = new FakeModel('{"amount":184.25,"currency":"AED","category":"Groceries","confidence":0.94}')
  await extractFromImage({ dataUrl: 'data:image/jpeg;base64,AAAA', caption: 'weekly shop' }, ctx, model)

  assert.equal(model.lastHadImage(), true)
  assert.match(model.lastPromptText(), /weekly shop/)
})
