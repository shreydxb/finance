import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

const ACCOUNT_MISSING = '00000000-0000-0000-0000-00000000ffff'

async function seedAccountAndCategory(client, suffix) {
  await actAs(client, 'authenticated', SHREY_ID)
  const { rows: accounts } = await client.query(
    `insert into accounts (name, owner, type, currency)
     values ($1, 'Shrey', 'cash', 'AED') returning id`,
    [`Cash ${suffix}`]
  )
  const category = `Safety ${suffix}`
  await client.query(
    `insert into categories (name, "group") values ($1, 'Needs')`,
    [category]
  )
  return { accountId: accounts[0].id, category }
}

function saveSingle(client, {
  id = null,
  key,
  dateSql = "(now() at time zone 'Asia/Dubai')::date",
  amount = 42.5,
  currency = 'AED',
  accountId,
  category,
  owner = 'Shrey',
  note = 'Groceries',
  tags = ['manual'],
  assignedTo = null,
  goalId = null,
}) {
  return client.query(
    `select (public.save_manual_transaction(
       $1, $2, ${dateSql}, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )).*`,
    [id, key, amount, currency, accountId, category, owner, note, tags, assignedTo, goalId]
  )
}

test('manual create is explicit reviewed truth and an exact request replay has one effect', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'create')
    const args = {
      key: 'manual:10000000-0000-4000-8000-000000000001',
      accountId,
      category,
    }

    const first = await saveSingle(client, args)
    const replay = await saveSingle(client, args)

    assert.equal(first.rows.length, 1)
    assert.equal(replay.rows.length, 1)
    assert.equal(replay.rows[0].id, first.rows[0].id)
    assert.equal(first.rows[0].source, 'manual')
    assert.equal(first.rows[0].needs_review, false)
    assert.ok(first.rows[0].reviewed_at)
    assert.equal(first.rows[0].idempotency_key, args.key)

    const { rows: count } = await client.query(
      'select count(*) from transactions where idempotency_key = $1',
      [args.key]
    )
    assert.equal(count[0].count, '1')
  })
})

test('request-key reuse with different financial fields is rejected, not duplicated', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'conflict')
    const key = 'manual:10000000-0000-4000-8000-000000000002'
    await saveSingle(client, { key, accountId, category })

    await expectReject(
      client,
      () => saveSingle(client, { key, accountId, category, amount: 99 }),
      /SHR126_REQUEST_KEY_CONFLICT/
    )

    const { rows } = await client.query(
      'select amount from transactions where idempotency_key = $1',
      [key]
    )
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].amount), 42.5)
  })
})

test('manual create rejects invalid date, amount, account, category, and Transfer', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'validation')

    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000003', accountId, category,
      dateSql: "((now() at time zone 'Asia/Dubai')::date + 1)",
    }), /SHR126_DATE_FUTURE/)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000004', accountId, category, amount: 0,
    }), /SHR126_AMOUNT_INVALID/)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000005', accountId, category, amount: 1.001,
    }), /SHR126_AMOUNT_INVALID/)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000006', accountId: ACCOUNT_MISSING, category,
    }), /SHR126_ACCOUNT_INVALID/)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000007', accountId, category: 'Removed category',
    }), /SHR126_CATEGORY_INVALID/)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000008', accountId, category: 'Transfer',
    }), /SHR126_TRANSFER_UNSUPPORTED/)
  })
})

test('validated correction preserves provenance and confirms a corrected imported row', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'correction')
    const { rows: original } = await client.query(
      `insert into transactions (
         date, amount, currency, account_id, category, owner, note,
         source, needs_review, telegram_msg_id, idempotency_key
       ) values (
         (now() at time zone 'Asia/Dubai')::date, 0, 'AED', $1, $2, 'Shrey',
         'Unreadable receipt', 'telegram', true, 321, 'tg:1:321:0'
       ) returning *`,
      [accountId, category]
    )

    const corrected = await saveSingle(client, {
      id: original[0].id,
      key: null,
      accountId,
      category,
      amount: 25,
      note: 'Corrected receipt',
    })

    assert.equal(corrected.rows[0].id, original[0].id)
    assert.equal(corrected.rows[0].source, 'telegram')
    assert.equal(corrected.rows[0].telegram_msg_id, '321')
    assert.equal(corrected.rows[0].idempotency_key, 'tg:1:321:0')
    assert.equal(corrected.rows[0].needs_review, false)
    assert.ok(corrected.rows[0].reviewed_at)
    assert.equal(Number(corrected.rows[0].amount), 25)
  })
})

