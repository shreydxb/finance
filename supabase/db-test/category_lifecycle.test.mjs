// SHR-196 — category lifecycle and system-code protection foundation.
//
// These tests exist to prove a contract, not to exercise code. The package is
// deliberately dormant: after migration 046 no category carries a system code,
// no rename or archive product path exists, and no consumer changed. What must
// be provable is the boundary — that the protections hold through every
// mutation path this repository actually has (direct DML as anon,
// authenticated and service_role, the database-owner/migration path, and the
// named operator functions), and that the new durable evidence survives an
// export and a representative restore.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { BACKUP_TABLES, buildBackup } from '../functions/backup/dump.ts'
import { actAs, expectReject, SHREY_ID, withTx } from './helpers.mjs'

const APPROVED_SYSTEM_CODES = ['transfer', 'savings_investment']

const MIGRATION_SOURCE = readFileSync(
  new URL('../schema/046_category_lifecycle_protection.sql', import.meta.url),
  'utf8'
)

/** An isolated ordinary category, created on the operator path. */
async function makeCategory(client, name, group = 'Wants') {
  const { rows } = await client.query(
    `insert into public.categories (name, "group") values ($1, $2) returning *`,
    [name, group]
  )
  return rows[0]
}

async function makeSystemCategory(client, name, code) {
  const category = await makeCategory(client, name)
  const { rows } = await client.query(
    `select * from private.assign_category_system_code_v1($1::uuid, $2::text)`,
    [category.id, code]
  )
  return rows[0]
}

// ── 1. Migration shape and the no-seed guarantee ─────────────────────────

test('046 adds only additive, default-safe lifecycle columns to categories', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'categories'
      order by ordinal_position
    `)
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]))

    // The pre-SHR-196 production shape is untouched.
    for (const column of ['id', 'name', 'group', 'icon', 'created_at']) {
      assert.ok(byName[column], `${column} must survive the migration`)
    }

    assert.equal(byName.system_code.data_type, 'text')
    assert.equal(byName.system_code.is_nullable, 'YES')
    assert.equal(byName.system_code.column_default, null, 'no system code may be defaulted onto a row')

    assert.equal(byName.archived_at.data_type, 'timestamp with time zone')
    assert.equal(byName.archived_at.is_nullable, 'YES')
    assert.equal(byName.archived_at.column_default, null, 'no category may default to archived')

    assert.equal(byName.updated_at.data_type, 'timestamp with time zone')
    assert.equal(byName.updated_at.is_nullable, 'NO')
    assert.match(byName.updated_at.column_default, /now\(\)/)
  })
})

test('SHR-196 seeds no system code and archives nothing', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        count(*)::integer as categories,
        count(system_code)::integer as coded,
        count(archived_at)::integer as archived
      from public.categories
    `)
    assert.ok(rows[0].categories > 0, 'the seeded taxonomy must still exist')
    assert.equal(rows[0].coded, 0, 'SHR-197 owns evidence-reviewed system-code assignment, not this package')
    assert.equal(rows[0].archived, 0, 'no category may be archived by the migration')

    // Nothing may be inferred from a legacy label either.
    const { rows: legacy } = await client.query(`
      select name, system_code, archived_at from public.categories
      where name in ('Transfer', 'Savings & Investments', 'Other')
      order by name
    `)
    for (const row of legacy) {
      assert.equal(row.system_code, null, `${row.name} must not be system-coded by name`)
      assert.equal(row.archived_at, null)
    }
  })
})

test('updated_at is seeded deterministically from created_at, not a migration wall clock', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select count(*)::integer as drifted
      from public.categories
      where updated_at <> created_at
    `)
    assert.equal(rows[0].drifted, 0, 'a row that has never changed must not look changed')
  })
})

test('no transaction or category-rule stable category reference is introduced', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('transactions', 'category_rules')
        and column_name = 'category_id'
    `)
    assert.deepEqual(rows, [], 'stable references are SHR-197 work, not SHR-196 work')
  })
})

// ── 2. The system-code vocabulary is closed ──────────────────────────────

