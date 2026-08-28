// Exercises the RPCs added by 026/027/030/032 against the real schema —
// constraints and NOT NULL columns a FakeStore has no way to enforce.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, SHREY_ID, withTx } from './helpers.mjs'

async function seedAccount(client, overrides = {}) {
  const { rows } = await client.query(
    `insert into accounts (name, owner, type, currency)
     values ($1, $2, $3, $4) returning id`,
    [
      overrides.name ?? 'Cash',
      overrides.owner ?? 'Shrey',
      overrides.type ?? 'cash',
      overrides.currency ?? 'AED',
    ]
  )
  return rows[0].id
}

async function asMember(client) {
  await actAs(client, 'authenticated', SHREY_ID)
}

test('replace_category_split: original rows survive when a line is invalid', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)
    const { rows: original } = await client.query(
      `insert into transactions (date, amount, account_id, category)
       values (current_date, 100, $1, 'Groceries') returning id`,
      [accountId]
    )

    await expectReject(client, () =>
      client.query(
        `select * from replace_category_split($1, $2, $3, $4)`,
        [
          null,
          original[0].id,
          JSON.stringify({ date: '2026-08-01', account_id: accountId }),
          JSON.stringify([{ category: 'Dining' }]), // no amount — must reject
        ]
      )
    )

    const { rows: stillThere } = await client.query('select * from transactions where id = $1', [
      original[0].id,
    ])
    assert.equal(stillThere.length, 1, 'a failed replace must not destroy the original row')
  })
})

test('replace_category_split soft-deletes the group it replaces (032, not a hard delete)', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)
    const groupId = '11111111-2222-3333-4444-555555555555'
    await client.query(
      `insert into transactions (date, amount, account_id, category, transaction_group_id, group_kind)
       values (current_date, 60, $1, 'Groceries', $2, 'category_split'),
              (current_date, 40, $1, 'Dining', $2, 'category_split')`,
      [accountId, groupId]
    )

    await client.query(`select * from replace_category_split($1, null, $2, $3)`, [
      groupId,
      JSON.stringify({ date: '2026-08-01', account_id: accountId, owner: 'Shrey' }),
      JSON.stringify([{ amount: 100, category: 'Groceries' }]),
    ])

    const { rows } = await client.query(
      'select amount, deleted_at from transactions where transaction_group_id = $1',
      [groupId]
    )
    assert.equal(rows.length, 2, 'the original two lines must still exist')
    for (const row of rows) {
      assert.ok(row.deleted_at !== null, 'the replaced lines must be soft-deleted, not gone')
    }
  })
})

test('create_goal_contribution: an account that does not exist rolls back the contribution too', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const { rows: goal } = await client.query(
      `insert into goals (name, kind, target_amount) values ('Emergency fund', 'save_up', 10000) returning id`
    )

    await expectReject(client, () =>
      client.query(`select create_goal_contribution($1, $2, current_date, null, $3, $4)`, [
        goal[0].id,
        500,
        '00000000-0000-0000-0000-00000000ffff', // no such account
        'Emergency fund',
      ])
    )

    const { rows: contributions } = await client.query(
      'select * from goal_contributions where goal_id = $1',
      [goal[0].id]
    )
    assert.equal(contributions.length, 0, 'the raise must roll back the whole transaction, contribution included')
  })
})

test('create_goal_contribution rejects a non-positive amount', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const { rows: goal } = await client.query(
      `insert into goals (name, kind, target_amount) values ('Car', 'save_up', 5000) returning id`
    )
    await assert.rejects(() =>
      client.query(`select create_goal_contribution($1, 0, current_date, null, null, 'Car')`, [
        goal[0].id,
      ])
    )
  })
})

