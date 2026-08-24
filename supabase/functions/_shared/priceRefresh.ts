interface AccountRow {
  id: string
  ticker: string
  quantity: string
  currency: string
}

export interface PriceRefreshSuccess {
  id: string
  ticker: string
  price: number
  source: 'yahoo' | 'coingecko'
  fetched_at: string
  quote_at: string
}

export interface PriceRefreshFailure {
  id: string
  ticker: string
  error: string
}

export interface PriceRefreshResult {
  updated: PriceRefreshSuccess[]
  failed: PriceRefreshFailure[]
}

type FetchLike = typeof fetch

interface ProviderQuote {
  price: number
  source: 'yahoo' | 'coingecko'
  quoteAt: string
}

function providerTimestamp(epochSeconds: unknown, label: string, fetchedAt: Date): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) {
    throw new Error(`${label}: no provider quote/session timestamp`)
  }
  const date = new Date(epochSeconds * 1000)
  if (!Number.isFinite(date.getTime()) || date.getTime() > fetchedAt.getTime() + 5 * 60_000) {
    throw new Error(`${label}: invalid provider quote/session timestamp`)
  }
  return date.toISOString()
}

export async function fetchYahooQuote(
  ticker: string,
  fetchedAt: Date,
  fetcher: FetchLike = fetch
): Promise<ProviderQuote> {
  const response = await fetcher(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  if (!response.ok) throw new Error(`Yahoo ${ticker}: HTTP ${response.status}`)
  const meta = (await response.json())?.chart?.result?.[0]?.meta
  if (!(typeof meta?.regularMarketPrice === 'number' && meta.regularMarketPrice >= 0)) {
    throw new Error(`Yahoo ${ticker}: no price in response`)
  }
  return {
    price: meta.regularMarketPrice,
    source: 'yahoo',
    quoteAt: providerTimestamp(meta.regularMarketTime, `Yahoo ${ticker}`, fetchedAt),
  }
}

export async function fetchCoinGeckoBtcQuote(
  fetchedAt: Date,
  fetcher: FetchLike = fetch
): Promise<ProviderQuote> {
  const response = await fetcher(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true'
  )
  if (!response.ok) throw new Error(`CoinGecko BTC: HTTP ${response.status}`)
  const bitcoin = (await response.json())?.bitcoin
  if (!(typeof bitcoin?.usd === 'number' && bitcoin.usd >= 0)) {
    throw new Error('CoinGecko BTC: no price in response')
  }
  return {
    price: bitcoin.usd,
    source: 'coingecko',
    quoteAt: providerTimestamp(bitcoin.last_updated_at, 'CoinGecko BTC', fetchedAt),
  }
}

export async function refreshInvestmentPrices(
  supabaseUrl: string,
  serviceKey: string,
  options: { fetcher?: FetchLike; now?: () => Date } = {}
): Promise<PriceRefreshResult> {
  const fetcher = options.fetcher ?? fetch
  const restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  }
  const list = await fetcher(
    `${restUrl}/accounts?select=id,ticker,quantity,currency&type=eq.investment&currency=in.(USD,INR)&ticker=not.is.null&quantity=not.is.null`,
    { headers }
  )
  if (!list.ok) throw new Error(`could not list accounts: HTTP ${list.status}`)
  const accounts = (await list.json()) as AccountRow[]
  const updated: PriceRefreshSuccess[] = []
  const failed: PriceRefreshFailure[] = []

  for (const account of accounts) {
    const ticker = account.ticker.toUpperCase()
    const fetchedAt = (options.now ?? (() => new Date()))()
    try {
      const yahooSymbol = account.currency === 'INR' ? `${ticker}.NS` : ticker
      const quote = ticker === 'BTC'
        ? await fetchCoinGeckoBtcQuote(fetchedAt, fetcher)
        : await fetchYahooQuote(yahooSymbol, fetchedAt, fetcher)
      const quantity = Number(account.quantity)
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`${ticker}: invalid quantity`)
      const evidence: PriceRefreshSuccess = {
        id: account.id,
        ticker,
        price: quote.price,
        source: quote.source,
        fetched_at: fetchedAt.toISOString(),
        quote_at: quote.quoteAt,
      }
      const patch = await fetcher(`${restUrl}/accounts?id=eq.${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          last_price: quote.price,
          value: quantity * quote.price,
          updated_at: evidence.fetched_at,
          price_updated_at: evidence.fetched_at,
          price_quote_at: evidence.quote_at,
          price_source: evidence.source,
        }),
      })
      if (!patch.ok) throw new Error(`write failed: HTTP ${patch.status}`)
      updated.push(evidence)
    } catch (error) {
      failed.push({
        id: account.id,
        ticker,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { updated, failed }
}
