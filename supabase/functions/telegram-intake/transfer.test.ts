import assert from 'node:assert/strict'
import test from 'node:test'

import { extractTransfer, looksLikeTransfer } from './transfer.ts'
import { FakeModel } from './fixtures/fakes.ts'
import { TODAY } from './fixtures/receipts.ts'
import type { PromptContext } from './prompt.ts'

const ctx: PromptContext = {
  today: TODAY,
  categories: ['Groceries', 'Dining Out'],
  accounts: ['Wio Personal', 'ENBD Savings'],
  people: ['Shrey', 'Tarika'],
  defaultCurrency: 'AED',
}

test('looksLikeTransfer catches the design doc example, which never says the word "transfer"', () => {
  assert.equal(looksLikeTransfer('moved 2000 from Wio to ENBD savings'), true)
  assert.equal(looksLikeTransfer('transferred 500 to savings'), true)
  assert.equal(looksLikeTransfer('transfer 100 aed to Wio'), true)
})

test('looksLikeTransfer defaults to spend on any doubt (router rule #2)', () => {
  assert.equal(looksLikeTransfer('84 aed lunch at Noon'), false)
  assert.equal(looksLikeTransfer('paid from Wio for groceries'), false, '"from" alone is not enough')
  assert.equal(looksLikeTransfer('sent the invoice to accounting'), false, 'a move-verb + "to" but no "from"')
})

test('extractTransfer parses the model response into amount/currency/from/to/date', async () => {
  const model = new FakeModel(
    '{"amount":2000,"currency":"AED","from_account":"Wio Personal","to_account":"ENBD Savings","date":"2026-08-06"}'
  )
  const result = await extractTransfer('moved 2000 from Wio to ENBD savings', ctx, model)

  assert.deepEqual(result, {
    amount: 2000,
    currency: 'AED',
    fromAccount: 'Wio Personal',
    toAccount: 'ENBD Savings',
    date: '2026-08-06',
  })
  assert.match(model.lastPromptText(), /moving money between two of their own accounts/)
  assert.match(model.lastPromptText(), /Wio Personal/)
})

test('extractTransfer reuses the same hardening as spend extraction: missing keys, messy currency, future date', async () => {
  const model = new FakeModel('{"amount":null,"currency":"Dhs","from_account":null,"to_account":"unknown","date":"2027-01-01"}')
  const result = await extractTransfer('moved some money from one account to another', ctx, model)

  assert.equal(result.amount, null)
  assert.equal(result.currency, 'AED')
  assert.equal(result.fromAccount, null)
  assert.equal(result.toAccount, null, '"unknown" is treated as no account, same as note elsewhere')
  assert.equal(result.date, TODAY, 'never a future date')
})
