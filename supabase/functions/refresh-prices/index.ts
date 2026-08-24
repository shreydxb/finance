// Supabase Edge Function: refresh-prices
//
// Manually-triggered (called from the Investments view's "Refresh prices"
// button, via supabase.functions.invoke). Fetches current prices for
// USD- and INR-denominated investment accounts with a ticker + quantity set,
// and writes last_price/value/updated_at back. Quantities and avg_cost stay
// manual — this only automates the price half, not brokerage sync.
//
// Sources (both keyless, no API key to manage):
//   - Yahoo Finance's unofficial chart endpoint, for US stock/ETF tickers and,
//     via the `.NS` suffix, NSE-listed India equities.
//   - CoinGecko's public API, for BTC.
// Both are free-tier/best-effort: no SLA, no auth, can change shape without
// notice. If either fails for a ticker, that account is just skipped and
// reported in `failed` — never silently zeroed.
//
// Gold/silver spot is NOT covered here (no solid keyless free source) — those
// stay manual for now.
//
// Deploy: supabase functions deploy refresh-prices

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { refreshInvestmentPrices } from '../_shared/priceRefresh.ts'
import { resolveServiceKey } from '../_shared/serviceKey.ts'

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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  let serviceKey: string
  try {
    serviceKey = resolveServiceKey(Deno.env.toObject())
  } catch {
    return json({ ok: false, error: 'function is not configured' }, 500)
  }
  if (!supabaseUrl) {
    return json({ ok: false, error: 'function is not configured' }, 500)
  }

  try {
    const result = await refreshInvestmentPrices(supabaseUrl, serviceKey)
    return json({ ok: true, ...result })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502)
  }
})
