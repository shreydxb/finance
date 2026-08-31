// SHR-197 — stable category-reference reconciliation and evidence manifest.
// Every mapping here is an explicit controlled fixture. Nothing in this suite
// encodes or approves a production UUID mapping.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'
import { buildBackup } from '../functions/backup/dump.ts'

async function makeCategory(client, name, { archived = false } = {}) {
  const { rows } = await client.query(
    `insert into public.categories (name, "group", archived_at)
     values ($1, 'Wants', $2) returning *`,
    [name, archived ? '2026-01-01T00:00:00Z' : null]
  )
  return rows[0]
}

async function makeTransaction(client, accountId, category, { deleted = false } = {}) {
  const { rows } = await client.query(
    `insert into public.transactions (date, amount, account_id, category, deleted_at)
     values ('2026-08-31', 12.34, $1, $2, $3) returning *`,
    [accountId, category, deleted ? '2026-09-01T00:00:00Z' : null]
  )
  return rows[0]
}

async function makeRule(client, category) {
  const { rows } = await client.query(
    `insert into public.category_rules (pattern, category)
     values ($1, $2) returning *`,
    [`pattern-${crypto.randomUUID()}`, category]
  )
  return rows[0]
}

async function fixture(client, { includeUnknown = true, includeArchived = false } = {}) {
  const suffix = crypto.randomUUID()
  const { rows: accounts } = await client.query(
    `insert into public.accounts (name, owner, type, value)
     values ($1, 'Fixture', 'cash', 0) returning id`,
    [`SHR197 account ${suffix}`]
  )
  const transfer = await makeCategory(client, `SHR197 Transfer ${suffix}`)
  const savings = await makeCategory(client, `SHR197 Savings ${suffix}`)
  const ordinary = await makeCategory(client, `SHR197 Ordinary ${suffix}`)
  const archived = includeArchived
    ? await makeCategory(client, `SHR197 Archived ${suffix}`, { archived: true })
    : null
  const unknown = `SHR197 Unknown ${suffix}`

  const active = await makeTransaction(client, accounts[0].id, ordinary.name)
  const softDeleted = await makeTransaction(client, accounts[0].id, transfer.name, { deleted: true })
  const savingsTx = await makeTransaction(client, accounts[0].id, savings.name)
  const nullTx = await makeTransaction(client, accounts[0].id, null)
  const unknownTx = includeUnknown
    ? await makeTransaction(client, accounts[0].id, unknown)
    : null
  const archivedTx = archived
    ? await makeTransaction(client, accounts[0].id, archived.name)
    : null
  const rule = await makeRule(client, ordinary.name)
  const unknownRule = includeUnknown ? await makeRule(client, unknown) : null

  return {
    transfer,
    savings,
    ordinary,
    archived,
    unknown,
    rows: { active, softDeleted, savingsTx, nullTx, unknownTx, archivedTx, rule, unknownRule },
  }
}

async function preflight(client) {
  const { rows } = await client.query('select * from private.category_reconciliation_preflight_v1()')
  return rows[0]
}

function manifestFor(f, overrides = {}) {
  const classifications = [
    { legacy_label: f.transfer.name, resolution: 'mapped', category_id: f.transfer.id },
    { legacy_label: f.savings.name, resolution: 'mapped', category_id: f.savings.id },
    { legacy_label: f.ordinary.name, resolution: 'mapped', category_id: f.ordinary.id },
  ]
  if (f.archived) {
    classifications.push({
      legacy_label: f.archived.name,
      resolution: 'mapped',
      category_id: f.archived.id,
    })
  }
  if (f.rows.unknownTx || f.rows.unknownRule) {
    classifications.push({ legacy_label: f.unknown, resolution: 'unresolved_unknown' })
  }
  return {
    systemCategories: [
      { system_code: 'transfer', category_id: f.transfer.id },
      { system_code: 'savings_investment', category_id: f.savings.id },
    ],
    classifications,
    ...overrides,
  }
}

