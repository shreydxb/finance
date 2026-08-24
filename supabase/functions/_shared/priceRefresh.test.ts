import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchYahooQuote, refreshInvestmentPrices } from './priceRefresh.ts'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('Yahoo quote preserves provider session time separately from fetch time', async () => {
  const fetchedAt = new Date('2026-08-25T02:00:00.000Z')
  const quote = await fetchYahooQuote('VOO', fetchedAt, async () => response({
    chart: { result: [{ meta: { regularMarketPrice: 700, regularMarketTime: Date.parse('2026-08-24T20:00:00Z') / 1000 } }] },
  }))
  assert.equal(quote.price, 700)
  assert.equal(quote.quoteAt, '2026-08-24T20:00:00.000Z')
  assert.notEqual(quote.quoteAt, fetchedAt.toISOString())
})

test('Yahoo quote with no provider session timestamp fails instead of looking Complete', async () => {
  await assert.rejects(
    () => fetchYahooQuote('VOO', new Date(), async () => response({
      chart: { result: [{ meta: { regularMarketPrice: 700 } }] },
    })),
    /provider quote\/session timestamp/
  )
})

test('price refresh reports partial success and writes fetch/quote timestamps distinctly', async () => {
  const writes: unknown[] = []
  const now = new Date('2026-08-25T02:00:00.000Z')
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/accounts?select=')) {
      return response([
        { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ticker: 'VOO', quantity: '2', currency: 'USD' },
        { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ticker: 'FAIL', quantity: '1', currency: 'USD' },
      ])
    }
    if (url.includes('/chart/VOO')) {
      return response({ chart: { result: [{ meta: {
        regularMarketPrice: 700,
        regularMarketTime: Date.parse('2026-08-24T20:00:00Z') / 1000,
      } }] } })
    }
    if (url.includes('/chart/FAIL')) return response({}, 503)
    if (init?.method === 'PATCH') {
      writes.push(JSON.parse(String(init.body)))
      return response({})
    }
    throw new Error(`unexpected request ${url}`)
  }
  const result = await refreshInvestmentPrices('https://example.supabase.co', 'service', {
    fetcher: fetcher as typeof fetch,
    now: () => now,
  })
  assert.equal(result.updated.length, 1)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  assert.deepEqual(writes, [{
    last_price: 700,
    value: 1400,
    updated_at: now.toISOString(),
    price_updated_at: now.toISOString(),
    price_quote_at: '2026-08-24T20:00:00.000Z',
    price_source: 'yahoo',
  }])
})