test('only the two approved system codes are structurally accepted', async () => {
  await withTx(async (client) => {
    for (const code of APPROVED_SYSTEM_CODES) {
      const row = await makeSystemCategory(client, `SHR196 ${code}`, code)
      assert.equal(row.system_code, code)
    }
  })
})

test('an unsupported system code is rejected by the database, not by a caller', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 unsupported code')
    for (const code of ['uncategorized', 'Transfer', 'savings-investment', 'income', '']) {
      await expectReject(
        client,
        () =>
          client.query(`update public.categories set system_code = $1 where id = $2`, [
            code,
            category.id,
          ]),
        /categories_system_code_check/
      )
    }
    // Even the named operator path refuses an unapproved code.
    await expectReject(
      client,
      () =>
        client.query(`select private.assign_category_system_code_v1($1::uuid, 'uncategorized')`, [
          category.id,
        ]),
      /SHR196_SYSTEM_CODE_NOT_ALLOWED/
    )
  })
})

test('a system semantic has exactly one anchor row', async () => {
  await withTx(async (client) => {
    await makeSystemCategory(client, 'SHR196 first transfer anchor', 'transfer')
    const second = await makeCategory(client, 'SHR196 second transfer anchor')
    await expectReject(
      client,
      () =>
        client.query(`select private.assign_category_system_code_v1($1::uuid, 'transfer')`, [
          second.id,
        ]),
      /categories_system_code_uidx/
    )
  })
})

// ── 3. System-code protection through every ordinary mutation path ───────

for (const role of ['authenticated', 'service_role']) {
  test(`${role} cannot assign a system code`, async () => {
    await withTx(async (client) => {
      const category = await makeCategory(client, `SHR196 no assign ${role}`)
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () =>
          client.query(`update public.categories set system_code = 'transfer' where id = $1`, [
            category.id,
          ]),
        /SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN/
      )
      await expectReject(
        client,
        () =>
          client.query(
            `insert into public.categories (name, "group", system_code) values ($1, 'Wants', 'transfer')`,
            [`SHR196 born coded ${role}`]
          ),
        /SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN/
      )
      await client.query('reset role')
    })
  })

  test(`${role} cannot change or clear an assigned system code`, async () => {
    await withTx(async (client) => {
      const system = await makeSystemCategory(client, `SHR196 protected ${role}`, 'transfer')
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () =>
          client.query(
            `update public.categories set system_code = 'savings_investment' where id = $1`,
            [system.id]
          ),
        /SHR196_SYSTEM_CODE_IMMUTABLE/
      )
      await expectReject(
        client,
        () => client.query(`update public.categories set system_code = null where id = $1`, [system.id]),
        /SHR196_SYSTEM_CODE_IMMUTABLE/
      )
      await client.query('reset role')
    })
  })

  test(`${role} cannot archive or delete a system category`, async () => {
    await withTx(async (client) => {
      const system = await makeSystemCategory(client, `SHR196 anchor ${role}`, 'savings_investment')
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () => client.query(`update public.categories set archived_at = now() where id = $1`, [system.id]),
        /SHR196_SYSTEM_CATEGORY_ARCHIVE_FORBIDDEN/
      )
      await expectReject(
        client,
        () => client.query(`delete from public.categories where id = $1`, [system.id]),
        /SHR196_SYSTEM_CATEGORY_DELETE_FORBIDDEN/
      )
      await client.query('reset role')
    })
  })

  test(`${role} cannot rename a system category while text consumers exist`, async () => {
    await withTx(async (client) => {
      const system = await makeSystemCategory(client, `SHR196 renameable ${role}`, 'transfer')
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () => client.query(`update public.categories set name = 'Renamed' where id = $1`, [system.id]),
        /SHR196_SYSTEM_CATEGORY_RENAME_FORBIDDEN/
      )
      await client.query('reset role')
    })
  })
}

