import assert from 'node:assert/strict'
import test from 'node:test'

import { BACKUP_TABLES, buildBackup } from '../functions/backup/dump.ts'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

async function insertCategory(client, name, overrides = {}) {
  const { rows } = await client.query(
    `insert into public.categories(name, "group", icon, system_code, archived_at)
     values($1, $2, $3, $4, $5)
     returning *`,
    [name, overrides.group ?? 'Wants', overrides.icon ?? null,
      overrides.systemCode ?? null, overrides.archivedAt ?? null]
  )
  return rows[0]
}

test('fresh SHR-196 schema is additive, empty, and keeps current categories unclassified', async () => {
  await withTx(async (client) => {
    const columns = await client.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'categories'
        and column_name in ('system_code', 'archived_at', 'updated_at')
      order by column_name
    `)
    assert.deepEqual(columns.rows, [
      { column_name: 'archived_at', is_nullable: 'YES' },
      { column_name: 'system_code', is_nullable: 'YES' },
      { column_name: 'updated_at', is_nullable: 'NO' },
    ])

    const state = await client.query(`
      select
        count(*)::integer as category_count,
        count(*) filter (where system_code is not null)::integer as coded_count,
        count(*) filter (where archived_at is not null)::integer as archived_count,
        count(*) filter (where name = 'Other')::integer as other_count
      from public.categories
    `)
    assert.ok(state.rows[0].category_count > 0)
    assert.equal(state.rows[0].coded_count, 0, 'SHR-196 must seed no system code')
    assert.equal(state.rows[0].archived_count, 0, 'SHR-196 must archive no current category')
    assert.equal(state.rows[0].other_count, 1, 'Other remains an ordinary category')

    assert.equal(
      await client.query('select count(*)::integer as count from public.category_name_history')
        .then(({ rows }) => rows[0].count),
      0,
      'migration must fabricate no rename history'
    )
    assert.equal(
      await client.query('select count(*)::integer as count from public.category_aliases')
        .then(({ rows }) => rows[0].count),
      0,
      'migration must fabricate no aliases'
    )
  })
})

test('only the two approved codes are allowed and assigned codes are immutable', async () => {
  await withTx(async (client) => {
    const transfer = await insertCategory(client, 'SHR-196 system transfer fixture')
    await client.query('update public.categories set system_code = $1 where id = $2', ['transfer', transfer.id])

    const savings = await insertCategory(client, 'SHR-196 system savings fixture')
    await client.query(
      'update public.categories set system_code = $1 where id = $2',
      ['savings_investment', savings.id]
    )

    const arbitrary = await insertCategory(client, 'SHR-196 arbitrary code fixture')
    await expectReject(
      client,
      () => client.query('update public.categories set system_code = $1 where id = $2', ['other', arbitrary.id]),
      /categories_system_code_check|violates check constraint/i
    )

    const duplicate = await insertCategory(client, 'SHR-196 duplicate code fixture')
    await expectReject(
      client,
      () => client.query('update public.categories set system_code = $1 where id = $2', ['transfer', duplicate.id]),
      /categories_system_code_uidx|duplicate key/i
    )

    await expectReject(
      client,
      () => client.query('update public.categories set system_code = null where id = $1', [transfer.id]),
      /SHR196_SYSTEM_CODE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(
        'update public.categories set system_code = $1 where id = $2',
        ['savings_investment', transfer.id]
      ),
      /SHR196_SYSTEM_CODE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('update public.categories set archived_at = now() where id = $1', [transfer.id]),
      /SHR196_SYSTEM_CATEGORY_ARCHIVE_PROTECTED/
    )
    await expectReject(
      client,
      () => client.query('delete from public.categories where id = $1', [transfer.id]),
      /SHR196_SYSTEM_CATEGORY_DELETE_PROTECTED/
    )
  })
})

test('ordinary category edits remain structural while rename, archive, reactivation, and hard delete fail closed', async () => {
  await withTx(async (client) => {
    const ordinary = await insertCategory(client, 'SHR-196 lifecycle fixture', { icon: 'before' })

    const edited = await client.query(
      `update public.categories
       set icon = 'after', "group" = 'Needs'
       where id = $1
       returning name, "group", icon, updated_at`,
      [ordinary.id]
    )
    assert.deepEqual(
      { name: edited.rows[0].name, group: edited.rows[0].group, icon: edited.rows[0].icon },
      { name: ordinary.name, group: 'Needs', icon: 'after' }
    )
    assert.ok(new Date(edited.rows[0].updated_at) >= new Date(ordinary.updated_at))

    await expectReject(
      client,
      () => client.query("update public.categories set name = 'SHR-196 renamed' where id = $1", [ordinary.id]),
      /SHR196_CATEGORY_RENAME_DISABLED/
    )
    await expectReject(
      client,
      () => client.query('update public.categories set archived_at = now() where id = $1', [ordinary.id]),
      /SHR196_CATEGORY_ARCHIVE_DISABLED/
    )

    const restoredArchive = await insertCategory(client, 'SHR-196 restored archive fixture', {
      archivedAt: '2026-08-30T12:00:00.000Z',
    })
    await expectReject(
      client,
      () => client.query('update public.categories set archived_at = null where id = $1', [restoredArchive.id]),
      /SHR196_CATEGORY_ARCHIVE_DISABLED/
    )
    await expectReject(
      client,
      () => client.query('delete from public.categories where id = $1', [ordinary.id]),
      /SHR196_CATEGORY_HARD_DELETE_DISABLED/
    )
    await expectReject(client, () => client.query('truncate public.categories cascade'), /SHR196_CATEGORY_HARD_DELETE_DISABLED/)
  })
})

test('browser and service paths cannot assign system codes or write lifecycle evidence', async () => {
  await withTx(async (client) => {
    const memberTarget = await insertCategory(client, 'SHR-196 member mutation fixture')
    await actAs(client, 'authenticated', SHREY_ID)

    await expectReject(
      client,
      () => client.query('update public.categories set system_code = $1 where id = $2', ['transfer', memberTarget.id]),
      /SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query('update public.categories set archived_at = now() where id = $1', [memberTarget.id]),
      /SHR196_CATEGORY_ARCHIVE_DISABLED/
    )
    await expectReject(
      client,
      () => client.query("update public.categories set name = 'browser rename' where id = $1", [memberTarget.id]),
      /SHR196_CATEGORY_RENAME_DISABLED/
    )
    await expectReject(
      client,
      () => client.query('delete from public.categories where id = $1', [memberTarget.id]),
      /permission denied/i
    )
    await expectReject(
      client,
      () => client.query(
        `insert into public.category_name_history(category_id, old_name, new_name, changed_at)
         values($1, 'old', 'new', now())`,
        [memberTarget.id]
      ),
      /permission denied/i
    )
    await expectReject(
      client,
      () => client.query(
        `insert into public.category_aliases(category_id, alias_name)
         values($1, 'browser alias')`,
        [memberTarget.id]
      ),
      /permission denied/i
    )
  })

  await withTx(async (client) => {
    const serviceTarget = await insertCategory(client, 'SHR-196 service mutation fixture')
    await actAs(client, 'service_role')
    await expectReject(
      client,
      () => client.query('update public.categories set system_code = $1 where id = $2', ['transfer', serviceTarget.id]),
      /SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query('update public.categories set archived_at = now() where id = $1', [serviceTarget.id]),
      /SHR196_CATEGORY_ARCHIVE_DISABLED/
    )
    await expectReject(
      client,
      () => client.query(
        `insert into public.category_aliases(category_id, alias_name)
         values($1, 'service alias')`,
        [serviceTarget.id]
      ),
      /permission denied/i
    )
  })
})

test('history is immutable and distinct from explicitly active or retired aliases', async () => {
  await withTx(async (client) => {
    const category = await insertCategory(client, 'SHR-196 current history fixture')
    const history = await client.query(
      `insert into public.category_name_history(category_id, old_name, new_name, changed_at)
       values($1, 'SHR-196 historical free label', $2, '2026-08-30T10:00:00Z')
       returning *`,
      [category.id, category.name]
    )

    assert.equal(
      await client.query(
        `select count(*)::integer as count from public.category_aliases
         where alias_name = 'SHR-196 historical free label'
           and resolver_state = 'compatibility_active'`
      ).then(({ rows }) => rows[0].count),
      0,
      'history must never create an active alias automatically'
    )
    await insertCategory(client, 'SHR-196 historical free label')

    await expectReject(
      client,
      () => client.query('update public.category_name_history set old_name = $1 where history_id = $2', ['changed', history.rows[0].history_id]),
      /SHR196_CATEGORY_NAME_HISTORY_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('delete from public.category_name_history where history_id = $1', [history.rows[0].history_id]),
      /SHR196_CATEGORY_NAME_HISTORY_IMMUTABLE/
    )

    const alias = await client.query(
      `insert into public.category_aliases(category_id, alias_name)
       values($1, 'SHR-196 compatibility alias') returning *`,
      [category.id]
    )
    await expectReject(
      client,
      () => insertCategory(client, 'SHR-196 compatibility alias'),
      /SHR196_CATEGORY_NAME_ACTIVE_ALIAS_CONFLICT/
    )

    await client.query(
      `update public.category_aliases
       set resolver_state = 'history_only', retired_at = now()
       where alias_id = $1`,
      [alias.rows[0].alias_id]
    )
    await insertCategory(client, 'SHR-196 compatibility alias')

    await expectReject(
      client,
      () => client.query(
        `update public.category_aliases
         set resolver_state = 'compatibility_active', retired_at = null
         where alias_id = $1`,
        [alias.rows[0].alias_id]
      ),
      /SHR196_CATEGORY_ALIAS_LIFECYCLE_INVALID/
    )
    await expectReject(
      client,
      () => client.query('update public.category_aliases set alias_name = $1 where alias_id = $2', ['changed', alias.rows[0].alias_id]),
      /SHR196_CATEGORY_ALIAS_IDENTITY_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('delete from public.category_aliases where alias_id = $1', [alias.rows[0].alias_id]),
      /SHR196_CATEGORY_ALIAS_DELETE_DISABLED/
    )
  })
})

test('category evidence ACL and RLS use only existing household membership', async () => {
  await withTx(async (client) => {
    const privileges = await client.query(`
      select
        has_table_privilege('authenticated', 'public.category_name_history', 'select') as auth_history_read,
        has_table_privilege('authenticated', 'public.category_name_history', 'insert,update,delete') as auth_history_write,
        has_table_privilege('authenticated', 'public.category_aliases', 'select') as auth_alias_read,
        has_table_privilege('authenticated', 'public.category_aliases', 'insert,update,delete') as auth_alias_write,
        has_table_privilege('service_role', 'public.category_name_history', 'select') as service_history_read,
        has_table_privilege('service_role', 'public.category_aliases', 'select') as service_alias_read,
        has_table_privilege('anon', 'public.category_name_history', 'select,insert,update,delete') as anon_history,
        has_table_privilege('anon', 'public.category_aliases', 'select,insert,update,delete') as anon_alias,
        has_table_privilege('authenticated', 'public.categories', 'delete,truncate') as auth_category_delete,
        has_table_privilege('service_role', 'public.categories', 'delete,truncate') as service_category_delete
    `)
    assert.deepEqual(privileges.rows[0], {
      auth_history_read: true,
      auth_history_write: false,
      auth_alias_read: true,
      auth_alias_write: false,
      service_history_read: true,
      service_alias_read: true,
      anon_history: false,
      anon_alias: false,
      auth_category_delete: false,
      service_category_delete: false,
    })

    const policies = await client.query(`
      select tablename, cmd, roles, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and tablename in ('category_name_history', 'category_aliases')
      order by tablename
    `)
    assert.equal(policies.rows.length, 2)
    for (const policy of policies.rows) {
      assert.equal(policy.cmd, 'SELECT')
      assert.deepEqual(policy.roles, ['authenticated'])
      assert.match(policy.qual, /private\.is_household_member\(\)/)
      assert.doesNotMatch(`${policy.qual} ${policy.with_check ?? ''}`, /owner|party|system_code|category_id/i)
    }

    const inventedRoles = await client.query(`
      select rolname from pg_roles
      where rolname ~* '(taxonomy|category).*(admin|owner)|(admin|owner).*(taxonomy|category)'
    `)
    assert.deepEqual(inventedRoles.rows, [])
  })

  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    await client.query('select * from public.category_name_history')
    await client.query('select * from public.category_aliases')
  })

  await withTx(async (client) => {
    await actAs(client, 'authenticated', OUTSIDER_ID)
    assert.equal(
      await client.query('select count(*)::integer as count from public.category_name_history')
        .then(({ rows }) => rows[0].count),
      0
    )
    assert.equal(
      await client.query('select count(*)::integer as count from public.category_aliases')
        .then(({ rows }) => rows[0].count),
      0
    )
  })
})

test('no rename, archive, delete, or resolver RPC is introduced', async () => {
  await withTx(async (client) => {
    const lifecycleRpc = await client.query(`
      select proname
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname ~* '(rename|archive|delete|resolve).*category|category.*(rename|archive|delete|resolve)'
    `)
    assert.deepEqual(lifecycleRpc.rows, [])

    const stableRefs = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('transactions', 'category_rules')
        and column_name = 'category_id'
    `)
    assert.deepEqual(stableRefs.rows, [], 'SHR-197 stable references must not appear in SHR-196')
  })
})

