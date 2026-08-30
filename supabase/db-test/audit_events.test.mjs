import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { BACKUP_TABLES, buildBackup } from '../functions/backup/dump.ts'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

const TARGET_ID = '10000000-0000-0000-0000-000000000001'
const EVIDENCE_ID = '20000000-0000-0000-0000-000000000001'
const REQUEST_ID = '30000000-0000-0000-0000-000000000001'
const CORRELATION_ID = '40000000-0000-0000-0000-000000000001'
const TELEGRAM_REF = `tgref:v1:${'a'.repeat(64)}`
const IDEMPOTENCY_REF = `sha256:${'b'.repeat(64)}`

function fixture(overrides = {}) {
  return {
    actorKind: 'service',
    actorAccessUserId: null,
    actorTelegramSenderRef: null,
    actorServiceCode: 'qa.audit_fixture_runner',
    actorSystemCode: null,
    surfaceCode: 'edge',
    actionCode: 'audit.qa_fixture.recorded',
    targetId: TARGET_ID,
    evidenceId: EVIDENCE_ID,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    causationEventId: null,
    idempotencyKeyRef: IDEMPOTENCY_REF,
    ...overrides,
  }
}

async function appendFixture(client, values = fixture()) {
  return client.query(
    `select * from public.record_audit_qa_fixture_v1(
      $1::text,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,
      $8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text
    )`,
    [
      values.actorKind,
      values.actorAccessUserId,
      values.actorTelegramSenderRef,
      values.actorServiceCode,
      values.actorSystemCode,
      values.surfaceCode,
      values.actionCode,
      values.targetId,
      values.evidenceId,
      values.requestId,
      values.correlationId,
      values.causationEventId,
      values.idempotencyKeyRef,
    ]
  )
}

async function appendAsService(client, values = fixture()) {
  await actAs(client, 'service_role')
  return appendFixture(client, values)
}

test('045 creates the typed append/read boundary with explicit least-privilege ACLs', async () => {
  await withTx(async (client) => {
    const { rows: table } = await client.query(`
      select
        c.relrowsecurity as rls_enabled,
        has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_any,
        has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as authenticated_any,
        has_table_privilege('service_role', c.oid, 'select') as service_select,
        has_table_privilege('service_role', c.oid, 'insert,update,delete') as service_write
      from pg_class c where c.oid = 'public.audit_events'::regclass
    `)
    assert.deepEqual(table[0], {
      rls_enabled: true,
      anon_any: false,
      authenticated_any: false,
      service_select: true,
      service_write: false,
    })

    const { rows: policies } = await client.query(`
      select cmd, roles, qual, with_check
      from pg_policies
      where schemaname = 'public' and tablename = 'audit_events'
    `)
    assert.equal(policies.length, 1)
    assert.equal(policies[0].cmd, 'ALL')
    assert.equal(policies[0].qual, 'false')
    assert.equal(policies[0].with_check, 'false')

    const { rows: functions } = await client.query(`
      select n.nspname as schema_name, p.proname, p.prosecdef,
        p.proconfig @> array['search_path=""']::text[] as empty_path,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (
        ('private', 'append_audit_event_v1'),
        ('public', 'record_audit_qa_fixture_v1'),
        ('public', 'audit_history_v1')
      )
      order by n.nspname, p.proname
    `)
    assert.deepEqual(
      functions.map((row) => ({
        schema: row.schema_name,
        name: row.proname,
        definer: row.prosecdef,
        emptyPath: row.empty_path,
        anon: row.anon_execute,
        authenticated: row.authenticated_execute,
        service: row.service_execute,
      })),
      [
        {
          schema: 'private',
          name: 'append_audit_event_v1',
          definer: true,
          emptyPath: true,
          anon: false,
          authenticated: false,
          service: false,
        },
        {
          schema: 'public',
          name: 'audit_history_v1',
          definer: true,
          emptyPath: true,
          anon: false,
          authenticated: true,
          service: false,
        },
        {
          schema: 'public',
          name: 'record_audit_qa_fixture_v1',
          definer: true,
          emptyPath: true,
          anon: false,
          authenticated: false,
          service: true,
        },
      ]
    )

    const { rows: privateAcl } = await client.query(`
      select
        has_schema_privilege('authenticated', 'private', 'usage') as authenticated_usage,
        has_schema_privilege('anon', 'private', 'usage') as anon_usage,
        has_schema_privilege('service_role', 'private', 'usage') as service_usage
    `)
    assert.deepEqual(privateAcl[0], {
      authenticated_usage: true,
      anon_usage: false,
      service_usage: false,
    })
  })
})