test('the migration/operator path itself cannot reassign or clear a registered code', async () => {
  await withTx(async (client) => {
    // The database owner is the real trust root and can drop these triggers by
    // DDL; what must not exist is an ordinary UPDATE that silently moves a
    // financial semantic between rows.
    const system = await makeSystemCategory(client, 'SHR196 owner cannot reassign', 'transfer')
    await expectReject(
      client,
      () =>
        client.query(`update public.categories set system_code = 'savings_investment' where id = $1`, [
          system.id,
        ]),
      /SHR196_SYSTEM_CODE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(`update public.categories set system_code = null where id = $1`, [system.id]),
      /SHR196_SYSTEM_CODE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [system.id]),
      /SHR196_SYSTEM_CATEGORY_ARCHIVE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query(`delete from public.categories where id = $1`, [system.id]),
      /SHR196_SYSTEM_CATEGORY_DELETE_FORBIDDEN/
    )
  })
})

test('a system category can never carry an archive timestamp, whatever wrote it', async () => {
  await withTx(async (client) => {
    // Declarative defence in depth: even with the guard trigger disabled the
    // check constraint holds.
    const system = await makeSystemCategory(client, 'SHR196 constraint anchor', 'transfer')
    await client.query('alter table public.categories disable trigger categories_lifecycle_guard')
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [system.id]),
      /categories_system_not_archivable_check/
    )
    await client.query('alter table public.categories enable trigger categories_lifecycle_guard')
  })
})

// ── 4. Delete and archive boundaries ─────────────────────────────────────

test('no path deletes an ordinary category either — removal is archive, not delete', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 undeletable')

    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(
      client,
      () => client.query(`delete from public.categories where id = $1`, [category.id]),
      /SHR196_CATEGORY_DELETE_FORBIDDEN/
    )
    await client.query('reset role')

    await actAs(client, 'service_role')
    await expectReject(
      client,
      () => client.query(`delete from public.categories where id = $1`, [category.id]),
      /SHR196_CATEGORY_DELETE_FORBIDDEN/
    )
    await client.query('reset role')

    await expectReject(
      client,
      () => client.query(`delete from public.categories where id = $1`, [category.id]),
      /SHR196_CATEGORY_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query('truncate table public.categories cascade'),
      /SHR196_CATEGORY_TRUNCATE_FORBIDDEN/
    )
  })
})

test('production archive is unavailable to every application path', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 unarchivable by app')

    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [category.id]),
      /SHR196_CATEGORY_ARCHIVE_NOT_ENABLED/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.categories (name, "group", archived_at) values ('SHR196 born archived', 'Wants', now())`
        ),
      /SHR196_CATEGORY_ARCHIVE_NOT_ENABLED/
    )
    await client.query('reset role')

    await actAs(client, 'service_role')
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [category.id]),
      /SHR196_CATEGORY_ARCHIVE_NOT_ENABLED/
    )
    await client.query('reset role')

    // No RPC anywhere exposes archive, rename or reactivation either.
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like '%categor%')
        and (p.proname like '%archiv%' or p.proname like '%rename%' or p.proname like '%reactivat%'
             or p.proname like '%delete%' or p.proname like '%resolve%')
    `)
    assert.deepEqual(rows, [], 'SHR-196 must not publish a category lifecycle RPC')
  })
})

test('archive fails closed while the budget and rule predicates are undefined', async () => {
  await withTx(async (client) => {
    const budgeted = await makeCategory(client, 'SHR196 budgeted')
    await client.query(
      `insert into public.budgets (category_id, monthly_limit, "group") values ($1, 500, 'Flexible')`,
      [budgeted.id]
    )
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [budgeted.id]),
      /SHR196_CATEGORY_ARCHIVE_BUDGET_PREDICATE_UNDEFINED/
    )

    const ruled = await makeCategory(client, 'SHR196 ruled')
    await client.query(
      `insert into public.category_rules (pattern, category) values ('shr196-probe', $1)`,
      [ruled.name]
    )
    await expectReject(
      client,
      () => client.query(`update public.categories set archived_at = now() where id = $1`, [ruled.id]),
      /SHR196_CATEGORY_ARCHIVE_RULE_LIFECYCLE_UNDEFINED/
    )
  })
})

