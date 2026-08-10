import assert from 'node:assert/strict'
import test from 'node:test'

import { extractCashback, looksLikeCashback } from './cashback.ts'
import { FakeModel } from './fixtures/fakes.ts'
import { TODAY } from './fixtures/receipts.ts'
import type { PromptContext } from './prompt.ts'

const ctx: PromptContext = {
  today: TODAY,
  categories: ['Groceries', 'Dining Out'],
  accounts: ['Joint Current'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

test('looksLikeCashback only matches an explicit mention, not a lookalike word', () => {
  assert.equal(looksLikeCashback('got 15 aed cashback from the ENBD card'), true)
  assert.equal(looksLikeCashback('15 cash back from noon'), true)
  assert.equal(looksLikeCashback('CASHBACK from du bill'), true)
  assert.equal(looksLikeCashback('84 aed lunch at Noon'), false)
  assert.equal(looksLikeCashback('paid cash for groceries'), false, 'a bare "cash" is not cashback')
  assert.equal(looksLikeCashback('cashbacks are nice I guess'), true, 'word-boundary check is on the front only')
})

test('extractCashback parses the model response into amount/currency/source/date', async () => {
  const model = new FakeModel(
    '{"amount":15,"currency":"AED","source":"ENBD Credit Card cashback","date":"2026-08-06"}'
  )
  const result = await extractCashback('got 15 aed cashback from the ENBD card', ctx, model)

  assert.deepEqual(result, {
    amount: 15,
    currency: 'AED',
    source: 'ENBD Credit Card cashback',
    date: '2026-08-06',
  })
  assert.match(model.lastPromptText(), /cashback they received/)
  assert.match(model.lastPromptText(), /got 15 aed cashback/)
})

test('extractCashback reuses the same hardening as spend extraction: amount 0/null, messy currency, missing keys', async () => {
  const model = new FakeModel('{"amount":null,"currency":"Dhs","source":"unknown","date":"today"}')
  const result = await extractCashback('cashback but I forget how much', ctx, model)

  assert.equal(result.amount, null)
  assert.equal(result.currency, 'AED')
  assert.equal(result.source, null, '"unknown" is treated as no source, same as note elsewhere')
  assert.equal(result.date, TODAY)
})

test('extractCashback never returns a future date', async () => {
  const model = new FakeModel('{"amount":10,"currency":"AED","source":"Noon app cashback","date":"2027-01-01"}')
  const result = await extractCashback('10 cashback from noon', ctx, model)

  assert.equal(result.date, TODAY)
})