async function reconcile(client, f, { manifestRef = `SHR197-${crypto.randomUUID()}`, expected = {}, manifest = {} } = {}) {
  const pre = await preflight(client)
  const m = manifestFor(f, manifest)
  const { rows } = await client.query(
    `select private.reconcile_category_references_v1(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13
    ) as result`,
    [
      manifestRef,
      expected.digest ?? pre.source_state_digest,
      expected.categoryCount ?? pre.category_count,
      expected.transactionCount ?? pre.transaction_count,
      expected.ruleCount ?? pre.category_rule_count,
      expected.nullCount ?? pre.null_transaction_category_count,
      expected.softDeletedCount ?? pre.soft_deleted_transaction_count,
      expected.labelCount ?? pre.distinct_legacy_label_count,
      expected.unknownCount ?? pre.unknown_label_count,
      expected.runCount ?? pre.reconciliation_run_count,
      JSON.stringify(m.systemCategories),
      JSON.stringify(m.classifications),
      null,
    ]
  )
  return rows[0].result
}

async function evidenceCounts(client) {
  const { rows } = await client.query(`select
    (select count(*)::integer from public.category_reconciliation_runs) as runs,
    (select count(*)::integer from public.category_reconciliation_system_entries) as systems,
    (select count(*)::integer from public.category_reconciliation_manifest_entries) as manifests,
    (select count(*)::integer from public.category_reconciliation_row_evidence) as rows,
    (select count(*)::integer from public.category_reconciliation_replay_evidence) as replays,
    (select count(*)::integer from public.categories where system_code is not null) as codes,
    (select count(*)::integer from public.transactions where category_id is not null) as tx_refs,
    (select count(*)::integer from public.category_rules where category_id is not null) as rule_refs`)
  return rows[0]
}

test('050 is additive and inert: nullable references exist but nothing is seeded or backfilled', async () => {
  await withTx(async (client) => {
    const { rows: columns } = await client.query(`
      select table_name, is_nullable, column_default
      from information_schema.columns
      where table_schema='public' and column_name='category_id'
        and table_name in ('transactions','category_rules') order by table_name`)
    assert.deepEqual(columns, [
      { table_name: 'category_rules', is_nullable: 'YES', column_default: null },
      { table_name: 'transactions', is_nullable: 'YES', column_default: null },
    ])
    assert.deepEqual(await evidenceCounts(client), {
      runs: 0, systems: 0, manifests: 0, rows: 0, replays: 0, codes: 0, tx_refs: 0, rule_refs: 0,
    })
  })
})

test('preflight is exact, deterministic, read-only, and covers soft-delete/NULL/unknown state', async () => {
  await withTx(async (client) => {
    await fixture(client)
    const before = await evidenceCounts(client)
    const one = await preflight(client)
    const two = await preflight(client)
    assert.match(one.source_state_digest, /^sha256:[0-9a-f]{64}$/)
    assert.equal(one.source_state_digest, two.source_state_digest)
    assert.equal(one.classification_text_digest, two.classification_text_digest)
    assert.ok(one.soft_deleted_transaction_count >= 1)
    assert.ok(one.null_transaction_category_count >= 1)
    assert.ok(one.unknown_label_count >= 1)
    assert.equal(one.ambiguous_label_count, 0)
    assert.deepEqual(await evidenceCounts(client), before)
    assert.ok(Array.isArray(one.roster.categories))
    assert.ok(Array.isArray(one.roster.legacy_labels))
  })
})

