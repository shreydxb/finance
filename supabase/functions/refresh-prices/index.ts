// Supabase Edge Function: refresh-prices
//
// Manually-triggered (called from the Investments view's "Refresh prices"
// button, via supabase.functions.invoke). Fetches current prices for
// USD-denominated investment accounts with a ticker + quantity set, and
// writes last_price/value/updated_at back. Quantities and avg_cost stay
// manual — this only automates the price half, not brokerage sync.
//
// Sources (both keyless, no API key to manage):
//   - Yahoo Finance's unofficial chart endpoint, for US stock/ETF tickers.
//   - CoinGecko's public API, for BTC.
// Both are free-tier/best-effort: no SLA, no auth, can change shape without
// notice. If either fails for a ticker, that account is just skipped and
// reported in `failed` — never silently zeroed.
//
// India (NSE) tickers and gold/silver spot are NOT covered here (no solid
// keyless free source for either) — those stay manual for now.
//
// Deploy: supabase functions deploy refresh-prices

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

interface AccountRow {
  id: string
  ticker: string
  quantity: string
  currency: string
}

// This function is called from the browser (unlike telegram-intake, which is
// server-to-server), so it must answer the CORS preflight or the real POST is
// never sent. Origin is `*` because the caller's origin changes per Netlify
// deploy preview; CORS is not the security boundary here — verify_jwt is, so
// a caller still needs a valid session token for this project.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

async function fetchYahooPrice(ticker: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`)
  const data = await res.json()
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
  if (typeof price !== 'number') throw new Error(`Yahoo ${ticker}: no price in response`)
  return price
}

async function fetchCoinGeckoBTC(): Promise<number> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
  if (!res.ok) throw new Error(`CoinGecko BTC: HTTP ${res.status}`)
  const data = await res.json()
  const price = data?.bitcoin?.usd
  if (typeof price !== 'number') throw new Error('CoinGecko BTC: no price in response')
  return price
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'function is not configured' }, 500)
  }

  const restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`
  const pgHeaders = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  }

  const listRes = await fetch(
    `${restUrl}/accounts?select=id,ticker,quantity,currency&type=eq.investment&currency=eq.USD&ticker=not.is.null&quantity=not.is.null`,
    { headers: pgHeaders }
  )
  if (!listRes.ok) {
    return json({ ok: false, error: `could not list accounts: HTTP ${listRes.status}` }, 500)
  }
  const accounts = (await listRes.json()) as AccountRow[]

  const updated: { id: string; ticker: string; price: number }[] = []
  const failed: { ticker: string; error: string }[] = []

  for (const account of accounts) {
    const ticker = account.ticker.toUpperCase()
    try {
      const price = ticker === 'BTC' ? await fetchCoinGeckoBTC() : await fetchYahooPrice(ticker)
      const value = Number(account.quantity) * price

      const patchRes = await fetch(`${restUrl}/accounts?id=eq.${account.id}`, {
        method: 'PATCH',
        headers: pgHeaders,
        body: JSON.stringify({ last_price: price, value, updated_at: new Date().toISOString() }),
      })
      if (!patchRes.ok) throw new Error(`write failed: HTTP ${patchRes.status}`)

      updated.push({ id: account.id, ticker, price })
    } catch (error) {
      failed.push({ ticker, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return json({ ok: true, updated, failed })
})