test('correction refuses deleted, grouped, and Transfer facts', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'containment')
    const today = `(now() at time zone 'Asia/Dubai')::date`
    const { rows } = await client.query(
      `insert into transactions (
         date, amount, account_id, category, owner, deleted_at, transaction_group_id, group_kind
       ) values
         (${today}, 10, $1, $2, 'Shrey', now(), null, null),
         (${today}, 10, $1, $2, 'Shrey', null, $3, 'category_split'),
         (${today}, 10, $1, 'Transfer', 'Shrey', null, null, null)
       returning id`,
      [accountId, category, '22222222-2222-4222-8222-222222222222']
    )

    await expectReject(client, () => saveSingle(client, {
      id: rows[0].id, key: null, accountId, category,
    }), /SHR126_TRANSACTION_DELETED/)
    await expectReject(client, () => saveSingle(client, {
      id: rows[1].id, key: null, accountId, category,
    }), /SHR126_GROUPED_CORRECTION_UNSUPPORTED/)
    await expectReject(client, () => saveSingle(client, {
      id: rows[2].id, key: null, accountId, category,
    }), /SHR126_TRANSFER_UNSUPPORTED/)
  })
})

test('a confirmed soft delete is immediately recoverable by exact row id', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'restore')
    const created = await saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-00000000000b', accountId, category,
    })
    const id = created.rows[0].id

    const deleted = await client.query(
      'update transactions set deleted_at = now() where id = $1 and deleted_at is null returning id, deleted_at',
      [id]
    )
    assert.equal(deleted.rows[0].id, id)
    assert.ok(deleted.rows[0].deleted_at)

    const restored = await client.query(
      'update transactions set deleted_at = null where id = $1 returning id, deleted_at',
      [id]
    )
    assert.equal(restored.rows[0].id, id)
    assert.equal(restored.rows[0].deleted_at, null)
  })
})

test('manual RPC stays SECURITY INVOKER, member-only, and protected by household RLS', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'rls')

    const { rows: metadata } = await client.query(
      `select prosecdef, proconfig
       from pg_proc
       where oid = 'public.save_manual_transaction(uuid,text,date,numeric,text,uuid,text,text,text,text[],text,uuid)'::regprocedure`
    )
    assert.equal(metadata[0].prosecdef, false)
    assert.deepEqual(metadata[0].proconfig, ['search_path=""'])

    await actAs(client, 'authenticated', OUTSIDER_ID)
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-000000000009', accountId, category,
    }), /SHR126_ACCOUNT_INVALID/)

    await actAs(client, 'anon')
    await expectReject(client, () => saveSingle(client, {
      key: 'manual:10000000-0000-4000-8000-00000000000a', accountId, category,
    }), /permission denied/i)

    await actAs(client, 'service_role')
    const { rows: count } = await client.query(
      `select count(*) from transactions where idempotency_key like 'manual:10000000-0000-4000-8000-%'`
    )
    assert.equal(count[0].count, '0')
  })
})

test('validated split rows are explicit reviewed truth and preserve canonical classification', async () => {
  await withTx(async (client) => {
    const { accountId, category } = await seedAccountAndCategory(client, 'split')
    const secondCategory = 'Safety split second'
    await client.query(`insert into categories (name, "group") values ($1, 'Wants')`, [secondCategory])

    const { rows } = await client.query(
      `select * from public.replace_category_split(null, null, $1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({
          date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()),
          currency: 'AED', account_id: accountId, owner: 'Shrey', note: 'Split purchase', tags: [],
        }),
        JSON.stringify([
          { category, amount: 30 },
          { category: secondCategory, amount: 20 },
        ]),
      ]
    )

    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.source === 'manual' && !row.needs_review && row.reviewed_at))

    const { rows: canonical } = await client.query(
      `select economic_classification, split_reconciliation_status
       from public.v_canonical_ledger_aed
       where transaction_group_id = $1`,
      [rows[0].transaction_group_id]
    )
    assert.deepEqual(new Set(canonical.map((row) => row.economic_classification)), new Set(['consumption_spend']))
    assert.deepEqual(new Set(canonical.map((row) => row.split_reconciliation_status)), new Set(['reconciled']))
  })
})