test('the lifecycle fields themselves work structurally on the operator path', async () => {
  await withTx(async (client) => {
    // Archive is not a product capability, but the substrate a later package
    // builds on has to be real rather than decorative.
    const category = await makeCategory(client, 'SHR196 lifecycle substrate')
    // updated_at is written by the database, not accepted from the caller: a
    // client-supplied value is overwritten rather than trusted.
    await client.query(
      `update public.categories set archived_at = now(), updated_at = '2000-01-01T00:00:00Z' where id = $1`,
      [category.id]
    )
    const archived = await client.query(
      `select archived_at, updated_at, updated_at = now() as database_authored
       from public.categories where id = $1`,
      [category.id]
    )
    assert.notEqual(archived.rows[0].archived_at, null)
    assert.equal(archived.rows[0].database_authored, true, 'updated_at is database-authored')

    await client.query(`update public.categories set archived_at = null where id = $1`, [category.id])
    const reactivated = await client.query(
      `select archived_at from public.categories where id = $1`,
      [category.id]
    )
    assert.equal(reactivated.rows[0].archived_at, null)
  })
})

test('category identity and creation evidence are immutable', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 stable identity')
    await expectReject(
      client,
      () => client.query(`update public.categories set id = gen_random_uuid() where id = $1`, [category.id]),
      /SHR196_CATEGORY_IDENTITY_IMMUTABLE/
    )
    await expectReject(
      client,
      () =>
        client.query(`update public.categories set created_at = $2 where id = $1`, [
          category.id,
          '2000-01-01T00:00:00Z',
        ]),
      /SHR196_CATEGORY_CREATED_AT_IMMUTABLE/
    )
  })
})

// ── 5. History versus aliases ────────────────────────────────────────────

test('a rename records immutable history and creates no resolver alias', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 before rename')

    await actAs(client, 'authenticated', SHREY_ID)
    await client.query(`update public.categories set name = 'SHR196 after rename' where id = $1`, [
      category.id,
    ])
    await client.query('reset role')

    const { rows: history } = await client.query(
      `select previous_name, new_name, changed_by_access_user_id, change_reason_code, schema_version
       from public.category_name_history where category_id = $1`,
      [category.id]
    )
    assert.equal(history.length, 1)
    assert.equal(history[0].previous_name, 'SHR196 before rename')
    assert.equal(history[0].new_name, 'SHR196 after rename')
    assert.equal(history[0].changed_by_access_user_id, SHREY_ID, 'the access actor is recorded, not inferred')
    assert.equal(history[0].change_reason_code, 'direct_name_change')

    const { rows: aliases } = await client.query(
      `select count(*)::integer as aliases from public.category_aliases where category_id = $1`,
      [category.id]
    )
    assert.equal(aliases[0].aliases, 0, 'history must never silently become an active resolver alias')
  })
})

test('immutable history cannot be updated or deleted by any path', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 history immutability')
    await client.query(`update public.categories set name = 'SHR196 history immutability v2' where id = $1`, [
      category.id,
    ])

    await expectReject(
      client,
      () => client.query(`update public.category_name_history set new_name = 'forged'`),
      /immutable/i
    )
    await expectReject(client, () => client.query(`delete from public.category_name_history`), /immutable/i)
    await expectReject(
      client,
      () => client.query('truncate table public.category_name_history cascade'),
      /SHR196_CATEGORY_TRUNCATE_FORBIDDEN/
    )
  })
})

test('a historical label is not globally reserved just because it appears in history', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 released label')
    await client.query(`update public.categories set name = 'SHR196 released label v2' where id = $1`, [
      category.id,
    ])
    const reused = await makeCategory(client, 'SHR196 released label')
    assert.equal(reused.name, 'SHR196 released label')
  })
})

