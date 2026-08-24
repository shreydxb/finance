export interface FxRefreshQuote {
  rates: { AED: 1; USD: number; INR: number }
  fetchedAt: string
  providerAsOf: string
  provider: 'open.er-api'
}

type FetchLike = typeof fetch

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isFinite(date.getTime()) ? date : null
}

export async function fetchFxQuote(
  fetcher: FetchLike = fetch,
  now: () => Date = () => new Date()
): Promise<FxRefreshQuote> {
  const fetchedAt = now()
  const response = await fetcher('https://open.er-api.com/v6/latest/AED')
  if (!response.ok) throw new Error(`open.er-api: HTTP ${response.status}`)
  const data = await response.json()
  if (data?.result !== 'success') throw new Error(`open.er-api result: ${String(data?.result)}`)

  const usdPerAed = data?.rates?.USD
  const inrPerAed = data?.rates?.INR
  if (!(typeof usdPerAed === 'number' && usdPerAed > 0)
    || !(typeof inrPerAed === 'number' && inrPerAed > 0)) {
    throw new Error('open.er-api response is missing positive USD/INR rates')
  }

  const providerAsOf = typeof data?.time_last_update_unix === 'number'
    ? new Date(data.time_last_update_unix * 1000)
    : validDate(data?.time_last_update_utc)
  if (!providerAsOf || providerAsOf.getTime() > fetchedAt.getTime() + 5 * 60_000) {
    throw new Error('open.er-api response has no trustworthy provider as-of timestamp')
  }

  return {
    rates: {
      AED: 1,
      USD: Number((1 / usdPerAed).toFixed(6)),
      INR: Number((1 / inrPerAed).toFixed(6)),
    },
    fetchedAt: fetchedAt.toISOString(),
    providerAsOf: providerAsOf.toISOString(),
    provider: 'open.er-api',
  }
}

export async function persistFxQuote(
  supabaseUrl: string,
  serviceKey: string,
  quote: FxRefreshQuote,
  fetcher: FetchLike = fetch
): Promise<void> {
  const response = await fetcher(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key: 'fx_rates', value: quote.rates, updated_at: quote.fetchedAt }),
  })
  if (!response.ok) throw new Error(`could not write fx_rates: HTTP ${response.status}`)
}

export async function refreshFxSource(
  supabaseUrl: string,
  serviceKey: string,
  options: { fetcher?: FetchLike; now?: () => Date } = {}
): Promise<FxRefreshQuote> {
  const quote = await fetchFxQuote(options.fetcher, options.now)
  await persistFxQuote(supabaseUrl, serviceKey, quote, options.fetcher)
  return quote
}