test('an exact explicit manifest resolves active, soft-deleted and rule rows while preserving all text', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const textBefore = await client.query(`select
      (select jsonb_agg(jsonb_build_array(id,category) order by id) from public.transactions) as tx,
      (select jsonb_agg(jsonb_build_array(id,category) order by id) from public.category_rules) as rules`)
    const result = await reconcile(client, f)
    assert.equal(result.replayed, false)

    const { rows: tx } = await client.query(
      `select id, category, category_id, deleted_at from public.transactions
       where id = any($1::uuid[]) order by id`,
      [[f.rows.active.id, f.rows.softDeleted.id, f.rows.savingsTx.id, f.rows.nullTx.id, f.rows.unknownTx.id]]
    )
    assert.equal(tx.find((r) => r.id === f.rows.active.id).category_id, f.ordinary.id)
    assert.equal(tx.find((r) => r.id === f.rows.softDeleted.id).category_id, f.transfer.id)
    assert.ok(tx.find((r) => r.id === f.rows.softDeleted.id).deleted_at)
    assert.equal(tx.find((r) => r.id === f.rows.nullTx.id).category_id, null)
    assert.equal(tx.find((r) => r.id === f.rows.unknownTx.id).category_id, null)
    assert.equal(
      (await client.query(`select category_id from public.category_rules where id=$1`, [f.rows.rule.id])).rows[0].category_id,
      f.ordinary.id
    )

    const textAfter = await client.query(`select
      (select jsonb_agg(jsonb_build_array(id,category) order by id) from public.transactions) as tx,
      (select jsonb_agg(jsonb_build_array(id,category) order by id) from public.category_rules) as rules`)
    assert.deepEqual(textAfter.rows[0], textBefore.rows[0], 'legacy text is byte-identical')

    const { rows: codes } = await client.query(
      `select id, system_code from public.categories where id = any($1::uuid[]) order by system_code`,
      [[f.transfer.id, f.savings.id]]
    )
    assert.deepEqual(codes.map((r) => r.system_code), ['savings_investment', 'transfer'])
    const { rows: mismatch } = await client.query(
      `select * from private.category_reconciliation_mismatch_report_v1($1)`,
      [result.run_id]
    )
    assert.deepEqual(mismatch, [])
  })
})

test('NULL stays NULL and Other remains an ordinary, distinct resolved category', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false })
    const { rows: otherRows } = await client.query(`select * from public.categories where name='Other'`)
    const other = otherRows[0]
    const { rows: accountRows } = await client.query(`select account_id from public.transactions where id=$1`, [f.rows.nullTx.id])
    const otherTx = await makeTransaction(client, accountRows[0].account_id, 'Other')
    const m = manifestFor(f)
    m.classifications.push({ legacy_label: 'Other', resolution: 'mapped', category_id: other.id })
    await reconcile(client, f, { manifest: m })
    const { rows } = await client.query(
      `select id, category, category_id from public.transactions where id=any($1::uuid[]) order by id`,
      [[f.rows.nullTx.id, otherTx.id]]
    )
    assert.equal(rows.find((r) => r.id === f.rows.nullTx.id).category, null)
    assert.equal(rows.find((r) => r.id === f.rows.nullTx.id).category_id, null)
    assert.equal(rows.find((r) => r.id === otherTx.id).category, 'Other')
    assert.equal(rows.find((r) => r.id === otherTx.id).category_id, other.id)
  })
})

test('the explicit UUID wins; no live category-name join chooses the written reference', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false })
    const m = manifestFor(f)
    const ordinary = m.classifications.find((entry) => entry.legacy_label === f.ordinary.name)
    ordinary.category_id = f.savings.id
    await reconcile(client, f, { manifest: m })
    const { rows } = await client.query(`select category, category_id from public.transactions where id=$1`, [f.rows.active.id])
    assert.equal(rows[0].category, f.ordinary.name)
    assert.equal(rows[0].category_id, f.savings.id)
  })
})

test('unknown labels must remain unresolved and are recorded per row', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const result = await reconcile(client, f)
    const { rows } = await client.query(
      `select subject_kind, subject_id, resolution, category_id
       from public.category_reconciliation_row_evidence
       where run_id=$1 and legacy_label=$2 order by subject_kind`,
      [result.run_id, f.unknown]
    )
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.resolution === 'unresolved_unknown' && r.category_id === null))
  })
})

test('mapping an unknown label is refused before the first write', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const m = manifestFor(f)
    const unknown = m.classifications.find((entry) => entry.legacy_label === f.unknown)
    unknown.resolution = 'mapped'
    unknown.category_id = f.ordinary.id
    await expectReject(client, () => reconcile(client, f, { manifest: m }), /SHR197_UNKNOWN_LABEL_MUST_REMAIN_UNRESOLVED/)
    assert.deepEqual(await evidenceCounts(client), {
      runs: 0, systems: 0, manifests: 0, rows: 0, replays: 0, codes: 0, tx_refs: 0, rule_refs: 0,
    })
  })
})

