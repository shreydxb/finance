import assert from 'node:assert/strict'
import test from 'node:test'

import { constantTimeEqual, createSnapshotHandler } from './handler.ts'

const RUN_ID = '11111111-1111-1111-1111-111111111111'
const INVOCATION_ID = '22222222-2222-2222-2222-222222222222'

function rpcResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function request(body: unknown = {}) {
  return new Request('https://edge.example/snapshot-net-worth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-snapshot-job-secret': 'job-secret' },
    body: JSON.stringify(body),
  })
}

test('constant-time comparison rejects different bytes and lengths', () => {
  assert.equal(constantTimeEqual('same', 'same'), true)
  assert.equal(constantTimeEqual('same', 'diff'), false)
  assert.equal(constantTimeEqual('same', 'same-longer'), false)
})

test('ordinary caller without the dedicated job secret is rejected before any RPC or refresh', async () => {
  let calls = 0
  const handler = createSnapshotHandler({
    supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', jobSecret: 'job-secret',
    fetcher: async () => { calls += 1; return rpcResponse({}) },
  })
  const response = await handler(new Request('https://edge.example', { method: 'POST' }))
  assert.equal(response.status, 401)
  assert.equal(calls, 0)
})

test('orchestrator orders claim, FX, price evidence, then Postgres capture and accepts explicit partial price success', async () => {
  const order: string[] = []
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const name = String(input).split('/').at(-1) ?? ''
    order.push(name)
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (name === 'claim_nw_snapshot_run') {
      assert.equal(body.p_target_day, null)
      return rpcResponse([{ run_id: RUN_ID, target_day: '2026-08-24', attempt_number: 1, claim_state: 'claimed' }])
    }
    if (name === 'record_nw_snapshot_attempt_event') return rpcResponse('event-id')
    if (name === 'capture_nw_snapshot_v1') return rpcResponse({ state: 'published', quality_status: 'provisional' })
    throw new Error(`unexpected RPC ${name}`)
  }
  const handler = createSnapshotHandler({
    supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', jobSecret: 'job-secret',
    fetcher: fetcher as typeof fetch,
    randomUuid: () => INVOCATION_ID,
    now: () => new Date('2026-08-25T02:00:00Z'),
    refreshFx: async () => {
      order.push('refresh-fx-provider')
      return { rates: { AED: 1, USD: 3.6725, INR: 0.04 }, fetchedAt: '2026-08-25T02:00:00Z', providerAsOf: '2026-08-25T00:00:00Z', provider: 'open.er-api' }
    },
    refreshPrices: async () => {
      order.push('refresh-price-providers')
      return { updated: [], failed: [{ id: 'a', ticker: 'VOO', error: 'provider timeout' }] }
    },
  })
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(order, [
    'claim_nw_snapshot_run',
    'refresh-fx-provider',
    'record_nw_snapshot_attempt_event',
    'refresh-price-providers',
    'record_nw_snapshot_attempt_event',
    'capture_nw_snapshot_v1',
  ])
  assert.equal((await response.json()).quality_status, 'provisional')
})

test('FX failure records an immutable failed attempt event and never calls price or capture', async () => {
  const rpcNames: string[] = []
  let priceCalls = 0
  const handler = createSnapshotHandler({
    supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', jobSecret: 'job-secret',
    fetcher: async (input, init) => {
      const name = String(input).split('/').at(-1) ?? ''
      rpcNames.push(name)
      if (name === 'claim_nw_snapshot_run') return rpcResponse([{ run_id: RUN_ID, target_day: '2026-08-24', attempt_number: 1, claim_state: 'claimed' }])
      const body = JSON.parse(String(init?.body ?? '{}'))
      assert.equal(body.p_event_kind, 'failed')
      assert.equal(body.p_evidence.phase, 'fx_refresh')
      return rpcResponse('event-id')
    },
    randomUuid: () => INVOCATION_ID,
    refreshFx: async () => { throw new Error('FX unavailable') },
    refreshPrices: async () => { priceCalls += 1; return { updated: [], failed: [] } },
  })
  const response = await handler(request())
  assert.equal(response.status, 502)
  assert.equal(priceCalls, 0)
  assert.deepEqual(rpcNames, ['claim_nw_snapshot_run', 'record_nw_snapshot_attempt_event'])
})

test('already-published same-day invocation is a no-op with no source refresh', async () => {
  let refreshCalls = 0
  const handler = createSnapshotHandler({
    supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', jobSecret: 'job-secret',
    fetcher: async () => rpcResponse([{ run_id: RUN_ID, target_day: '2026-08-24', attempt_number: null, claim_state: 'already_published' }]),
    refreshFx: async () => { refreshCalls += 1; throw new Error('must not run') },
    refreshPrices: async () => { refreshCalls += 1; return { updated: [], failed: [] } },
  })
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.equal(refreshCalls, 0)
  assert.equal((await response.json()).state, 'already_published')
})

test('manual recovery forwards only an explicit missing target day to the database contract', async () => {
  let claimBody: Record<string, unknown> | null = null
  const handler = createSnapshotHandler({
    supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', jobSecret: 'job-secret',
    fetcher: async (_input, init) => {
      claimBody = JSON.parse(String(init?.body ?? '{}'))
      return rpcResponse([{ run_id: null, target_day: '2026-08-22', attempt_number: null, claim_state: 'existing_legacy_point' }])
    },
  })
  const response = await handler(request({ trigger_kind: 'manual_recovery', target_day: '2026-08-22' }))
  assert.equal(response.status, 200)
  assert.equal(claimBody?.p_trigger_kind, 'manual_recovery')
  assert.equal(claimBody?.p_target_day, '2026-08-22')
})