test('null remains uncategorized and Other remains ordinary V1 consumption', async () => {
  await withTx(async (client) => {
    const account = await client.query(
      `insert into public.accounts(name, owner, type)
       values('SHR-196 classification account', 'Shrey', 'cash') returning id`
    )
    await client.query(
      `insert into public.transactions(date, amount, account_id, category, note)
       values
         ('2026-08-30', 10, $1, null, 'SHR-196 null'),
         ('2026-08-30', 20, $1, 'Other', 'SHR-196 Other')`,
      [account.rows[0].id]
    )

    const classes = await client.query(`
      select note, category, economic_classification, classification_reason
      from public.v_canonical_ledger_aed
      where note in ('SHR-196 null', 'SHR-196 Other')
      order by note
    `)
    assert.deepEqual(classes.rows, [
      {
        note: 'SHR-196 Other',
        category: 'Other',
        economic_classification: 'consumption_spend',
        classification_reason: 'categorised_consumption',
      },
      {
        note: 'SHR-196 null',
        category: null,
        economic_classification: 'consumption_spend',
        classification_reason: 'uncategorised_consumption',
      },
    ])
  })
})

test('backup manifest restores lifecycle fields, history, and both alias states with protections intact', async () => {
  const systemId = '19600000-0000-0000-0000-000000000001'
  const archivedId = '19600000-0000-0000-0000-000000000002'
  const historyId = '19600000-0000-0000-0000-000000000003'
  const activeAliasId = '19600000-0000-0000-0000-000000000004'
  const retiredAliasId = '19600000-0000-0000-0000-000000000005'
  const source = {
    categories: [
      {
        id: systemId,
        name: 'SHR-196 restored protected category',
        group: 'Transfer',
        icon: null,
        created_at: '2026-08-30T08:00:00+00:00',
        system_code: 'transfer',
        archived_at: null,
        updated_at: '2026-08-30T08:30:00+00:00',
      },
      {
        id: archivedId,
        name: 'SHR-196 restored archived ordinary',
        group: 'Wants',
        icon: 'archive',
        created_at: '2026-08-30T09:00:00+00:00',
        system_code: null,
        archived_at: '2026-08-30T11:00:00+00:00',
        updated_at: '2026-08-30T11:00:00+00:00',
      },
    ],
    category_name_history: [{
      history_id: historyId,
      category_id: archivedId,
      old_name: 'SHR-196 restored former name',
      new_name: 'SHR-196 restored archived ordinary',
      changed_at: '2026-08-30T10:00:00+00:00',
      recorded_at: '2026-08-30T10:00:01+00:00',
      evidence_version: 1,
    }],
    category_aliases: [
      {
        alias_id: activeAliasId,
        category_id: systemId,
        alias_name: 'SHR-196 restored active alias',
        resolver_state: 'compatibility_active',
        created_at: '2026-08-30T10:00:02+00:00',
        retired_at: null,
        lifecycle_version: 1,
      },
      {
        alias_id: retiredAliasId,
        category_id: archivedId,
        alias_name: 'SHR-196 restored retired alias',
        resolver_state: 'history_only',
        created_at: '2026-08-30T10:00:03+00:00',
        retired_at: '2026-08-30T10:00:04+00:00',
        lifecycle_version: 1,
      },
    ],
  }

  const backup = await buildBackup(
    async (table) => source[table] ?? [],
    '046_category_lifecycle_foundation',
    () => '2026-08-31T00:00:00.000Z'
  )
  for (const name of ['categories', 'category_name_history', 'category_aliases']) {
    assert.deepEqual(backup.tables[name], source[name])
    assert.ok(BACKUP_TABLES.some((table) => table.name === name && table.financial))
  }

  await withTx(async (client) => {
    for (const row of backup.tables.categories) {
      await client.query(
        `insert into public.categories
         select (jsonb_populate_record(null::public.categories, $1::jsonb)).*`,
        [JSON.stringify(row)]
      )
    }
    for (const row of backup.tables.category_name_history) {
      await client.query(
        `insert into public.category_name_history
         select (jsonb_populate_record(null::public.category_name_history, $1::jsonb)).*`,
        [JSON.stringify(row)]
      )
    }
    for (const row of backup.tables.category_aliases) {
      await client.query(
        `insert into public.category_aliases
         select (jsonb_populate_record(null::public.category_aliases, $1::jsonb)).*`,
        [JSON.stringify(row)]
      )
    }

    const restoredCategories = await client.query(
      `select to_jsonb(c) as row from public.categories c where id in ($1, $2) order by id`,
      [systemId, archivedId]
    )
    assert.deepEqual(restoredCategories.rows.map(({ row }) => row), source.categories)
    const restoredHistory = await client.query(
      'select to_jsonb(h) as row from public.category_name_history h where history_id = $1',
      [historyId]
    )
    assert.deepEqual(restoredHistory.rows[0].row, source.category_name_history[0])
    const restoredAliases = await client.query(
      `select to_jsonb(a) as row from public.category_aliases a
       where alias_id in ($1, $2) order by alias_id`,
      [activeAliasId, retiredAliasId]
    )
    assert.deepEqual(restoredAliases.rows.map(({ row }) => row), source.category_aliases)

    await expectReject(
      client,
      () => client.query('update public.categories set system_code = null where id = $1', [systemId]),
      /SHR196_SYSTEM_CODE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('delete from public.categories where id = $1', [archivedId]),
      /SHR196_CATEGORY_HARD_DELETE_DISABLED/
    )
    await expectReject(
      client,
      () => client.query('delete from public.category_name_history where history_id = $1', [historyId]),
      /SHR196_CATEGORY_NAME_HISTORY_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(
        `update public.category_aliases
         set resolver_state = 'compatibility_active', retired_at = null
         where alias_id = $1`,
        [retiredAliasId]
      ),
      /SHR196_CATEGORY_ALIAS_LIFECYCLE_INVALID/
    )
  })
})
