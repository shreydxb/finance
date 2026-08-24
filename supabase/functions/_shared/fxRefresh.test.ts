import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchFxQuote } from './fxRefresh.ts'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('FX refresh keeps provider as-of distinct from fetch time', async () => {
  const fetchedAt = new Date('2026-08-25T02:00:00.000Z')
  const quote = await fetchFxQuote(
    async () => response({
      result: 'success',
      time_last_update_unix: Date.parse('2026-08-24T00:00:00.000Z') / 1000,
      rates: { USD: 0.272294, INR: 26 },
    }),
    () => fetchedAt
  )
  assert.equal(quote.fetchedAt, fetchedAt.toISOString())
  assert.equal(quote.providerAsOf, '2026-08-24T00:00:00.000Z')
  assert.notEqual(quote.providerAsOf, quote.fetchedAt)
  assert.equal(quote.rates.AED, 1)
  assert.ok(quote.rates.USD > 3.67 && quote.rates.USD < 3.68)
})

test('FX refresh rejects a response without trustworthy provider time', async () => {
  await assert.rejects(
    () => fetchFxQuote(async () => response({ result: 'success', rates: { USD: 0.27, INR: 26 } })),
    /provider as-of timestamp/
  )
})