test('raw API clients cannot append, read, update, or delete audit rows', async () => {
  await withTx(async (client) => {
    const inserted = await appendAsService(client)
    const eventId = inserted.rows[0].event_id

    await client.query('reset role')
    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(client, () => client.query('select * from public.audit_events'), /permission denied/i)
    await expectReject(
      client,
      () => client.query(`insert into public.audit_events(event_id) values(gen_random_uuid())`),
      /permission denied/i
    )
    await expectReject(
      client,
      () => client.query('update public.audit_events set recorded_at = now() where event_id = $1', [eventId]),
      /permission denied/i
    )
    await expectReject(
      client,
      () => client.query('delete from public.audit_events where event_id = $1', [eventId]),
      /permission denied/i
    )
    await expectReject(client, () => appendFixture(client), /permission denied/i)

    await client.query('reset role')
    await actAs(client, 'anon')
    await expectReject(client, () => client.query('select * from public.audit_events'), /permission denied/i)
    await expectReject(
      client,
      () => client.query(`select * from public.audit_history_v1(null, null, 100)`),
      /permission denied/i
    )
  })
})

test('trusted append succeeds and immutable rows reject owner and accidental service mutation', async () => {
  await withTx(async (client) => {
    const inserted = await appendAsService(client)
    assert.equal(inserted.rows[0].replayed, false)
    const eventId = inserted.rows[0].event_id

    await client.query('reset role')
    const before = await client.query('select to_jsonb(e) as row from public.audit_events e where event_id = $1', [eventId])

    await expectReject(
      client,
      () => client.query('update public.audit_events set recorded_at = recorded_at + interval \'1 second\' where event_id = $1', [eventId]),
      /immutable/i
    )
    await expectReject(
      client,
      () => client.query('delete from public.audit_events where event_id = $1', [eventId]),
      /immutable/i
    )

    await client.query('grant update, delete on public.audit_events to service_role')
    await actAs(client, 'service_role')
    await expectReject(
      client,
      () => client.query('update public.audit_events set recorded_at = recorded_at + interval \'1 second\' where event_id = $1', [eventId]),
      /immutable/i
    )
    await expectReject(
      client,
      () => client.query('delete from public.audit_events where event_id = $1', [eventId]),
      /immutable/i
    )

    await client.query('reset role')
    const after = await client.query('select to_jsonb(e) as row from public.audit_events e where event_id = $1', [eventId])
    assert.deepEqual(after.rows[0].row, before.rows[0].row)
  })
})

