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

import { refreshFxSource } from '../_shared/fxRefresh.ts'
import { resolveServiceKey } from '../_shared/serviceKey.ts'

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
    const quote = await refreshFxSource(supabaseUrl, serviceKey)
    return json({
      ok: true,
      fxRates: quote.rates,
      fetched_at: quote.fetchedAt,
      provider_as_of: quote.providerAsOf,
      provider: quote.provider,
    })
  } catch (error) {
    return json({ ok: false, error: `could not refresh FX rates: ${error instanceof Error ? error.message : String(error)}` }, 502)
  }
})