test('an alias distinguishes compatibility-active from retired history-only state', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 alias owner')
    await client.query(`update public.categories set name = 'SHR196 alias owner v2' where id = $1`, [
      category.id,
    ])
    const { rows: history } = await client.query(
      `select name_history_id from public.category_name_history where category_id = $1`,
      [category.id]
    )

    const { rows: registered } = await client.query(
      `select * from private.register_category_alias_v1($1::uuid, 'SHR196 alias owner', $2::uuid)`,
      [category.id, history[0].name_history_id]
    )
    assert.equal(registered[0].state, 'compatibility_active')
    assert.equal(registered[0].retired_at, null)

    // While compatibility depends on it, the label is unambiguous.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.categories (name, "group") values ('SHR196 alias owner', 'Wants')`
        ),
      /SHR196_CATEGORY_NAME_ALIAS_CONFLICT/
    )

    const { rows: retired } = await client.query(
      `select * from private.retire_category_alias_v1($1::uuid)`,
      [registered[0].alias_id]
    )
    assert.equal(retired[0].state, 'history_only')
    assert.notEqual(retired[0].retired_at, null)

    // history_only is terminal: a retired alias can never quietly resume
    // categorizing new facts.
    await expectReject(
      client,
      () =>
        client.query(
          `update public.category_aliases set state = 'compatibility_active', retired_at = null where alias_id = $1`,
          [registered[0].alias_id]
        ),
      /SHR196_ALIAS_STATE_TRANSITION_INVALID/
    )

    // And the released label is available again — retirement is not a
    // permanent reservation of an ordinary former name.
    const reused = await makeCategory(client, 'SHR196 alias owner')
    assert.equal(reused.name, 'SHR196 alias owner')
  })
})

test('a retired alias may coexist with a category that later took its label', async () => {
  await withTx(async (client) => {
    // Retirement releases the label, so this pair is a legitimate state — and
    // an encrypted backup has to be restorable back into it.
    const category = await makeCategory(client, 'SHR196 released alias label owner')
    const { rows: alias } = await client.query(
      `select * from private.register_category_alias_v1($1::uuid, 'SHR196 released alias label', null)`,
      [category.id]
    )
    await client.query(`select private.retire_category_alias_v1($1::uuid)`, [alias[0].alias_id])
    const reused = await makeCategory(client, 'SHR196 released alias label')
    assert.equal(reused.name, 'SHR196 released alias label')

    // But a compatibility-active alias for that label is now ambiguous.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.register_category_alias_v1($1::uuid, 'SHR196 released alias label', null)`,
          [category.id]
        ),
      /SHR196_ALIAS_NAME_CONFLICTS_WITH_CURRENT_CATEGORY/
    )
  })
})

test('alias rows are otherwise immutable and never deleted', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 alias immutability')
    const { rows: alias } = await client.query(
      `select * from private.register_category_alias_v1($1::uuid, 'SHR196 alias immutability legacy', null)`,
      [category.id]
    )
    await expectReject(
      client,
      () =>
        client.query(`update public.category_aliases set alias_name = 'forged' where alias_id = $1`, [
          alias[0].alias_id,
        ]),
      /SHR196_ALIAS_IMMUTABLE_FIELD/
    )
    await expectReject(
      client,
      () => client.query(`delete from public.category_aliases where alias_id = $1`, [alias[0].alias_id]),
      /SHR196_ALIAS_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query('truncate table public.category_aliases'),
      /SHR196_CATEGORY_TRUNCATE_FORBIDDEN/
    )
  })
})

test('an alias may not duplicate a current category name or another active alias', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 alias collisions')
    const other = await makeCategory(client, 'SHR196 alias collisions other')

    await expectReject(
      client,
      () =>
        client.query(
          `select private.register_category_alias_v1($1::uuid, 'SHR196 alias collisions other', null)`,
          [category.id]
        ),
      /SHR196_ALIAS_NAME_CONFLICTS_WITH_CURRENT_CATEGORY/
    )

    await client.query(
      `select private.register_category_alias_v1($1::uuid, 'SHR196 shared legacy label', null)`,
      [category.id]
    )
    await expectReject(
      client,
      () =>
        client.query(
          `select private.register_category_alias_v1($1::uuid, 'SHR196 shared legacy label', null)`,
          [other.id]
        ),
      /category_aliases_active_name_uidx/
    )
  })
})

// ── 6. Authorization, RLS and ACLs ───────────────────────────────────────