test('all four actor types remain separate and actor never becomes owner, party, category, or authorization', async () => {
  await withTx(async (client) => {
    const actors = [
      fixture({
        actorKind: 'authenticated_user',
        actorAccessUserId: SHREY_ID,
        actorServiceCode: null,
        surfaceCode: 'portal',
        idempotencyKeyRef: `sha256:${'1'.repeat(64)}`,
      }),
      fixture({
        actorKind: 'telegram_sender',
        actorTelegramSenderRef: TELEGRAM_REF,
        actorServiceCode: null,
        surfaceCode: 'telegram',
        idempotencyKeyRef: `sha256:${'2'.repeat(64)}`,
      }),
      fixture({ idempotencyKeyRef: `sha256:${'3'.repeat(64)}` }),
      fixture({
        actorKind: 'system',
        actorServiceCode: null,
        actorSystemCode: 'qa.audit_substrate',
        surfaceCode: 'migration',
        idempotencyKeyRef: `sha256:${'4'.repeat(64)}`,
      }),
    ]

    for (const actor of actors) {
      await appendAsService(client, actor)
      await client.query('reset role')
    }

    const { rows } = await client.query(`
      select actor_kind, actor_access_user_id, actor_telegram_sender_ref,
        actor_service_code, actor_system_code
      from public.audit_events order by actor_kind
    `)
    assert.deepEqual(rows.map((row) => row.actor_kind), [
      'authenticated_user',
      'service',
      'system',
      'telegram_sender',
    ])
    assert.equal(rows.find((row) => row.actor_kind === 'authenticated_user').actor_access_user_id, SHREY_ID)
    assert.equal(rows.find((row) => row.actor_kind === 'telegram_sender').actor_telegram_sender_ref, TELEGRAM_REF)
    assert.equal(rows.find((row) => row.actor_kind === 'service').actor_service_code, 'qa.audit_fixture_runner')
    assert.equal(rows.find((row) => row.actor_kind === 'system').actor_system_code, 'qa.audit_substrate')

    const { rows: forbiddenColumns } = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'audit_events'
        and column_name in ('owner', 'owner_id', 'party_id', 'economic_party_id', 'category', 'category_id')
    `)
    assert.deepEqual(forbiddenColumns, [])

    const { rows: authPredicates } = await client.query(`
      select policyname from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(owner|party|category|actor|telegram)'
    `)
    assert.deepEqual(authPredicates, [], 'RLS authorization must not use actor/owner/party/category/Telegram fields')
  })
})

test('typed action, target, evidence, actor, causation, and minimized payload rules reject invalid input', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    await expectReject(
      client,
      () => appendFixture(client, fixture({ actionCode: 'transaction.corrected' })),
      /ACTION_NOT_ALLOWED/i
    )
    await expectReject(
      client,
      () => appendFixture(client, fixture({ idempotencyKeyRef: 'raw-secret-token' })),
      /idempotency|check constraint/i
    )
    await expectReject(
      client,
      () =>
        appendFixture(
          client,
          fixture({
            actorKind: 'telegram_sender',
            actorTelegramSenderRef: '123456789',
            actorServiceCode: null,
            surfaceCode: 'telegram',
          })
        ),
      /actor_shape|check constraint/i
    )
    await expectReject(
      client,
      () =>
        appendFixture(
          client,
          fixture({
            actorKind: 'authenticated_user',
            actorAccessUserId: OUTSIDER_ID,
            actorServiceCode: null,
            surfaceCode: 'portal',
          })
        ),
      /ACTOR_NOT_HOUSEHOLD_MEMBER/i
    )

    await client.query('reset role')
    const recorded = await appendAsService(client, fixture({ idempotencyKeyRef: `sha256:${'5'.repeat(64)}` }))
    await client.query('reset role')

    await expectReject(
      client,
      () => client.query(`
        insert into public.audit_events
        select gen_random_uuid(), occurred_at, recorded_at, producer_code, producer_version,
          actor_kind, actor_access_user_id, actor_telegram_sender_ref, actor_service_code,
          actor_system_code, surface_code, action_code, target_kind, gen_random_uuid(),
          target_version_before, target_version_after, evidence_kind, evidence_id,
          evidence_version, request_id, correlation_id, causation_event_id,
          $2, outcome, outcome_code,
          '{"authorization":"Bearer secret","request_body":{"anything":true}}'::jsonb,
          sensitivity_class, schema_version, redaction_version, history_scope, payload_digest
        from public.audit_events where event_id = $1
      `, [recorded.rows[0].event_id, `sha256:${'6'.repeat(64)}`]),
      /action_evidence|check constraint/i
    )

    await actAs(client, 'service_role')
    await expectReject(
      client,
      () =>
        appendFixture(
          client,
          fixture({
            actionCode: 'audit.qa_fixture.verified',
            causationEventId: '99999999-9999-9999-9999-999999999999',
            idempotencyKeyRef: `sha256:${'7'.repeat(64)}`,
          })
        ),
      /CAUSATION_INVALID/i
    )
  })
})

test('member read is redacted while anonymous and outsider reads are denied', async () => {
  await withTx(async (client) => {
    await appendAsService(
      client,
      fixture({
        actorKind: 'telegram_sender',
        actorTelegramSenderRef: TELEGRAM_REF,
        actorServiceCode: null,
        surfaceCode: 'telegram',
      })
    )

    await client.query('reset role')
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows } = await client.query(`select * from public.audit_history_v1('audit.qa_fixture', $1, 20)`, [
      TARGET_ID,
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].actor_kind, 'telegram_sender')
    assert.equal(rows[0].actor_access_user_id, null)
    assert.equal(rows[0].actor_code, null)
    assert.equal(rows[0].has_private_actor_reference, true)
    assert.equal(rows[0].sensitivity_class, 'household_redacted')
    assert.equal('actor_telegram_sender_ref' in rows[0], false)
    assert.doesNotMatch(JSON.stringify(rows[0]), /tgref:v1|a{64}/)

    await client.query('reset role')
    await actAs(client, 'authenticated', OUTSIDER_ID)
    await expectReject(
      client,
      () => client.query(`select * from public.audit_history_v1(null, null, 100)`),
      /AUDIT_HISTORY_FORBIDDEN/i
    )

    await client.query('reset role')
    await actAs(client, 'anon')
    await expectReject(
      client,
      () => client.query(`select * from public.audit_history_v1(null, null, 100)`),
      /permission denied/i
    )
  })
})

test('exact replay returns the original success, collisions fail, and distinct actions do not collapse', async () => {
  await withTx(async (client) => {
    const first = await appendAsService(client)
    const replay = await appendFixture(client)
    assert.equal(first.rows[0].replayed, false)
    assert.equal(replay.rows[0].replayed, true)
    assert.equal(replay.rows[0].event_id, first.rows[0].event_id)

    await expectReject(
      client,
      () => appendFixture(client, fixture({ evidenceId: '20000000-0000-0000-0000-000000000099' })),
      /IDEMPOTENCY_CONFLICT/i
    )

    const distinct = await appendFixture(client, fixture({ idempotencyKeyRef: `sha256:${'8'.repeat(64)}` }))
    assert.notEqual(distinct.rows[0].event_id, first.rows[0].event_id)

    const verified = await appendFixture(
      client,
      fixture({
        actionCode: 'audit.qa_fixture.verified',
        causationEventId: first.rows[0].event_id,
      })
    )
    assert.notEqual(verified.rows[0].event_id, first.rows[0].event_id)

    await client.query('reset role')
    const { rows: counts } = await client.query(`
      select action_code, count(*)::integer as count
      from public.audit_events group by action_code order by action_code
    `)
    assert.deepEqual(counts, [
      { action_code: 'audit.qa_fixture.recorded', count: 2 },
      { action_code: 'audit.qa_fixture.verified', count: 1 },
    ])
  })
})

test('append failure rolls back the enclosing QA reference operation atomically', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    await client.query('savepoint mutation_boundary')
    await appendFixture(client)
    await assert.rejects(
      appendFixture(client, fixture({ idempotencyKeyRef: 'not-a-safe-reference' })),
      /idempotency|check constraint/i
    )
    await client.query('rollback to savepoint mutation_boundary')
    await client.query('reset role')
    const { rows } = await client.query('select count(*)::integer as count from public.audit_events')
    assert.equal(rows[0].count, 0)
  })
})

test('045 is rerunnable without rewriting existing immutable evidence', async () => {
  await withTx(async (client) => {
    const inserted = await appendAsService(client)
    await client.query('reset role')
    const before = await client.query(
      'select ctid, to_jsonb(e) as row from public.audit_events e where event_id = $1',
      [inserted.rows[0].event_id]
    )

    const sql = readFileSync(new URL('../schema/045_immutable_audit_substrate.sql', import.meta.url), 'utf8')
    const rerunSql = sql
      .replace(/(^|\r?\n)begin;\r?\n/i, '$1')
      .replace(/(\r?\n)commit;\r?\n/i, '$1')
    await client.query(rerunSql)

    const after = await client.query(
      'select ctid, to_jsonb(e) as row from public.audit_events e where event_id = $1',
      [inserted.rows[0].event_id]
    )
    assert.deepEqual(after.rows[0].row, before.rows[0].row)
    assert.equal(after.rows[0].ctid, before.rows[0].ctid)
  })
})

test('encrypted-backup manifest includes audit evidence and a restore preserves content and immutability', async () => {
  await withTx(async (client) => {
    const inserted = await appendAsService(client)
    await client.query('reset role')
    // PostgREST exports each row as JSON, so timestamptz values remain exact
    // strings. Fetch to_jsonb here as well; selecting scalar columns through
    // node-postgres would coerce them to JS Date and truncate microseconds,
    // which is not the production backup transport.
    const { rows: sourceJson } = await client.query(
      'select to_jsonb(e) as row from public.audit_events e where event_id = $1',
      [inserted.rows[0].event_id]
    )
    const sourceRows = sourceJson.map(({ row }) => row)

    const backup = await buildBackup(
      async (table) => (table === 'audit_events' ? sourceRows : []),
      '045_immutable_audit_substrate',
      () => '2026-08-31T00:00:00.000Z'
    )
    assert.ok(BACKUP_TABLES.some((table) => table.name === 'audit_events' && table.financial))
    assert.equal(backup.meta.row_counts.audit_events, 1)
    assert.equal(backup.tables.audit_events[0].event_id, inserted.rows[0].event_id)

    await client.query(`
      create temporary table restored_audit_events
        (like public.audit_events including all)
        on commit drop
    `)
    await client.query(`
      create trigger restored_audit_events_immutable
      before update or delete on restored_audit_events
      for each row execute function private.reject_audit_event_mutation()
    `)
    await client.query(
      `insert into restored_audit_events
       select (jsonb_populate_record(null::restored_audit_events, $1::jsonb)).*`,
      [JSON.stringify(backup.tables.audit_events[0])]
    )

    const { rows: restored } = await client.query(
      'select to_jsonb(r) as row from restored_audit_events r where event_id = $1',
      [inserted.rows[0].event_id]
    )
    const { rows: source } = await client.query(
      'select to_jsonb(e) as row from public.audit_events e where event_id = $1',
      [inserted.rows[0].event_id]
    )
    assert.deepEqual(restored[0].row, source[0].row)

    await expectReject(
      client,
      () => client.query('update restored_audit_events set recorded_at = now()'),
      /immutable/i
    )
    await expectReject(client, () => client.query('delete from restored_audit_events'), /immutable/i)
  })
})
