import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'

import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, TEST_DATABASE_URL, withTx } from './helpers.mjs'

const { Client } = pg
const TARGET = '2026-08-24'
const INVOKED_AT = '2026-08-24T22:00:00.000Z'
const SNAPSHOT_AT = '2026-08-24T22:05:00.000Z'
const FX_FETCHED_AT = '2026-08-24T22:00:00.000Z'
const FX_AS_OF = '2026-08-24T21:00:00.000Z'

async function asService(client) {
  await actAs(client, 'service_role')
}

async function account(client, overrides = {}) {
  const row = {
    name: 'Cash', owner: 'Shrey', type: 'cash', is_liability: false,
    currency: 'AED', value: 100, updated_at: '2026-08-24T12:00:00Z',
    ...overrides,
  }
  const { rows } = await client.query(
    `insert into accounts (
      name, owner, type, is_liability, currency, value, ticker, quantity,
      avg_cost, last_price, updated_at, price_updated_at, price_quote_at, price_source
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [row.name, row.owner, row.type, row.is_liability, row.currency, row.value,
      row.ticker ?? null, row.quantity ?? null, row.avg_cost ?? null, row.last_price ?? null,
      row.updated_at, row.price_updated_at ?? null, row.price_quote_at ?? null, row.price_source ?? null]
  )
  return rows[0].id
}

async function claim(client, { target = TARGET, trigger = 'manual_recovery', invocation = crypto.randomUUID(), invokedAt = INVOKED_AT } = {}) {
  const { rows } = await client.query(
    `select * from claim_nw_snapshot_run($1,$2,$3,$4)`,
    [target, trigger, invocation, invokedAt]
  )
  return { ...rows[0], invocation }
}

async function event(client, claimRow, kind, outcome, evidence) {
  return client.query(
    `select record_nw_snapshot_attempt_event($1,$2,$3,$4,$5,$6,$7)`,
    [claimRow.run_id, claimRow.attempt_number, claimRow.invocation, kind, outcome, evidence, SNAPSHOT_AT]
  )
}

async function sourceEvidence(client, claimRow, { updated = [], failed = [], fxFetchedAt = FX_FETCHED_AT, fxAsOf = FX_AS_OF, rates = { AED: 1, USD: 3.6725, INR: 0.04 } } = {}) {
  await client.query(`update settings set value=$1, updated_at=$2 where key='fx_rates'`, [rates, fxFetchedAt])
  await event(client, claimRow, 'fx_refresh', 'succeeded', {
    provider: 'open.er-api', rates, fetched_at: fxFetchedAt, provider_as_of: fxAsOf,
  })
  await event(client, claimRow, 'price_refresh', failed.length ? 'partial' : 'succeeded', { updated, failed })
}

async function capture(client, claimRow, snapshotAt = SNAPSHOT_AT) {
  const { rows } = await client.query(
    `select capture_nw_snapshot_v1($1,$2,$3,$4,$5) as result`,
    [claimRow.run_id, claimRow.attempt_number, claimRow.invocation, snapshotAt, 'test-shr-113']
  )
  return rows[0].result
}

async function quotedAccount(client, quoteAt, overrides = {}) {
  const fetchedAt = overrides.price_updated_at ?? '2026-08-24T22:01:00Z'
  const id = await account(client, {
    name: 'VOO', type: 'investment', currency: 'USD', value: 20,
    ticker: 'VOO', quantity: 2, avg_cost: 8, last_price: 10,
    updated_at: fetchedAt, price_updated_at: fetchedAt, price_quote_at: quoteAt,
    price_source: 'yahoo', ...overrides,
  })
  return {
    id, ticker: 'VOO', price: 10, source: 'yahoo',
    fetched_at: fetchedAt, quote_at: quoteAt,
  }
}

test('Dubai boundary derives the just-ended reporting date without UTC slicing', async () => {
  await withTx(async (client) => {
    await asService(client)
    const before = await claim(client, { target: null, trigger: 'scheduled', invokedAt: '2026-08-24T19:59:59Z' })
    const after = await claim(client, { target: null, trigger: 'scheduled', invokedAt: '2026-08-24T20:00:00Z' })
    const dubaiDate = (value) => value.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
    assert.equal(dubaiDate(before.target_day), '2026-08-23')
    assert.equal(dubaiDate(after.target_day), '2026-08-24')
  })
})

test('complete snapshot publishes exact canonical assets, liabilities and net worth once', async () => {
  await withTx(async (client) => {
    await asService(client)
    await account(client, { value: 200 })
    await account(client, { name: 'Card', type: 'credit_card', is_liability: true, value: 50 })
    const run = await claim(client)
    await sourceEvidence(client, run)
    const result = await capture(client, run)
    assert.equal(result.state, 'published')
    assert.equal(result.quality_status, 'complete')
    const { rows } = await client.query(`select * from nw_daily where run_id=$1`, [run.run_id])
    assert.equal(Number(rows[0].assets_aed), 200)
    assert.equal(Number(rows[0].liabilities_aed), 50)
    assert.equal(Number(rows[0].total_aed), 150)
    assert.match(rows[0].input_digest, /^[0-9a-f]{64}$/)
    assert.equal((await client.query(`select count(*) from nw_snapshot_items where run_id=$1`, [run.run_id])).rows[0].count, '2')

    const replay = await claim(client, { invocation: crypto.randomUUID() })
    assert.equal(replay.claim_state, 'already_published')
    assert.equal((await client.query(`select count(*) from nw_daily where day=$1`, [TARGET])).rows[0].count, '1')
  })
})

test('capture persists a valuation close and rejects a pre-close timestamp', async () => {
  await withTx(async (client) => {
    await asService(client)
    await account(client)
    const run = await claim(client)
    await sourceEvidence(client, run)
    await expectReject(
      client,
      () => capture(client, run, '2026-08-24T19:59:59Z'),
      /Dubai target-day close/
    )
    assert.equal((await client.query(`select count(*) from nw_daily where run_id=$1`, [run.run_id])).rows[0].count, '0')
  })
})

test('manual investment and older valid bank/liability values publish Provisional with age evidence', async () => {
  await withTx(async (client) => {
    await asService(client)
    await account(client, { name: 'Manual gold', type: 'investment', value: 100, updated_at: '2026-08-01T00:00:00Z' })
    await account(client, { name: 'Old bank', value: 200, updated_at: '2026-08-01T00:00:00Z' })
    await account(client, { name: 'Old loan', type: 'loan', is_liability: true, value: 50, updated_at: '2026-08-01T00:00:00Z' })
    const run = await claim(client)
    await sourceEvidence(client, run)
    const result = await capture(client, run)
    assert.equal(result.quality_status, 'provisional')
    const { rows } = await client.query(`select quality_evidence from nw_snapshot_items where run_id=$1 order by account_type`, [run.run_id])
    const reasons = rows.map((row) => row.quality_evidence.reason)
    assert.ok(reasons.includes('manual_investment_value'))
    assert.equal(reasons.filter((reason) => reason === 'older_manual_balance').length, 2)
  })
})

test('quoted-price policy uses provider as-of at the 36h/96h boundaries', async () => {
  const cases = [
    { hours: 36, expected: 'complete' },
    { hours: 36 + 1 / 3600, expected: 'provisional' },
    { hours: 96, expected: 'provisional' },
    { hours: 96 + 1 / 3600, expected: 'skipped_incomplete' },
  ]
  for (const [index, fixture] of cases.entries()) {
    await withTx(async (client) => {
      await asService(client)
      const snapshot = new Date(`2026-08-${String(20 + index).padStart(2, '0')}T22:05:00Z`)
      const target = snapshot.toISOString().slice(0, 10)
      const quoteAt = new Date(snapshot.getTime() - fixture.hours * 3600_000).toISOString()
      const updated = await quotedAccount(client, quoteAt, { price_updated_at: snapshot.toISOString(), updated_at: snapshot.toISOString() })
      const run = await claim(client, { target, invokedAt: new Date(snapshot.getTime() + 3600_000).toISOString() })
      await sourceEvidence(client, run, { updated: [updated], fxFetchedAt: snapshot.toISOString(), fxAsOf: snapshot.toISOString() })
      const result = await capture(client, run, snapshot.toISOString())
      assert.equal(result.state === 'published' ? result.quality_status : result.state, fixture.expected)
    })
  }
})

test('missing provider timestamp, stale FX, missing FX and canonical-incomplete account skip without a partial point', async () => {
  const cases = [
    { name: 'provider timestamp missing', setup: async (client) => {
      const updated = await quotedAccount(client, null)
      return { updated: [{ ...updated, quote_at: null }] }
    } },
    { name: 'stale FX', setup: async (client) => { await account(client); return { fxFetchedAt: '2026-08-24T15:00:00Z' } } },
    { name: 'missing FX', setup: async (client) => { await account(client, { currency: 'GBP' }); return {} } },
    { name: 'canonical incomplete liability', setup: async (client) => { await account(client, { type: 'loan', is_liability: false }); return {} } },
  ]
  for (const fixture of cases) {
    await withTx(async (client) => {
      await asService(client)
      const options = await fixture.setup(client)
      const run = await claim(client)
      await sourceEvidence(client, run, options)
      const result = await capture(client, run)
      assert.equal(result.state, 'skipped_incomplete', fixture.name)
      assert.equal((await client.query(`select count(*) from nw_daily where run_id=$1`, [run.run_id])).rows[0].count, '0')
      assert.equal((await client.query(`select status from nw_snapshot_runs where id=$1`, [run.run_id])).rows[0].status, 'skipped_incomplete')
    })
  }
})

test('partial price refresh uses <=96h prior quote provisionally and skips unusable fallback', async () => {
  for (const [hours, expected] of [[48, 'provisional'], [97, 'skipped_incomplete']]) {
    await withTx(async (client) => {
      await asService(client)
      const quoteAt = new Date(Date.parse(SNAPSHOT_AT) - hours * 3600_000).toISOString()
      const updated = await quotedAccount(client, quoteAt)
      const run = await claim(client)
      await sourceEvidence(client, run, { failed: [{ id: updated.id, ticker: 'VOO', error: 'timeout' }] })
      const result = await capture(client, run)
      assert.equal(result.state === 'published' ? result.quality_status : result.state, expected)
    })
  }
})

test('failed attempt evidence remains append-only when manual recovery retries and later publishes', async () => {
  await withTx(async (client) => {
    await asService(client)
    await account(client)
    const first = await claim(client)
    await event(client, first, 'failed', 'failed', { phase: 'fx_refresh', error: 'timeout' })
    const second = await claim(client, { invocation: crypto.randomUUID(), invokedAt: '2026-08-24T22:15:00Z' })
    assert.equal(Number(second.attempt_number), 2)
    await sourceEvidence(client, second)
    assert.equal((await capture(client, second)).state, 'published')
    const { rows } = await client.query(
      `select attempt_number,event_kind,outcome,evidence from nw_snapshot_attempt_events where run_id=$1 order by attempt_number,event_kind`,
      [first.run_id]
    )
    assert.ok(rows.some((row) => row.attempt_number === 1 && row.event_kind === 'failed' && row.evidence.error === 'timeout'))
    await client.query('reset role')
    await expectReject(client, () => client.query(`update nw_snapshot_attempt_events set evidence='{}' where run_id=$1`, [first.run_id]), /immutable/)
    await expectReject(client, () => client.query(`update nw_snapshot_items set owner='Other' where run_id=$1`, [first.run_id]), /immutable/)
    await expectReject(client, () => client.query(`update nw_snapshot_runs set source_version='changed' where id=$1`, [first.run_id]), /immutable/)
  })
})

test('normal recovery cannot replace an existing legacy point', async () => {
  await withTx(async (client) => {
    await asService(client)
    await client.query(`insert into nw_daily(day,total_aed,assets_aed,liabilities_aed) values($1,123,200,77)`, [TARGET])
    const result = await claim(client)
    assert.equal(result.claim_state, 'existing_legacy_point')
    assert.equal(result.run_id, null)
    const { rows } = await client.query(`select total_aed,run_id from nw_daily where day=$1`, [TARGET])
    assert.equal(rows[0].total_aed, '123')
    assert.equal(rows[0].run_id, null)
  })
})

test('authenticated member reads history but cannot fabricate it; outsider and anon are denied', async () => {
  await withTx(async (client) => {
    await asService(client)
    await client.query(`insert into nw_daily(day,total_aed,assets_aed,liabilities_aed) values($1,100,100,0)`, [TARGET])
    await actAs(client, 'authenticated', SHREY_ID)
    assert.equal((await client.query(`select count(*) from nw_daily`)).rows[0].count, '1')
    await expectReject(client, () => client.query(`insert into nw_daily(day,total_aed) values('2026-08-23',1)`), /permission denied/i)
    await expectReject(client, () => client.query(`update nw_daily set total_aed=1`), /permission denied/i)
    await expectReject(client, () => client.query(`select * from claim_nw_snapshot_run(null,'scheduled',$1,now())`, [crypto.randomUUID()]), /permission denied/i)

    await actAs(client, 'authenticated', OUTSIDER_ID)
    assert.deepEqual((await client.query(`select * from nw_daily`)).rows, [])
    await actAs(client, 'anon')
    await expectReject(client, () => client.query(`select * from nw_daily`), /permission denied/i)
  })
})

test('nw_snapshots stays empty and read-only', async () => {
  await withTx(async (client) => {
    await asService(client)
    assert.equal((await client.query(`select count(*) from nw_snapshots`)).rows[0].count, '0')
    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(client, () => client.query(`insert into nw_snapshots(month,total_aed) values('2026-08-01',1)`), /permission denied/i)
  })
})

test('concurrent claims have one active attempt and a deterministic busy loser', async () => {
  const clients = [new Client({ connectionString: TEST_DATABASE_URL }), new Client({ connectionString: TEST_DATABASE_URL })]
  const day = `2001-01-${String(1 + Math.floor(Math.random() * 27)).padStart(2, '0')}`
  await Promise.all(clients.map((client) => client.connect()))
  try {
    await Promise.all(clients.map((client) => client.query('set role service_role')))
    const ids = [crypto.randomUUID(), crypto.randomUUID()]
    const results = await Promise.all(clients.map((client, index) => client.query(
      `select * from claim_nw_snapshot_run($1,'manual_recovery',$2,'2026-08-24T22:00:00Z')`, [day, ids[index]]
    )))
    assert.deepEqual(results.map((result) => result.rows[0].claim_state).sort(), ['busy', 'claimed'])
    const { rows } = await clients[0].query(
      `select count(*) from nw_snapshot_attempt_events e join nw_snapshot_runs r on r.id=e.run_id
       where r.target_day=$1 and e.event_kind='started'`, [day]
    )
    assert.equal(rows[0].count, '1')
  } finally {
    await Promise.all(clients.map((client) => client.end()))
  }
})

test('catalog exposes service-only invoker contracts and read-only provenance tables', async () => {
  await withTx(async (client) => {
    const { rows: functions } = await client.query(`
      select p.proname,p.prosecdef,p.proconfig @> array['search_path=""']::text[] as empty_path,
        has_function_privilege('service_role',p.oid,'execute') as service_execute,
        has_function_privilege('authenticated',p.oid,'execute') as auth_execute,
        has_function_privilege('anon',p.oid,'execute') as anon_execute
      from pg_proc p where p.pronamespace='public'::regnamespace
        and p.proname in ('claim_nw_snapshot_run','record_nw_snapshot_attempt_event','capture_nw_snapshot_v1','evaluate_nw_snapshot_policy_v1')
    `)
    assert.equal(functions.length, 4)
    for (const fn of functions) {
      assert.equal(fn.prosecdef, false)
      assert.equal(fn.empty_path, true)
      assert.equal(fn.service_execute, true)
      assert.equal(fn.auth_execute, false)
      assert.equal(fn.anon_execute, false)
    }
    const { rows: tables } = await client.query(`
      select c.relname,
        has_table_privilege('authenticated',c.oid,'select') as auth_select,
        has_table_privilege('authenticated',c.oid,'insert,update,delete') as auth_write,
        has_table_privilege('anon',c.oid,'select,insert,update,delete') as anon_access
      from pg_class c where c.oid in (
        'public.nw_snapshot_runs'::regclass,'public.nw_snapshot_attempt_events'::regclass,
        'public.nw_snapshot_items'::regclass,'public.nw_daily'::regclass,'public.nw_snapshots'::regclass
      )
    `)
    for (const table of tables) {
      assert.equal(table.auth_select, true, table.relname)
      assert.equal(table.auth_write, false, table.relname)
      assert.equal(table.anon_access, false, table.relname)
    }
  })
})

test('Supabase security-advisor catalog shapes are clean for SHR-113 objects', async () => {
  await withTx(async (client) => {
    const { rows: tables } = await client.query(`
      select c.relname,c.relrowsecurity,
        exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p') as has_primary_key
      from pg_class c
      where c.oid in (
        'public.nw_snapshot_runs'::regclass,
        'public.nw_snapshot_attempt_events'::regclass,
        'public.nw_snapshot_items'::regclass,
        'public.nw_daily'::regclass,
        'public.nw_snapshots'::regclass
      )
    `)
    assert.equal(tables.length, 5)
    for (const table of tables) {
      assert.equal(table.relrowsecurity, true, `${table.relname}: advisor 0013`)
      assert.equal(table.has_primary_key, true, `${table.relname}: advisor 0004`)
    }

    const { rows: writePolicies } = await client.query(`
      select tablename,policyname,cmd from pg_policies
      where schemaname='public'
        and tablename in ('nw_snapshot_runs','nw_snapshot_attempt_events','nw_snapshot_items','nw_daily','nw_snapshots')
        and cmd <> 'SELECT'
    `)
    assert.deepEqual(writePolicies, [], 'no permissive browser mutation policy may remain')

    const { rows: unsafeFunctions } = await client.query(`
      select p.proname
      from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname in ('claim_nw_snapshot_run','record_nw_snapshot_attempt_event','capture_nw_snapshot_v1','evaluate_nw_snapshot_policy_v1')
        and (
          not (p.proconfig @> array['search_path=""']::text[])
          or (p.prosecdef and (
            has_function_privilege('anon',p.oid,'execute')
            or has_function_privilege('authenticated',p.oid,'execute')
          ))
        )
    `)
    assert.deepEqual(unsafeFunctions, [], 'advisor 0011/0028/0029 shapes must be absent')
  })
})
