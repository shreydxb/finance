// setup-db.mjs applying every schema file from empty (npm run test:db:setup)
// is the primary assertion here — it throws and exits non-zero on the first
// statement that fails against a clean database. This file checks the
// objects the rest of the suite depends on actually landed, so a partial
// apply that swallowed an error somewhere fails loudly here too.

import assert from 'node:assert/strict'
import test from 'node:test'
import { withTx } from './helpers.mjs'

test('every RPC the app calls exists after a clean apply', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select proname from pg_proc
      where pronamespace = 'public'::regnamespace
      and proname in (
        'replace_category_split', 'create_goal_contribution', 'create_transfer',
        'create_bulk_transactions', 'apply_pending_income', 'claim_media_group',
        'save_telegram_settings', 'is_household_member'
      )
    `)
    const found = new Set(rows.map((r) => r.proname))
    for (const name of [
      'replace_category_split',
      'create_goal_contribution',
      'create_transfer',
      'create_bulk_transactions',
      'apply_pending_income',
      'claim_media_group',
      'save_telegram_settings',
      'is_household_member',
    ]) {
      assert.ok(found.has(name), `${name} should exist after applying all schema files`)
    }
  })
})

test('no policy is still the pre-023 permissive using(true)/check(true)', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and (qual = 'true' or with_check = 'true')
    `)
    assert.deepEqual(rows, [], 'SEC-02 regressed: a permissive policy is back')
  })
})

test('the idempotency index is a single, non-partial unique index', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select indexname, indexdef from pg_indexes
      where tablename = 'transactions' and indexname like '%idempotency%'
    `)
    assert.equal(rows.length, 1, 'expected exactly one idempotency index (033 drops the 027 one)')
    assert.doesNotMatch(
      rows[0].indexdef,
      /where/i,
      'a partial index here is what caused 42P10 on the PostgREST upsert — see 033'
    )
  })
})

test('every data-writing RPC is SECURITY INVOKER, not DEFINER', async () => {
  // A SECURITY DEFINER data-writing RPC would hand every caller a route
  // around the membership RLS that 023 added. is_household_member() is the
  // one deliberate exception (it has to be, to avoid recursing through its
  // own policy) and is excluded here.
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select proname, prosecdef from pg_proc
      where pronamespace = 'public'::regnamespace
      and proname in (
        'replace_category_split', 'create_goal_contribution', 'create_transfer',
        'create_bulk_transactions', 'apply_pending_income', 'claim_media_group',
        'save_telegram_settings'
      )
    `)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.prosecdef, false, `${row.proname} must not be SECURITY DEFINER`)
    }
  })
})