test('a stale preflight digest or count aborts before any mutation', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    await expectReject(client, () => reconcile(client, f, { expected: { digest: `sha256:${'0'.repeat(64)}` } }), /SHR197_PREFLIGHT_DIGEST_STALE/)
    await expectReject(client, () => reconcile(client, f, { expected: { transactionCount: 999999 } }), /SHR197_PREFLIGHT_COUNTS_STALE/)
    assert.equal((await evidenceCounts(client)).runs, 0)
    assert.equal((await evidenceCounts(client)).codes, 0)
  })
})

test('manifest coverage is exhaustive and duplicate labels fail as ambiguity', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const incomplete = manifestFor(f)
    incomplete.classifications.pop()
    await expectReject(client, () => reconcile(client, f, { manifest: incomplete }), /SHR197_MANIFEST_LABEL_COVERAGE_MISMATCH/)

    const duplicate = manifestFor(f)
    duplicate.classifications.push({ ...duplicate.classifications[0] })
    await expectReject(client, () => reconcile(client, f, { manifest: duplicate }), /SHR197_MANIFEST_LABEL_AMBIGUOUS/)
    assert.equal((await evidenceCounts(client)).runs, 0)
  })
})

test('an ambiguous live name/alias source state fails closed before any mutation', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false })
    await client.query(`alter table public.category_aliases disable trigger category_aliases_lifecycle_guard`)
    await client.query(
      `insert into public.category_aliases(category_id,alias_name,state)
       values($1,$2,'compatibility_active')`,
      [f.transfer.id, f.ordinary.name]
    )
    await client.query(`alter table public.category_aliases enable trigger category_aliases_lifecycle_guard`)
    const pre = await preflight(client)
    assert.equal(pre.ambiguous_label_count, 1)
    await expectReject(
      client,
      () => reconcile(client, f),
      /SHR197_PREFLIGHT_AMBIGUOUS_LABELS/
    )
    assert.equal((await evidenceCounts(client)).runs, 0)
    assert.equal((await evidenceCounts(client)).codes, 0)
  })
})

test('the system-code manifest is exactly the two-code allowlist on distinct explicit UUIDs', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    for (const systemCategories of [
      [{ system_code: 'transfer', category_id: f.transfer.id }],
      [
        { system_code: 'transfer', category_id: f.transfer.id },
        { system_code: 'uncategorized', category_id: f.savings.id },
      ],
      [
        { system_code: 'transfer', category_id: f.transfer.id },
        { system_code: 'savings_investment', category_id: f.transfer.id },
      ],
    ]) {
      const m = manifestFor(f)
      m.systemCategories = systemCategories
      await expectReject(client, () => reconcile(client, f, { manifest: m }), /SHR197_SYSTEM_/)
    }
    assert.equal((await evidenceCounts(client)).codes, 0)
  })
})

test('bogus and cross-object UUIDs fail closed before writes', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const m = manifestFor(f)
    m.classifications.find((entry) => entry.legacy_label === f.ordinary.name).category_id =
      '00000000-0000-0000-0000-00000000dead'
    await expectReject(client, () => reconcile(client, f, { manifest: m }), /SHR197_MANIFEST_CATEGORY_UNKNOWN/)

    const { rows: account } = await client.query(`select id from public.accounts limit 1`)
    await expectReject(
      client,
      () => client.query(`update public.transactions set category_id=$1 where id=$2`, [account[0].id, f.rows.active.id]),
      /foreign key constraint|transactions_category_id_fkey/
    )
    assert.equal((await evidenceCounts(client)).runs, 0)
  })
})

test('historical rows may resolve to an explicitly reviewed archived ordinary category', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false, includeArchived: true })
    await reconcile(client, f)
    const { rows } = await client.query(`select category_id from public.transactions where id=$1`, [f.rows.archivedTx.id])
    assert.equal(rows[0].category_id, f.archived.id)
    assert.ok(f.archived.archived_at)
  })
})

