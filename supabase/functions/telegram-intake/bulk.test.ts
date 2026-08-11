import assert from 'node:assert/strict'
import test from 'node:test'

import { extractBulk, looksLikeBulk } from './bulk.ts'
import { FakeModel } from './fixtures/fakes.ts'
import { TODAY } from './fixtures/receipts.ts'
import type { PromptContext } from './prompt.ts'

const ctx: PromptContext = {
  today: TODAY,
  categories: ['Groceries', 'Dining Out', 'Rent & Housing'],
  accounts: ['Joint Current'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

test('looksLikeBulk fires on more than one amount-like token', () => {
  assert.equal(looksLikeBulk('spent 45 on groceries, 12 on coffee, and paid rent 3000'), true)
  assert.equal(looksLikeBulk('84 aed lunch at Noon'), false, 'one amount is an ordinary spend')
  assert.equal(looksLikeBulk('lunch with Tarika'), false, 'no amount at all')
})

test('looksLikeBulk can false-positive on a second numeric token — extractBulk degrades gracefully, see extract.test.ts', () => {
  // A card number reads as a second "amount" to the deterministic pre-check.
  // This is a known heuristic limitation (docs/telegram-bot-round2-design.md
  // §2's own caveat) — the fix lives in parseExtractionArray's fallback, not here.
  assert.equal(looksLikeBulk('43.05 to Noon, card ending 1657'), true)
})

test('extractBulk parses a model-returned array into one Extraction per element', async () => {
  const model = new FakeModel(
    '[' +
      '{"date":"2026-08-06","amount":45,"currency":"AED","category":"Groceries","paid_by":"Shrey","paid_with":null,"note":"groceries","confidence":0.9},' +
      '{"date":"2026-08-06","amount":12,"currency":"AED","category":"Dining Out","paid_by":"Shrey","paid_with":null,"note":"coffee","confidence":0.9},' +
      '{"date":"2026-08-06","amount":3000,"currency":"AED","category":"Rent & Housing","paid_by":"Shrey","paid_with":null,"note":"rent","confidence":0.95}' +
      ']'
  )

  const result = await extractBulk('spent 45 on groceries, 12 on coffee, and paid rent 3000', ctx, model)

  assert.equal(result.length, 3)
  assert.deepEqual(
    result.map((r) => [r.amount, r.category, r.note]),
    [
      [45, 'Groceries', 'groceries'],
      [12, 'Dining Out', 'coffee'],
      [3000, 'Rent & Housing', 'rent'],
    ]
  )
  assert.match(model.lastPromptText(), /more than one spend/)
  assert.match(model.lastPromptText(), /spent 45 on groceries/)
})