test('history and alias evidence is member-readable and writable by no API role', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        c.relname,
        c.relrowsecurity as rls_enabled,
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        has_table_privilege('anon', c.oid, 'insert,update,delete') as anon_write,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
        has_table_privilege('authenticated', c.oid, 'insert,update,delete') as authenticated_write,
        has_table_privilege('service_role', c.oid, 'select') as service_select,
        has_table_privilege('service_role', c.oid, 'insert,update,delete') as service_write
      from pg_class c
      where c.oid in ('public.category_name_history'::regclass, 'public.category_aliases'::regclass)
      order by c.relname
    `)
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.rls_enabled, true, `${row.relname} must enforce RLS`)
      assert.equal(row.anon_select, false, `${row.relname} must not be readable anonymously`)
      assert.equal(row.anon_write, false)
      assert.equal(row.authenticated_select, true, `${row.relname} is household-readable evidence`)
      assert.equal(row.authenticated_write, false, `${row.relname} must not be browser-writable`)
      assert.equal(row.service_select, true, 'the encrypted backup exporter needs the raw read')
      assert.equal(row.service_write, false, 'no service path writes evidence directly')
    }
  })
})

test('the new policies authorize through the existing household membership root only', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname, cmd, roles::text as roles, qual, with_check
      from pg_policies
      where tablename in ('category_name_history', 'category_aliases')
      order by tablename
    `)
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.cmd, 'SELECT', 'evidence is read-only to members')
      assert.match(row.roles, /authenticated/)
      assert.match(row.qual, /private\.is_household_member\(\)/)
      assert.doesNotMatch(
        `${row.qual} ${row.with_check ?? ''}`,
        /system_code|archived_at|owner|party/,
        'category lifecycle must never become an authorization predicate'
      )
      assert.equal(row.with_check, null)
    }
  })
})

test('the existing household authorization model is unchanged', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select policyname, cmd, qual, with_check
      from pg_policies
      where tablename = 'categories'
    `)
    assert.equal(rows.length, 1, 'categories keeps exactly its one inherited household policy')
    assert.equal(rows[0].policyname, 'household_all')
    assert.equal(rows[0].cmd, 'ALL')
    assert.match(rows[0].qual, /private\.is_household_member\(\)/)
    assert.match(rows[0].with_check, /private\.is_household_member\(\)/)

    // No new role of any kind was invented.
    const { rows: roles } = await client.query(`
      select rolname from pg_roles
      where rolname ilike '%taxonom%' or rolname ilike '%category%' or rolname ilike '%admin%'
    `)
    assert.deepEqual(roles, [], 'SHR-196 must not invent a taxonomy administrator')
  })
})

test('every new function is least-privilege, pinned and uncallable by API roles', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        p.proname,
        n.nspname as schema_name,
        p.proconfig @> array['search_path=""']::text[] as search_path_is_empty,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname in (
        'category_operator_authority', 'guard_category_lifecycle', 'record_category_name_history',
        'reject_category_history_mutation', 'guard_category_history_insert',
        'guard_category_alias_lifecycle', 'reject_category_truncate',
        'assign_category_system_code_v1', 'register_category_alias_v1', 'retire_category_alias_v1'
      )
      order by p.proname
    `)
    assert.equal(rows.length, 10, 'every SHR-196 function must be accounted for')
    for (const row of rows) {
      assert.equal(row.schema_name, 'private', `${row.proname} must not be a PostgREST RPC target`)
      assert.equal(row.search_path_is_empty, true, `${row.proname} must pin an empty search_path`)
      assert.equal(row.anon_execute, false, `${row.proname} must not be executable by anon`)
      assert.equal(row.authenticated_execute, false, `${row.proname} must not be executable by a browser`)
      assert.equal(row.service_execute, false, `${row.proname} must not be executable by service_role`)
    }
  })
})