test('an archived category cannot receive either system code', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeArchived: true })
    const m = manifestFor(f)
    m.systemCategories[0].category_id = f.archived.id
    await expectReject(client, () => reconcile(client, f, { manifest: m }), /SHR197_SYSTEM_CATEGORY_ARCHIVED/)
    assert.equal((await evidenceCounts(client)).codes, 0)
  })
})

test('same reference plus same exact content replays; changed content conflicts', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const manifestRef = `SHR197-replay-${crypto.randomUUID()}`
    const pre = await preflight(client)
    const first = await reconcile(client, f, { manifestRef })
    const counts = await evidenceCounts(client)
    const replay = await reconcile(client, f, {
      manifestRef,
      expected: {
        digest: pre.source_state_digest,
        categoryCount: pre.category_count,
        transactionCount: pre.transaction_count,
        ruleCount: pre.category_rule_count,
        nullCount: pre.null_transaction_category_count,
        softDeletedCount: pre.soft_deleted_transaction_count,
        labelCount: pre.distinct_legacy_label_count,
        unknownCount: pre.unknown_label_count,
        runCount: pre.reconciliation_run_count,
      },
    })
    assert.equal(replay.replayed, true)
    assert.equal(replay.run_id, first.run_id)
    assert.match(replay.replay_id, /^[0-9a-f-]{36}$/)
    assert.deepEqual(await evidenceCounts(client), { ...counts, replays: 1 })

    const changed = manifestFor(f)
    changed.classifications[0].evidence_ref = 'changed-content'
    await expectReject(
      client,
      () => reconcile(client, f, { manifestRef, manifest: changed, expected: {
        digest: pre.source_state_digest,
        categoryCount: pre.category_count,
        transactionCount: pre.transaction_count,
        ruleCount: pre.category_rule_count,
        nullCount: pre.null_transaction_category_count,
        softDeletedCount: pre.soft_deleted_transaction_count,
        labelCount: pre.distinct_legacy_label_count,
        unknownCount: pre.unknown_label_count,
        runCount: pre.reconciliation_run_count,
      } }),
      /SHR197_MANIFEST_CONFLICT/
    )
  })
})

test('a late evidence failure rolls back system codes, references and the run atomically', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    await client.query(`create function pg_temp.fail_shr197_row() returns trigger language plpgsql as $$
      begin raise exception 'fixture late failure'; end $$`)
    await client.query(`create trigger shr197_fixture_late_failure
      before insert on public.category_reconciliation_row_evidence
      for each row execute function pg_temp.fail_shr197_row()`)
    await expectReject(client, () => reconcile(client, f), /fixture late failure/)
    assert.deepEqual(await evidenceCounts(client), {
      runs: 0, systems: 0, manifests: 0, rows: 0, replays: 0, codes: 0, tx_refs: 0, rule_refs: 0,
    })
  })
})

test('reconciliation evidence is append-only and cannot be updated, deleted or truncated', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    await reconcile(client, f)
    for (const table of [
      'category_reconciliation_runs',
      'category_reconciliation_system_entries',
      'category_reconciliation_manifest_entries',
      'category_reconciliation_row_evidence',
      'category_reconciliation_replay_evidence',
    ]) {
      await expectReject(client, () => client.query(`update public.${table} set schema_version=schema_version`), /IMMUTABLE/)
      await expectReject(client, () => client.query(`delete from public.${table}`), /IMMUTABLE/)
      await expectReject(client, () => client.query(`truncate public.${table}`), /TRUNCATE_FORBIDDEN/)
    }
  })
})

test('ordinary API roles cannot write stable refs or call any reconciliation function', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false })
    await reconcile(client, f)
    for (const [role, user] of [['anon', null], ['authenticated', SHREY_ID], ['authenticated', OUTSIDER_ID], ['service_role', null]]) {
      await actAs(client, role, user)
      await expectReject(
        client,
        () => client.query(`update public.transactions set category_id=$1 where id=$2`, [f.savings.id, f.rows.active.id]),
        /SHR197_CATEGORY_REFERENCE_WRITE_FORBIDDEN|permission denied/
      )
      await expectReject(client, () => client.query(`select * from private.category_reconciliation_preflight_v1()`), /permission denied/)
      await client.query('reset role')
    }
    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(
      client,
      () => client.query(`update public.transactions set category='Other' where id=$1`, [f.rows.active.id]),
      /SHR197_RESOLVED_LEGACY_TEXT_WRITE_FORBIDDEN/
    )
    await client.query('reset role')
  })
})

