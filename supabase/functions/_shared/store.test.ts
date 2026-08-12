import assert from 'node:assert/strict'
import test from 'node:test'

import { ACCOUNTS, CATEGORIES } from '../telegram-intake/fixtures/fakes.ts'
import { buildHouseholdContext, PostgrestStore, SETTINGS_KEYS } from './store.ts'

function context(settings: { key: string; value: unknown }[], fallbackTelegramIds: number[] = []) {
  return buildHouseholdContext({
    categories: CATEGORIES,
    accounts: ACCOUNTS,
    settings,
    fallbackThreshold: 0.85,
    fallbackTelegramIds,
  })
}

test('the allowlist comes from the two settings rows', () => {
  const household = context([
    { key: SETTINGS_KEYS.person1, value: { person: 'Shrey', telegram_user_id: 111 } },
    { key: SETTINGS_KEYS.person2, value: { person: 'Tarika', telegram_user_id: 222 } },
  ])

  assert.deepEqual(Array.from(household.people.entries()), [
    [111, 'Shrey'],
    [222, 'Tarika'],
  ])
})

test('an unconfigured household lets nobody in', () => {
  const household = context([
    { key: SETTINGS_KEYS.person1, value: { person: 'Shrey', telegram_user_id: null } },
    { key: SETTINGS_KEYS.person2, value: null },
  ])

  assert.equal(household.people.size, 0, 'fail closed until the ids are filled in')
})

test('env ids are a bootstrap path and carry no person name', () => {
  const household = context([], [111])
  assert.equal(household.people.get(111), '')
  assert.equal(household.people.size, 1)
})

test('the threshold falls back when the setting is missing or out of range', () => {
  assert.equal(context([{ key: SETTINGS_KEYS.threshold, value: 0.6 }]).confidenceThreshold, 0.6)
  assert.equal(context([{ key: SETTINGS_KEYS.threshold, value: 42 }]).confidenceThreshold, 0.85)
  assert.equal(context([]).confidenceThreshold, 0.85)
})

test('a default account that no longer exists is ignored', () => {
  assert.equal(context([{ key: SETTINGS_KEYS.defaultAccount, value: 'acc-joint' }]).defaultAccountId, 'acc-joint')
  assert.equal(context([{ key: SETTINGS_KEYS.defaultAccount, value: 'acc-deleted' }]).defaultAccountId, null)
  assert.equal(context([]).defaultAccountId, null)
})

test('PostgREST calls are shaped the way Supabase expects', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co/',
    serviceKey: 'service-key',
    fetchImpl: ((url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify([{ id: 'tx-1' }]), { status: 200 }))
    }) as unknown as typeof fetch,
  })

  await store.insertTransaction({ amount: 84, telegram_msg_id: 12 })
  assert.equal(calls[0].url, 'https://project.supabase.co/rest/v1/transactions')
  assert.equal(calls[0].init.method, 'POST')
  assert.match(String((calls[0].init.headers as Record<string, string>).authorization), /service-key/)
  assert.equal((calls[0].init.headers as Record<string, string>).prefer, 'return=representation')

  await store.findTransactionByMessage(-100, 4242)
  // A correction may reply to either the household's message or the bot's prompt.
  assert.match(calls[1].url, /telegram_chat_id=eq\.-100/)
  assert.match(calls[1].url, /or=\(telegram_msg_id\.eq\.4242,telegram_prompt_msg_id\.eq\.4242\)/)

  await store.putSetting('tg_chat_id', { chat_id: -100 })
  assert.equal(calls[2].url, 'https://project.supabase.co/rest/v1/settings')
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(
    (calls[2].init.headers as Record<string, string>).prefer,
    'resolution=merge-duplicates,return=representation'
  )
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { key: 'tg_chat_id', value: { chat_id: -100 } })
})

test('loadHouseholdContext only fetches payable account types, not debt/asset trackers', async () => {
  const calls: { url: string }[] = []
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: ((url: string) => {
      calls.push({ url })
      return Promise.resolve(new Response('[]', { status: 200 }))
    }) as unknown as typeof fetch,
  })

  await store.loadHouseholdContext()

  const accountsCall = calls.find((c) => c.url.includes('/accounts'))
  assert.ok(accountsCall, 'accounts endpoint was called')
  // A loan/EMI sub-ledger like "Car Down-Payment EMI" must never be offered as
  // a paid_with match for a new purchase — only cash/credit_card are things a
  // receipt was actually paid *with*.
  assert.match(accountsCall!.url, /type=in\.\(cash,credit_card\)/)
})