test('anon reaches no category lifecycle mutation', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 anon probe')
    await actAs(client, 'anon')

    // Household RLS filters every row away before the lifecycle guard is
    // reached, so anon's writes are not errors — they are no-ops on nothing.
    // What matters is that no row is touched and nothing is visible.
    const { rows } = await client.query(
      `select count(*)::integer as visible from public.categories where id = $1`,
      [category.id]
    )
    assert.equal(rows[0].visible, 0, 'anon must not see household categories at all')

    for (const statement of [
      `update public.categories set system_code = 'transfer' where id = $1`,
      `update public.categories set archived_at = now() where id = $1`,
      `update public.categories set name = 'anon rename' where id = $1`,
      `delete from public.categories where id = $1`,
    ]) {
      const result = await client.query(statement, [category.id])
      assert.equal(result.rowCount, 0, `anon must not reach: ${statement}`)
    }

    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.categories (name, "group") values ('SHR196 anon insert', 'Wants')`
        ),
      /permission denied|row-level security/i
    )
    await expectReject(
      client,
      () => client.query('select 1 from public.category_name_history'),
      /permission denied/i
    )
    await expectReject(
      client,
      () => client.query('select 1 from public.category_aliases'),
      /permission denied/i
    )
    await client.query('reset role')

    const untouched = await client.query(
      `select name, system_code, archived_at from public.categories where id = $1`,
      [category.id]
    )
    assert.equal(untouched.rows[0].name, 'SHR196 anon probe')
    assert.equal(untouched.rows[0].system_code, null)
    assert.equal(untouched.rows[0].archived_at, null)
  })
})

// ── 7. Consumer behaviour is untouched ───────────────────────────────────

test('the household can still create and rename ordinary categories exactly as before', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows: created } = await client.query(
      `insert into public.categories (name, "group", icon) values ('SHR196 v1 parity', 'Needs', '🧾') returning *`
    )
    assert.equal(created[0].system_code, null, 'a new category is ordinary by default')
    assert.equal(created[0].archived_at, null)

    const { rows: renamed } = await client.query(
      `update public.categories set name = 'SHR196 v1 parity renamed' where id = $1 returning name`,
      [created[0].id]
    )
    assert.equal(renamed[0].name, 'SHR196 v1 parity renamed')
    await client.query('reset role')
  })
})

test('legacy Transfer and Savings & Investments classification behaviour is unchanged', async () => {
  await withTx(async (client) => {
    // 044's validated manual writer still resolves a category by its current
    // name and still refuses Transfer. SHR-196 changed neither.
    const { rows } = await client.query(`
      select
        (select "group" from public.categories where name = 'Transfer') as transfer_group,
        (select "group" from public.categories where name = 'Savings & Investments') as savings_group,
        (select count(*)::integer from public.categories
           where name in ('Transfer', 'Savings & Investments') and system_code is not null) as coded
    `)
    assert.equal(rows[0].transfer_group, 'Transfer', 'the legacy Transfer row keeps its group')
    assert.equal(rows[0].savings_group, 'Savings')
    assert.equal(rows[0].coded, 0, 'SHR-197 owns provenance-reviewed system-code assignment')

    // The migration itself never writes a literal code, and the database it
    // produced carries no lifecycle evidence at all: nothing was synthesized.
    assert.doesNotMatch(
      MIGRATION_SOURCE,
      /system_code\s*=\s*'(transfer|savings_investment)'/i,
      'migration 046 must not write a literal system code onto a row'
    )
    const { rows: evidence } = await client.query(`
      select
        (select count(*)::integer from public.category_name_history) as history_rows,
        (select count(*)::integer from public.category_aliases) as alias_rows
    `)
    assert.equal(evidence[0].history_rows, 0, 'no rename history may be fabricated')
    assert.equal(evidence[0].alias_rows, 0, 'no compatibility alias may be pre-registered')
  })
})

// ── 8. Backup and representative restore ─────────────────────────────────

test('the encrypted backup covers the new evidence and a restore preserves it', async () => {
  await withTx(async (client) => {
    const category = await makeCategory(client, 'SHR196 backup subject')
    await client.query(`update public.categories set name = 'SHR196 backup subject v2' where id = $1`, [
      category.id,
    ])
    const { rows: historyRows } = await client.query(
      `select name_history_id from public.category_name_history where category_id = $1`,
      [category.id]
    )
    const { rows: aliasRows } = await client.query(
      `select * from private.register_category_alias_v1($1::uuid, 'SHR196 backup subject', $2::uuid)`,
      [category.id, historyRows[0].name_history_id]
    )
    await client.query(`select private.retire_category_alias_v1($1::uuid)`, [aliasRows[0].alias_id])
    const system = await makeSystemCategory(client, 'SHR196 backup anchor', 'transfer')

    // PostgREST exports every row as JSON, so timestamps stay exact strings.
    const asJson = async (sql, params) =>
      (await client.query(sql, params)).rows.map(({ row }) => row)

    const categories = await asJson(
      `select to_jsonb(c) as row from public.categories c where c.id = any($1::uuid[])`,
      [[category.id, system.id]]
    )
    const history = await asJson(
      `select to_jsonb(h) as row from public.category_name_history h where h.category_id = $1`,
      [category.id]
    )
    const aliases = await asJson(
      `select to_jsonb(a) as row from public.category_aliases a where a.category_id = $1`,
      [category.id]
    )

    const exported = { categories, category_name_history: history, category_aliases: aliases }
    const backup = await buildBackup(
      async (table) => exported[table] ?? [],
      '046_category_lifecycle_protection',
      () => '2026-08-31T00:00:00.000Z'
    )

    for (const name of ['category_name_history', 'category_aliases']) {
      assert.ok(
        BACKUP_TABLES.some((table) => table.name === name && table.financial),
        `${name} must be in the backup manifest as financial record`
      )
    }
    assert.equal(backup.meta.row_counts.category_name_history, 1)
    assert.equal(backup.meta.row_counts.category_aliases, 1)

    // Representative restore: the same column definitions, the same
    // constraints, and the same protections re-attached.
    await client.query(`
      create temporary table restored_categories
        (like public.categories including all) on commit drop;
      create temporary table restored_category_name_history
        (like public.category_name_history including all) on commit drop;
      create temporary table restored_category_aliases
        (like public.category_aliases including all) on commit drop;
      create trigger restored_history_immutable
        before update or delete on restored_category_name_history
        for each row execute function private.reject_category_history_mutation();
    `)

    for (const [table, rows] of [
      ['restored_categories', backup.tables.categories],
      ['restored_category_name_history', backup.tables.category_name_history],
      ['restored_category_aliases', backup.tables.category_aliases],
    ]) {
      for (const row of rows) {
        await client.query(
          `insert into ${table} select (jsonb_populate_record(null::${table}, $1::jsonb)).*`,
          [JSON.stringify(row)]
        )
      }
    }

    const restoredCategories = await asJson(
      `select to_jsonb(r) as row from restored_categories r order by r.name`
    )
    const sourceCategories = await asJson(
      `select to_jsonb(c) as row from public.categories c where c.id = any($1::uuid[]) order by c.name`,
      [[category.id, system.id]]
    )
    assert.deepEqual(restoredCategories, sourceCategories, 'ids, names, codes and lifecycle survive')
    assert.deepEqual(
      await asJson(`select to_jsonb(r) as row from restored_category_name_history r`),
      history,
      'immutable history survives'
    )
    assert.deepEqual(
      await asJson(`select to_jsonb(r) as row from restored_category_aliases r`),
      aliases,
      'alias lifecycle state survives'
    )

    // The restored data still obeys the contract it was exported under.
    await expectReject(
      client,
      () => client.query(`update restored_categories set system_code = 'not_a_code'`),
      /system_code_check/
    )
    await expectReject(
      client,
      // Both restored rows would claim the same semantic.
      () => client.query(`update restored_categories set system_code = 'savings_investment'`),
      /system_code/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `update restored_categories set archived_at = now() where system_code is not null`
        ),
      /categories_system_not_archivable_check/
    )
    await expectReject(
      client,
      () => client.query(`update restored_category_name_history set new_name = 'forged'`),
      /immutable/i
    )
    await expectReject(
      client,
      () => client.query(`delete from restored_category_name_history`),
      /immutable/i
    )
    // Constraints survive the restore on their own...
    await expectReject(
      client,
      () => client.query(`update restored_category_aliases set retired_at = null`),
      /category_aliases_retirement_check/
    )
    // ...and once the lifecycle guard is re-attached, history_only is still
    // terminal and alias evidence is still undeletable in the restored copy.
    await client.query(`
      create trigger restored_alias_guard
        before insert or update or delete on restored_category_aliases
        for each row execute function private.guard_category_alias_lifecycle()
    `)
    await expectReject(
      client,
      () =>
        client.query(
          `update restored_category_aliases set state = 'compatibility_active', retired_at = null`
        ),
      /SHR196_ALIAS_STATE_TRANSITION_INVALID/
    )
    await expectReject(
      client,
      () => client.query(`delete from restored_category_aliases`),
      /SHR196_ALIAS_DELETE_FORBIDDEN/
    )
  })
})
