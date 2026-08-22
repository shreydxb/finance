import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'

import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, TEST_DATABASE_URL, withTx } from './helpers.mjs'

const { Client } = pg
const RPC_NAMES = [
  'create_pending_action',
  'bind_pending_action_prompt',
  'claim_pending_action',
  'apply_pending_action',
  'cancel_pending_action',
  'expire_pending_action',
]

async function createAction(client, requestKey = 'telegram:-100:10:111:undo_transaction') {
  const { rows } = await client.query(
    `select * from public.create_pending_action($1, $2::jsonb, $3, $4, $5)`,
    ['undo_transaction', JSON.stringify({ transactionId: 'tx-1' }), -100, 111, requestKey]
  )
  return rows[0]
}

async function bindAction(client, id, promptId = 5001) {
  const { rows } = await client.query(
    `select * from public.bind_pending_action_prompt($1, 111, -100, $2)`,
    [id, promptId]
  )
  return rows[0]
}

test('pending_actions is policy-free and API roles have no direct table privileges', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        c.relrowsecurity,
        has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') as anon_any,
        has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger') as authenticated_any,
        has_table_privilege('service_role', c.oid, 'select') as service_select,
        has_table_privilege('service_role', c.oid, 'insert,update,delete,truncate,references,trigger') as service_write
      from pg_class as c
      where c.oid = 'public.pending_actions'::regclass
    `)

    assert.equal(rows[0].relrowsecurity, true)
    assert.equal(rows[0].anon_any, false)
    assert.equal(rows[0].authenticated_any, false)
    assert.equal(rows[0].service_select, true)
    assert.equal(rows[0].service_write, false)

    const { rows: apiAcl } = await client.query(`
      select
        case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
        acl.privilege_type
      from pg_class as c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
      where c.oid = 'public.pending_actions'::regclass
        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated', 'service_role'))
      order by grantee, privilege_type
    `)
    assert.deepEqual(apiAcl, [{ grantee: 'service_role', privilege_type: 'SELECT' }])

    const policies = await client.query(`select * from pg_policy where polrelid = 'public.pending_actions'::regclass`)
    assert.equal(policies.rows.length, 0)

    for (const column of ['kind', 'payload', 'chat_id', 'requested_by', 'request_key', 'created_at', 'expires_at', 'prompt_msg_id', 'claimed_at', 'claimed_by', 'resolved_at', 'resolution']) {
      const { rows: privilege } = await client.query(
        `select has_column_privilege('service_role', 'public.pending_actions', $1, 'update') as can_update`,
        [column]
      )
      assert.equal(privilege[0].can_update, false, `service_role must not directly update ${column}`)
    }
  })
})

test('every pending-action RPC is a pinned SECURITY DEFINER executable only by service_role', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        p.proname,
        p.prosecdef,
        p.proconfig @> array['search_path=""']::text[] as search_path_is_empty,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_execute
      from pg_proc as p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = any($1::text[])
      order by p.proname
    `, [RPC_NAMES])

    assert.equal(rows.length, RPC_NAMES.length)
    for (const row of rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`)
      assert.equal(row.search_path_is_empty, true, `${row.proname} must pin an empty search_path`)
      assert.equal(row.anon_execute, false)
      assert.equal(row.authenticated_execute, false)
      assert.equal(row.service_execute, true)
    }

    const advisorExposure = rows.filter((row) => row.anon_execute || row.authenticated_execute)
    assert.deepEqual(advisorExposure, [], 'advisor 0028/0029 exposure shape must be absent')
  })
})

test('anonymous, household-member, and authenticated outsider cannot read/write or call RPCs', async () => {
  for (const [role, userId] of [
    ['anon', null],
    ['authenticated', SHREY_ID],
    ['authenticated', OUTSIDER_ID],
  ]) {
    await withTx(async (client) => {
      await actAs(client, role, userId)
      await expectReject(client, () => client.query('select * from public.pending_actions'), /permission denied/i)
      await expectReject(
        client,
        () => client.query(`select * from public.create_pending_action('x', '{}'::jsonb, -100, 111, 'key')`),
        /permission denied/i
      )
    })
  }
})

test('service workflow is idempotent, prompt-bind-only, identity-bound, and non-reopenable', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    const created = await createAction(client)
    const replay = await createAction(client)
    assert.equal(created.id, replay.id)

    await expectReject(
      client,
      () => client.query(
        `select * from public.create_pending_action('undo_transaction', '{"transactionId":"different"}'::jsonb, -100, 111, 'telegram:-100:10:111:undo_transaction')`
      ),
      /different proposal/i
    )

    const bound = await bindAction(client, created.id)
    assert.equal(Number(bound.prompt_msg_id), 5001)
    assert.equal((await bindAction(client, created.id, 5002)), undefined, 'prompt binding must be one-time')

    for (const args of [
      [222, -100, 5001],
      [111, -101, 5001],
      [111, -100, 5002],
    ]) {
      const { rows } = await client.query(
        `select * from public.claim_pending_action($1, $2, $3, $4)`,
        [created.id, ...args]
      )
      assert.equal(rows.length, 0)
    }

    const claim = await client.query(`select * from public.claim_pending_action($1, 111, -100, 5001)`, [created.id])
    assert.equal(claim.rows.length, 1)
    assert.equal(Number(claim.rows[0].claimed_by), 111)

    const secondClaim = await client.query(`select * from public.claim_pending_action($1, 111, -100, 5001)`, [created.id])
    assert.equal(secondClaim.rows.length, 0)
    const cancelAfterClaim = await client.query(`select * from public.cancel_pending_action($1, 111, -100, 5001)`, [created.id])
    assert.equal(cancelAfterClaim.rows.length, 0)

    const applied = await client.query(`select * from public.apply_pending_action($1, 111, -100, 5001)`, [created.id])
    assert.equal(applied.rows[0].resolution, 'applied')
    const replayApply = await client.query(`select * from public.apply_pending_action($1, 111, -100, 5001)`, [created.id])
    assert.equal(replayApply.rows.length, 0)

    await expectReject(
      client,
      () => client.query(`update public.pending_actions set resolution = null, resolved_at = null where id = $1`, [created.id]),
      /permission denied/i
    )
    await expectReject(client, () => client.query(`delete from public.pending_actions where id = $1`, [created.id]), /permission denied/i)
  })
})

test('database time makes the exact expiry deadline closed', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      insert into public.pending_actions (
        kind, payload, chat_id, prompt_msg_id, requested_by, request_key, created_at, expires_at
      ) values (
        'undo_transaction', '{"transactionId":"tx-expired"}'::jsonb, -100, 6001, 111,
        'expired-key', now() - interval '1 hour', now()
      ) returning id
    `)

    await actAs(client, 'service_role')
    const claim = await client.query(`select * from public.claim_pending_action($1, 111, -100, 6001)`, [rows[0].id])
    assert.equal(claim.rows.length, 0)
    const expired = await client.query(`select * from public.expire_pending_action($1, 111, -100, 6001)`, [rows[0].id])
    assert.equal(expired.rows[0].resolution, 'expired')
  })
})