test('create_transfer: both rows land in one call and share a group', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const from = await seedAccount(client, { name: 'Wio' })
    const to = await seedAccount(client, { name: 'ENBD' })

    const { rows } = await client.query(
      `select * from create_transfer(
         current_date, 250, 'AED', $1, $2, 'Wio', 'ENBD', 'Shrey', false, 111, 222, 'tg:111:222'
       )`,
      [from, to]
    )

    assert.equal(rows.length, 2)
    assert.equal(rows[0].transaction_group_id, rows[1].transaction_group_id)
    assert.deepEqual(rows.map((r) => r.transfer_direction).sort(), ['in', 'out'])
  })
})

test('create_transfer: a redelivered webhook update writes nothing the second time', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const from = await seedAccount(client)
    const to = await seedAccount(client)
    const args = [
      `select * from create_transfer(
         current_date, 250, 'AED', $1, $2, 'A', 'B', 'Shrey', false, 111, 222, 'tg:111:222'
       )`,
      [from, to],
    ]

    const first = await client.query(...args)
    const replay = await client.query(...args)

    assert.equal(first.rows.length, 2)
    assert.equal(replay.rows.length, 0, 'Telegram redelivery must be a no-op, not a second transfer')
  })
})

test('create_bulk_transactions: all rows or none, and rejects an empty batch', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)

    await expectReject(client, () =>
      client.query(`select * from create_bulk_transactions('[]'::jsonb, 111, 'tg:111:333')`)
    )

    const { rows } = await client.query(
      `select * from create_bulk_transactions($1::jsonb, 111, 'tg:111:333')`,
      [
        JSON.stringify([
          { date: '2026-08-01', amount: 20, account_id: accountId, category: 'Coffee' },
          { date: '2026-08-01', amount: 30, account_id: accountId, category: 'Lunch' },
        ]),
      ]
    )
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.group_kind === 'bulk_batch'))
  })
})

test('apply_pending_income: a replay after the proposal is gone logs nothing', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const { rows: pending } = await client.query(
      `insert into pending_income (person, kind, amount, date) values ('Shrey', 'other', 300, current_date) returning id`
    )

    const first = await client.query('select apply_pending_income($1) as result', [pending[0].id])
    const replay = await client.query('select apply_pending_income($1) as result', [pending[0].id])

    assert.notEqual(first.rows[0].result, null)
    assert.equal(replay.rows[0].result, null, 'a replay must find nothing to delete and log nothing')

    const { rows: incomeRows } = await client.query(
      "select * from income where person = 'Shrey' and amount = 300"
    )
    assert.equal(incomeRows.length, 1, 'income must be logged exactly once across both calls')
  })
})

test('claim_media_group: exactly one of two concurrent claims wins', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await client.query(
      `insert into media_groups (media_group_id, chat_id) values ('album-1', 555)`
    )

    const [a, b] = await Promise.all([
      client.query('select claim_media_group($1) as claimed', ['album-1']),
      client.query('select claim_media_group($1) as claimed', ['album-1']),
    ])

    const claims = [a.rows[0].claimed, b.rows[0].claimed].filter(Boolean)
    assert.equal(claims.length, 1, 'exactly one caller should claim the album')
  })
})

test('save_telegram_settings: a one-person setup does not violate settings.value NOT NULL (bug 1)', async () => {
  await withTx(async (client) => {
    await asMember(client)
    // p_person2 arrives as SQL NULL — the exact shape of the bug that broke
    // every one-person household before this function coalesced it to jsonb null.
    await client.query(
      `select save_telegram_settings($1::jsonb, null, 0.85, null)`,
      [JSON.stringify({ person: 'Shrey', telegram_user_id: 111 })]
    )

    const { rows } = await client.query(
      "select value from settings where key = 'tg_id_2'"
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].value, null, 'stored as JSON null, not left absent')
  })
})

test('save_telegram_settings rejects a threshold outside [0, 1]', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await assert.rejects(() =>
      client.query(`select save_telegram_settings(null, null, 1.5, null)`)
    )
  })
})

test('save_telegram_settings rejects a fallback account that is not cash/credit_card', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const loanAccount = await seedAccount(client, { type: 'loan' })
    await assert.rejects(() =>
      client.query(`select save_telegram_settings(null, null, 0.85, $1)`, [loanAccount])
    )
  })
})