test('existing household authorization policies and ordinary V1 writes are unchanged', async () => {
  await withTx(async (client) => {
    const { rows: policies } = await client.query(`
      select tablename, policyname, cmd, roles::text, qual, with_check
      from pg_policies where schemaname='public'
        and tablename in ('categories','transactions','category_rules') order by tablename`)
    assert.deepEqual(policies.map((p) => [p.tablename, p.policyname, p.cmd]), [
      ['categories', 'household_all', 'ALL'],
      ['category_rules', 'category_rules household all', 'ALL'],
      ['transactions', 'household_all', 'ALL'],
    ])
    assert.ok(policies.every((p) => /is_household_member/.test(`${p.qual} ${p.with_check}`)))
    assert.ok(policies.every((p) => !/category_id|system_code|economic_party/.test(`${p.qual} ${p.with_check}`)))

    await actAs(client, 'authenticated', SHREY_ID)
    const { rows: account } = await client.query(`select id from public.accounts limit 1`)
    const { rows: inserted } = await client.query(
      `insert into public.transactions(date,amount,account_id,category)
       values(current_date,10,$1,'Groceries') returning category,category_id`,
      [account[0].id]
    )
    assert.deepEqual(inserted[0], { category: 'Groceries', category_id: null })
  })
})

test('FKs are RESTRICT and category delete/truncate protections remain intact', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeUnknown: false })
    await reconcile(client, f)
    const { rows: fks } = await client.query(`
      select conname, confdeltype from pg_constraint
      where conname in ('transactions_category_id_fkey','category_rules_category_id_fkey')
      order by conname`)
    assert.deepEqual(fks, [
      { conname: 'category_rules_category_id_fkey', confdeltype: 'r' },
      { conname: 'transactions_category_id_fkey', confdeltype: 'r' },
    ])
    await expectReject(client, () => client.query(`delete from public.categories where id=$1`, [f.ordinary.id]), /SHR196_CATEGORY_DELETE_FORBIDDEN/)
    await expectReject(client, () => client.query(`truncate public.categories`), /TRUNCATE_FORBIDDEN|SHR196/)
  })
})

test('classification digest and canonical V1 outputs are identical before and after', async () => {
  await withTx(async (client) => {
    const f = await fixture(client)
    const beforeDigest = (await preflight(client)).classification_text_digest
    const before = await client.query(`select
      (select jsonb_agg(to_jsonb(v) order by id) from public.v_canonical_ledger_aed v) as ledger,
      (select to_jsonb(x) from public.canonical_period_metrics('2026-01-01','2026-12-31','household') x) as period`)
    const result = await reconcile(client, f)
    const afterDigest = (await client.query(`select private.category_classification_text_digest_v1() as d`)).rows[0].d
    const after = await client.query(`select
      (select jsonb_agg(to_jsonb(v) order by id) from public.v_canonical_ledger_aed v) as ledger,
      (select to_jsonb(x) from public.canonical_period_metrics('2026-01-01','2026-12-31','household') x) as period`)
    assert.equal(afterDigest, beforeDigest)
    assert.deepEqual(after.rows[0], before.rows[0])
    const { rows: run } = await client.query(`select classification_digest_before,classification_digest_after from public.category_reconciliation_runs where run_id=$1`, [result.run_id])
    assert.equal(run[0].classification_digest_before, run[0].classification_digest_after)
  })
})