test('state constraints reject contradictory audit rows', async () => {
  await withTx(async (client) => {
    for (const sql of [
      `insert into public.pending_actions (kind, payload, chat_id, requested_by, request_key, resolved_at)
       values ('x', '{}', -100, 111, 'bad-resolution-pair', now())`,
      `insert into public.pending_actions (kind, payload, chat_id, requested_by, request_key, resolution, resolved_at)
       values ('x', '{}', -100, 111, 'bad-applied', 'applied', now())`,
      `insert into public.pending_actions (kind, payload, chat_id, requested_by, request_key, claimed_at, claimed_by, resolution, resolved_at)
       values ('x', '{}', -100, 111, 'bad-cancelled-claim', now(), 111, 'cancelled', now())`,
      `insert into public.pending_actions (kind, payload, chat_id, requested_by, request_key, created_at, expires_at)
       values ('x', '{}', -100, 111, 'bad-expiry', now(), now())`,
    ]) {
      await expectReject(client, () => client.query(sql), /check constraint/i)
    }
  })
})

test('two concurrent service-role claims have exactly one winner', async () => {
  const admin = new Client({ connectionString: TEST_DATABASE_URL })
  const a = new Client({ connectionString: TEST_DATABASE_URL })
  const b = new Client({ connectionString: TEST_DATABASE_URL })
  await Promise.all([admin.connect(), a.connect(), b.connect()])
  let id
  try {
    const inserted = await admin.query(`
      insert into public.pending_actions (
        kind, payload, chat_id, prompt_msg_id, requested_by, request_key, expires_at
      ) values (
        'undo_transaction', '{"transactionId":"tx-race"}'::jsonb, -100, 7001, 111,
        $1, now() + interval '1 hour'
      ) returning id
    `, [`claim-race-${Date.now()}`])
    id = inserted.rows[0].id
    await Promise.all([a.query('set role service_role'), b.query('set role service_role')])

    const [first, second] = await Promise.all([
      a.query(`select * from public.claim_pending_action($1, 111, -100, 7001)`, [id]),
      b.query(`select * from public.claim_pending_action($1, 111, -100, 7001)`, [id]),
    ])
    assert.equal(first.rows.length + second.rows.length, 1)
  } finally {
    if (id) await admin.query('delete from public.pending_actions where id = $1', [id]).catch(() => {})
    await Promise.all([admin.end(), a.end(), b.end()])
  }
})