test('joinMediaGroup creates then appends, and claimMediaGroup marks it processed', async () => {
  let stored: Record<string, unknown> | null = null
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (!url.includes('/media_groups')) return new Response('[]', { status: 200 })
    if (method === 'GET') return new Response(JSON.stringify(stored ? [stored] : []), { status: 200 })
    const body = JSON.parse(String(init.body))
    stored = method === 'POST' ? body : { ...stored, ...body }
    return new Response(JSON.stringify([stored]), { status: method === 'POST' ? 201 : 200 })
  }) as unknown as typeof fetch

  // A fixed, strictly-increasing clock. Real Date.now() has millisecond
  // resolution, so two joins in the same millisecond produced an identical
  // updated_at and failed the assertion below on roughly one run in six.
  let tick = 0
  const now = () => new Date(Date.UTC(2026, 7, 12, 10, 0, 0) + ++tick * 1000).toISOString()
  const store = new PostgrestStore({ supabaseUrl: 'https://project.supabase.co', serviceKey: 'service-key', fetchImpl, now })

  const first = await store.joinMediaGroup('grp-1', -100, 'file-a', 'weekly shop')
  assert.deepEqual(first.fileIds, ['file-a'])
  assert.equal(first.caption, 'weekly shop')

  const second = await store.joinMediaGroup('grp-1', -100, 'file-b', null)
  assert.deepEqual(second.fileIds, ['file-a', 'file-b'])
  assert.equal(second.caption, 'weekly shop', 'the first caption to arrive wins')
  assert.notEqual(second.updatedAt, first.updatedAt, 'each join bumps updated_at so a later join is detectable')

  assert.deepEqual(await store.getMediaGroup('grp-1'), second)

  await store.claimMediaGroup('grp-1')
  const claimed = await store.getMediaGroup('grp-1')
  assert.ok(claimed?.processedAt, 'claiming sets processed_at so the group is never processed twice')
})

test('logEvent posts a flattened row to intake_logs with return=minimal', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: ((url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch,
  })

  await store.logEvent({
    direction: 'inbound',
    stage: 'extract_text',
    messageType: 'text',
    chatId: -100,
    telegramUserId: 111,
    person: 'Shrey',
    telegramMsgId: 42,
    inputSummary: '84 aed lunch',
    model: 'google/gemini-2.5-flash-lite',
    usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    success: true,
    transactionId: 'tx-1',
  })

  assert.equal(calls[0].url, 'https://project.supabase.co/rest/v1/intake_logs')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal((calls[0].init.headers as Record<string, string>).prefer, 'return=minimal')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    direction: 'inbound',
    chat_id: -100,
    telegram_user_id: 111,
    person: 'Shrey',
    telegram_msg_id: 42,
    stage: 'extract_text',
    message_type: 'text',
    input_summary: '84 aed lunch',
    model: 'google/gemini-2.5-flash-lite',
    prompt_tokens: 120,
    completion_tokens: 40,
    total_tokens: 160,
    success: true,
    error: null,
    duration_ms: null,
    transaction_id: 'tx-1',
  })
})

test('getSetting returns null for a missing key rather than throwing', async () => {
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: (() => Promise.resolve(new Response('[]', { status: 200 }))) as unknown as typeof fetch,
  })
  assert.equal(await store.getSetting('tg_chat_id'), null)
})

test('a PostgREST error is surfaced, not swallowed', async () => {
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: (() => Promise.resolve(new Response('permission denied', { status: 403 }))) as unknown as typeof fetch,
  })

  await assert.rejects(() => store.getTransaction('tx-1'), /403/)
})

test('findPossibleDuplicate builds the deterministic ±1-day, same-account lookback filter', async () => {
  const calls: { url: string }[] = []
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: ((url: string) => {
      calls.push({ url })
      return Promise.resolve(new Response('[]', { status: 200 }))
    }) as unknown as typeof fetch,
  })

  await store.findPossibleDuplicate({ amount: 84, currency: 'AED', date: '2026-08-06', accountId: 'acc-enbd', excludeId: 'tx-9' })

  const url = calls[0].url
  assert.match(url, /deleted_at=is\.null/)
  assert.match(url, /amount=eq\.84/)
  assert.match(url, /currency=eq\.AED/)
  assert.match(url, /date=gte\.2026-08-05/, 'a 1-day-earlier resend still counts as the same spend')
  assert.match(url, /date=lte\.2026-08-07/, 'a 1-day-later resend still counts as the same spend')
  assert.match(url, /account_id=eq\.acc-enbd/)
  assert.match(url, /id=neq\.tx-9/, 'never matches itself')
  assert.match(url, /order=created_at\.desc/)
  assert.match(url, /limit=1/)
})

test('findPossibleDuplicate matches an unresolved account with account_id=is.null, not a wildcard', async () => {
  const calls: { url: string }[] = []
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: ((url: string) => {
      calls.push({ url })
      return Promise.resolve(new Response('[]', { status: 200 }))
    }) as unknown as typeof fetch,
  })

  await store.findPossibleDuplicate({ amount: 50, currency: 'AED', date: '2026-08-06', accountId: null, excludeId: 'tx-1' })

  assert.match(calls[0].url, /account_id=is\.null/)
})

test('findPossibleDuplicate returns the matched row, or null when nothing qualifies', async () => {
  const store = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: 'tx-1', note: 'Karak House', amount: 84, date: '2026-08-05' }]), { status: 200 })
      )) as unknown as typeof fetch,
  })

  const found = await store.findPossibleDuplicate({
    amount: 84,
    currency: 'AED',
    date: '2026-08-06',
    accountId: 'acc-enbd',
    excludeId: 'tx-2',
  })
  assert.deepEqual(found, { id: 'tx-1', note: 'Karak House', amount: 84, date: '2026-08-05' })

  const empty = new PostgrestStore({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-key',
    fetchImpl: (() => Promise.resolve(new Response('[]', { status: 200 }))) as unknown as typeof fetch,
  })
  assert.equal(
    await empty.findPossibleDuplicate({ amount: 84, currency: 'AED', date: '2026-08-06', accountId: null, excludeId: 'tx-2' }),
    null
  )
})