test('backup export and representative restore preserve refs, codes, NULLs, soft-delete and evidence', async () => {
  await withTx(async (client) => {
    const f = await fixture(client, { includeArchived: true })
    const pre = await preflight(client)
    const manifestRef = `SHR197-backup-${crypto.randomUUID()}`
    const result = await reconcile(client, f, { manifestRef })
    await reconcile(client, f, {
      manifestRef,
      expected: {
        digest: pre.source_state_digest,
        categoryCount: pre.category_count,
        transactionCount: pre.transaction_count,
        ruleCount: pre.category_rule_count,
        nullCount: pre.null_transaction_category_count,
        softDeletedCount: pre.soft_deleted_transaction_count,
        labelCount: pre.distinct_legacy_label_count,
        unknownCount: pre.unknown_label_count,
        runCount: pre.reconciliation_run_count,
      },
    })
    const backup = await buildBackup(async (table) => {
      const { rows } = await client.query(`select to_jsonb(t) as row from public.${table} t`)
      return rows.map((r) => r.row)
    }, '050')
    for (const name of [
      'category_reconciliation_runs',
      'category_reconciliation_system_entries',
      'category_reconciliation_manifest_entries',
      'category_reconciliation_row_evidence',
      'category_reconciliation_replay_evidence',
    ]) assert.ok(backup.tables[name].length > 0)
    assert.ok(backup.tables.transactions.some((r) => r.id === f.rows.softDeleted.id && r.category_id === f.transfer.id && r.deleted_at))
    assert.ok(backup.tables.transactions.some((r) => r.id === f.rows.nullTx.id && r.category === null && r.category_id === null))
    assert.ok(backup.tables.categories.some((r) => r.id === f.archived.id && r.archived_at))
    assert.ok(backup.tables.category_reconciliation_runs.some((r) => r.run_id === result.run_id))

    const restoreTables = [
      'categories',
      'transactions',
      'category_rules',
      'category_reconciliation_runs',
      'category_reconciliation_system_entries',
      'category_reconciliation_manifest_entries',
      'category_reconciliation_row_evidence',
      'category_reconciliation_replay_evidence',
    ]
    for (const table of restoreTables) {
      await client.query(`create temporary table restored_${table}
        (like public.${table} including all)`)
      for (const row of backup.tables[table]) {
        await client.query(
          `insert into restored_${table}
           select * from jsonb_populate_record(null::restored_${table},$1::jsonb)`,
          [JSON.stringify(row)]
        )
      }
    }

    const restoredSoftDeleted = (await client.query(
      `select category,category_id,deleted_at from restored_transactions where id=$1`,
      [f.rows.softDeleted.id]
    )).rows[0]
    assert.equal(restoredSoftDeleted.category, f.transfer.name)
    assert.equal(restoredSoftDeleted.category_id, f.transfer.id)
    assert.ok(restoredSoftDeleted.deleted_at)
    assert.deepEqual((await client.query(
      `select category,category_id from restored_transactions where id=$1`,
      [f.rows.nullTx.id]
    )).rows[0], { category: null, category_id: null })
    assert.equal((await client.query(
      `select system_code from restored_categories where id=$1`, [f.transfer.id]
    )).rows[0].system_code, 'transfer')
    assert.ok((await client.query(
      `select archived_at from restored_categories where id=$1`, [f.archived.id]
    )).rows[0].archived_at)
    assert.equal((await client.query(
      `select count(*)::integer n from restored_category_reconciliation_manifest_entries where run_id=$1`,
      [result.run_id]
    )).rows[0].n, backup.tables.category_reconciliation_manifest_entries.length)
    assert.equal((await client.query(
      `select count(*)::integer n from restored_category_reconciliation_row_evidence where run_id=$1`,
      [result.run_id]
    )).rows[0].n, backup.tables.category_reconciliation_row_evidence.length)
    assert.equal((await client.query(
      `select count(*)::integer n from restored_category_reconciliation_replay_evidence where run_id=$1`,
      [result.run_id]
    )).rows[0].n, 1)
  })
})

test('SHR-197 does not widen audit_events or produce general audit rows', async () => {
  await withTx(async (client) => {
    const before = await client.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.audit_events'::regclass order by conname`)
    const f = await fixture(client)
    await reconcile(client, f)
    const after = await client.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.audit_events'::regclass order by conname`)
    assert.deepEqual(after.rows, before.rows)
    assert.equal((await client.query(`select count(*)::integer as n from public.audit_events`)).rows[0].n, 0)
  })
})
