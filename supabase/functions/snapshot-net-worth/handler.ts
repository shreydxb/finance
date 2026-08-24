import { refreshFxSource, type FxRefreshQuote } from '../_shared/fxRefresh.ts'
import { refreshInvestmentPrices, type PriceRefreshResult } from '../_shared/priceRefresh.ts'

export const SNAPSHOT_SOURCE_VERSION = 'shr-113-phase-a-v1'

type FetchLike = typeof fetch

interface Dependencies {
  supabaseUrl: string
  serviceKey: string
  jobSecret: string
  fetcher?: FetchLike
  now?: () => Date
  randomUuid?: () => string
  refreshFx?: typeof refreshFxSource
  refreshPrices?: typeof refreshInvestmentPrices
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return difference === 0
}

async function rpc(fetcher: FetchLike, deps: Dependencies, name: string, body: unknown): Promise<unknown> {
  const response = await fetcher(`${deps.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: deps.serviceKey,
      authorization: `Bearer ${deps.serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.message || payload?.error || `HTTP ${response.status}`
    throw new Error(`${name}: ${detail}`)
  }
  return payload
}

async function recordEvent(
  fetcher: FetchLike,
  deps: Dependencies,
  claim: Record<string, unknown>,
  invocationId: string,
  eventKind: string,
  outcome: string,
  evidence: unknown,
  occurredAt: string
): Promise<void> {
  await rpc(fetcher, deps, 'record_nw_snapshot_attempt_event', {
    p_run_id: claim.run_id,
    p_attempt_number: claim.attempt_number,
    p_invocation_id: invocationId,
    p_event_kind: eventKind,
    p_outcome: outcome,
    p_evidence: evidence,
    p_occurred_at: occurredAt,
  })
}

function fxEvidence(quote: FxRefreshQuote) {
  return {
    provider: quote.provider,
    rates: quote.rates,
    fetched_at: quote.fetchedAt,
    provider_as_of: quote.providerAsOf,
  }
}

function priceEvidence(result: PriceRefreshResult) {
  return { updated: result.updated, failed: result.failed }
}

export function createSnapshotHandler(deps: Dependencies) {
  const fetcher = deps.fetcher ?? fetch
  const now = deps.now ?? (() => new Date())
  const randomUuid = deps.randomUuid ?? (() => crypto.randomUUID())
  const refreshFx = deps.refreshFx ?? refreshFxSource
  const refreshPrices = deps.refreshPrices ?? refreshInvestmentPrices

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
    const suppliedSecret = request.headers.get('x-snapshot-job-secret') ?? ''
    if (!deps.jobSecret || !constantTimeEqual(suppliedSecret, deps.jobSecret)) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }

    let input: { target_day?: string; trigger_kind?: string }
    try {
      input = await request.json().catch(() => ({}))
    } catch {
      return json({ ok: false, error: 'invalid JSON' }, 400)
    }
    const triggerKind = input.trigger_kind ?? 'scheduled'
    if (!['scheduled', 'manual_recovery'].includes(triggerKind)) {
      return json({ ok: false, error: 'unsupported trigger_kind' }, 400)
    }
    if (triggerKind === 'manual_recovery' && !/^\d{4}-\d{2}-\d{2}$/.test(input.target_day ?? '')) {
      return json({ ok: false, error: 'manual recovery requires target_day' }, 400)
    }

    const invocationId = randomUuid()
    const invokedAt = now().toISOString()
    let claim: Record<string, unknown> | null = null
    try {
      const claimed = await rpc(fetcher, deps, 'claim_nw_snapshot_run', {
        p_target_day: input.target_day ?? null,
        p_trigger_kind: triggerKind,
        p_invocation_id: invocationId,
        p_invoked_at: invokedAt,
      })
      claim = (Array.isArray(claimed) ? claimed[0] : claimed) as Record<string, unknown> | null
      if (!claim) throw new Error('claim returned no row')
      if (claim.claim_state !== 'claimed') {
        return json({ ok: true, state: claim.claim_state, target_day: claim.target_day, run_id: claim.run_id })
      }

      let fx: FxRefreshQuote
      try {
        fx = await refreshFx(deps.supabaseUrl, deps.serviceKey, { fetcher, now })
        await recordEvent(fetcher, deps, claim, invocationId, 'fx_refresh', 'succeeded', fxEvidence(fx), now().toISOString())
      } catch (error) {
        const evidence = { phase: 'fx_refresh', error: error instanceof Error ? error.message : String(error) }
        await recordEvent(fetcher, deps, claim, invocationId, 'failed', 'failed', evidence, now().toISOString())
        return json({ ok: false, state: 'retryable_failed', ...evidence }, 502)
      }

      let prices: PriceRefreshResult
      try {
        prices = await refreshPrices(deps.supabaseUrl, deps.serviceKey, { fetcher, now })
        await recordEvent(
          fetcher,
          deps,
          claim,
          invocationId,
          'price_refresh',
          prices.failed.length > 0 ? 'partial' : 'succeeded',
          priceEvidence(prices),
          now().toISOString()
        )
      } catch (error) {
        const evidence = { phase: 'price_refresh', error: error instanceof Error ? error.message : String(error) }
        await recordEvent(fetcher, deps, claim, invocationId, 'failed', 'failed', evidence, now().toISOString())
        return json({ ok: false, state: 'retryable_failed', ...evidence }, 502)
      }

      const captured = await rpc(fetcher, deps, 'capture_nw_snapshot_v1', {
        p_run_id: claim.run_id,
        p_attempt_number: claim.attempt_number,
        p_invocation_id: invocationId,
        p_snapshot_at: now().toISOString(),
        p_source_version: SNAPSHOT_SOURCE_VERSION,
      })
      return json({ ok: true, ...(captured as Record<string, unknown>) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (claim?.claim_state === 'claimed') {
        await recordEvent(
          fetcher,
          deps,
          claim,
          invocationId,
          'failed',
          'failed',
          { phase: 'capture', error: message },
          now().toISOString()
        ).catch(() => null)
      }
      return json({ ok: false, state: 'retryable_failed', error: message }, 500)
    }
  }
}
