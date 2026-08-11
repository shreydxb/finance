// Supabase Edge Function: refresh-fx
//
// Manually-triggered (called from Settings' "Refresh FX rates" button, via
// supabase.functions.invoke). Fetches live AED/USD/INR rates and writes them
// to settings.fx_rates, the same table/key PrefsContext already reads on
// every page load — this function is the only thing that was missing, the
// consuming side (src/lib/money.js toAED/fromAED) already existed.
//
// Source: open.er-api.com, keyless, free tier, no signup. Rates come back as
// "units of X per 1 AED" (e.g. USD: 0.2723); this app's fx_rates convention
// is the inverse — "AED per 1 unit of X" (src/lib/money.js's comment) — so
// USD/INR are inverted before writing. AED itself is always 1 by definition,
// never fetched.
//
// Deploy: supabase functions deploy refresh-fx

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

// Called from the browser, so it must answer the CORS preflight — same
// reasoning as refresh-prices (verify_jwt is the real security boundary,
// not origin).
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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'function is not configured' }, 500)
  }

  let rates: { USD: number; INR: number }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AED')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data?.result !== 'success') throw new Error(`API result: ${data?.result}`)
    const usdPerAed = data?.rates?.USD
    const inrPerAed = data?.rates?.INR
    if (typeof usdPerAed !== 'number' || typeof inrPerAed !== 'number') {
      throw new Error('missing USD/INR in response')
    }
    // Invert: this app stores "AED per 1 unit of X", the API gives "X per 1 AED".
    rates = { USD: 1 / usdPerAed, INR: 1 / inrPerAed }
  } catch (error) {
    return json({ ok: false, error: `could not fetch FX rates: ${error instanceof Error ? error.message : String(error)}` }, 502)
  }

  const fxRates = { AED: 1, USD: Number(rates.USD.toFixed(6)), INR: Number(rates.INR.toFixed(6)) }

  const restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`
  const pgHeaders = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    prefer: 'resolution=merge-duplicates',
  }
  const writeRes = await fetch(`${restUrl}/settings`, {
    method: 'POST',
    headers: pgHeaders,
    body: JSON.stringify({ key: 'fx_rates', value: fxRates, updated_at: new Date().toISOString() }),
  })
  if (!writeRes.ok) {
    return json({ ok: false, error: `could not write fx_rates: HTTP ${writeRes.status}` }, 500)
  }

  return json({ ok: true, fxRates })
})
