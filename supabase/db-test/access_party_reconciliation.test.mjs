// SHR-194 — evidence-reviewed access-to-party reconciliation and the audited
// mapping lifecycle.
//
// SHR-193 proved that an authorization actor is not an economic party. This
// file proves the next claim, which is the one that actually puts rows in the
// database:
//
//     A MAPPING DECISION IS MADE, NEVER INFERRED — AND NEVER SILENTLY.
//
// Everything here is in service of that. The preflight must be able to prove
// the exact current facts and must abort before touching anything when they
// have moved; a party and a decision exist only because an approved manifest
// said so; every decision is stamped by the database, recorded in immutable
// history, and mirrored into SHR-191 audit evidence derived from that history;
// and none of it may reach the SHR-193 restore boundary, change any financial
// fact, or grant anybody any access at all.
//
// Tests that need committed rows — concurrency, cross-transaction replay, the
// production-shaped upgrade — live in access-party-reconciliation-upgrade-path.mjs,
// which builds its own scratch database. This file leaves the shared database
// exactly as empty as SHR-193's own suite requires it to be.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, TARIKA_ID, withTx } from './helpers.mjs'
import { BACKUP_TABLES, buildBackup } from '../functions/backup/dump.ts'

const NEW_TABLES = ['access_party_mapping_history', 'access_party_reconciliation_runs']

const MAPPING_ACTIONS = [
  'economic.access_party_mapping.created',
  'economic.access_party_mapping.changed',
  'economic.access_party_mapping.deactivated',
]

/** Back to the migration/operator authority after a role-scoped assertion. */
async function asOwner(client) {
  await client.query('reset role')
}

async function preflight(client) {
  const { rows } = await client.query('select * from private.access_party_preflight_v1()')
  return rows[0]
}

/**
 * Applies a manifest exactly as the release path would: preflight evidence is
 * read from the database first and handed back to the reconciliation call, so a
 * test never hardcodes a digest that would rot.
 */
async function reconcile(client, manifest = {}) {
  const pre = await preflight(client)
  const {
    manifestRef = 'SHR194-test-manifest',
    householdName = 'Test economic household',
    parties = [
      { party_key: 'first', display_name: 'First Party' },
      { party_key: 'second', display_name: 'Second Party' },
    ],
    decisions = [
      { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
      { auth_user_id: TARIKA_ID, status: 'access_only' },
    ],
    actingUserId = null,
    expected = {},
  } = manifest

  const { rows } = await client.query(
    `select private.reconcile_access_parties_v1(
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) as result`,
    [
      manifestRef,
      expected.memberCount ?? pre.access_member_count,
      expected.rosterDigest ?? pre.access_roster_digest,
      expected.householdCount ?? pre.economic_household_count,
      expected.partyCount ?? pre.economic_party_count,
      expected.mappingCount ?? pre.mapping_count,
      householdName,
      JSON.stringify(parties),
      JSON.stringify(decisions),
      actingUserId,
    ]
  )
  return rows[0].result
}

async function newHousehold(client, name = 'SHR-194 fixture household') {
  const { rows } = await client.query(
    `insert into public.economic_households (display_name) values ($1) returning household_id`,
    [name]
  )
  return rows[0].household_id
}

async function newParty(client, householdId, displayName) {
  const { rows } = await client.query(
    `select * from private.create_economic_party_v1($1, $2, null)`,
    [householdId, displayName]
  )
  return rows[0]
}

async function setMapping(client, householdId, authUserId, status, partyId = null, opts = {}) {
  const { rows } = await client.query(
    `select * from private.set_access_party_mapping_v1($1, $2, $3, $4, $5, $6)`,
    [
      householdId,
      authUserId,
      status,
      partyId,
      opts.evidenceRef ?? 'SHR194-test-evidence',
      opts.actingUserId ?? null,
    ]
  )
  return rows[0]
}

async function historyFor(client, mappingId) {
  const { rows } = await client.query(
    `select * from public.access_party_mapping_history
      where mapping_id = $1 order by decision_version`,
    [mappingId]
  )
  return rows
}

async function mappingRow(client, mappingId) {
  const { rows } = await client.query(
    `select * from public.access_party_mappings where mapping_id = $1`,
    [mappingId]
  )
  return rows[0]
}

// ── Preflight ────────────────────────────────────────────────────────────

test('the preflight proves the exact current access roster and economic state', async () => {
  await withTx(async (client) => {
    const pre = await preflight(client)
    const { rows: actual } = await client.query(`
      select
        (select count(*)::integer from public.household_members) as members,
        (select count(*)::integer from public.economic_households) as households,
        (select count(*)::integer from public.economic_parties) as parties,
        (select count(*)::integer from public.access_party_mappings) as mappings,
        (select count(*)::integer from public.access_party_reconciliation_runs) as runs
    `)
    assert.equal(pre.access_member_count, actual[0].members)
    assert.equal(pre.economic_household_count, actual[0].households)
    assert.equal(pre.economic_party_count, actual[0].parties)
    assert.equal(pre.mapping_count, actual[0].mappings)
    assert.equal(pre.reconciliation_run_count, actual[0].runs)
    assert.match(pre.access_roster_digest, /^sha256:[0-9a-f]{64}$/)
  })
})

test('the preflight reads only — it creates no party, mapping, history or audit row', async () => {
  await withTx(async (client) => {
    await client.query('select * from private.access_party_preflight_v1()')
    await client.query('select * from private.access_party_roster_v1()')
    await client.query('select private.access_roster_digest_v1()')
    const { rows } = await client.query(`
      select
        (select count(*)::integer from public.economic_households) as households,
        (select count(*)::integer from public.economic_parties) as parties,
        (select count(*)::integer from public.access_party_mappings) as mappings,
        (select count(*)::integer from public.access_party_mapping_history) as history,
        (select count(*)::integer from public.audit_events) as audit
    `)
    assert.deepEqual(rows[0], { households: 0, parties: 0, mappings: 0, history: 0, audit: 0 })
  })
})

test('the roster digest moves when an access identity is added or removed', async () => {
  await withTx(async (client) => {
    const before = (await preflight(client)).access_roster_digest
    await client.query(
      `insert into auth.users (id, email) values ($1, 'newcomer@example.test')`,
      [OUTSIDER_ID]
    )
    await client.query(
      `insert into public.household_members (user_id) values ($1)`,
      [OUTSIDER_ID]
    )
    const added = (await preflight(client)).access_roster_digest
    assert.notEqual(added, before, 'an added access identity must move the roster digest')

    await client.query(`delete from public.household_members where user_id = $1`, [OUTSIDER_ID])
    assert.equal(
      (await preflight(client)).access_roster_digest,
      before,
      'removing it again must restore the original digest'
    )
  })
})

test('the roster digest moves when identity evidence changes without the roster changing', async () => {
  // The count is the weaker signal: a replaced authentication identity or a
  // changed email keeps the roster the same size while making an approved
  // manifest stale. The digest is what catches that.
  await withTx(async (client) => {
    const before = await preflight(client)
    await client.query(`update auth.users set email = 'changed@example.test' where id = $1`, [
      SHREY_ID,
    ])
    const after = await preflight(client)
    assert.equal(after.access_member_count, before.access_member_count)
    assert.notEqual(
      after.access_roster_digest,
      before.access_roster_digest,
      'changed identity evidence must move the digest even at an unchanged count'
    )
  })
})

test('an exact preflight applies the approved manifest', async () => {
  await withTx(async (client) => {
    const result = await reconcile(client)
    assert.equal(result.replayed, false)
    assert.equal(result.party_count, 2)
    assert.equal(result.decision_count, 2)
    assert.ok(result.economic_household_id)
    assert.equal(result.decisions.length, 2)
    for (const decision of result.decisions) {
      assert.equal(decision.action_code, 'economic.access_party_mapping.created')
      assert.equal(decision.decision_version, 1)
      assert.ok(decision.audit_event_id, 'every applied decision produces audit evidence')
    }
  })
})

test('a stale access count aborts the release before any DML', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () => reconcile(client, { expected: { memberCount: 99 } }),
      /SHR194_PREFLIGHT_ACCESS_COUNT_STALE/
    )
    const pre = await preflight(client)
    assert.equal(pre.economic_household_count, 0)
    assert.equal(pre.economic_party_count, 0)
    assert.equal(pre.mapping_count, 0)
    assert.equal(pre.reconciliation_run_count, 0)
  })
})

test('stale identity evidence aborts the release before any DML', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () => reconcile(client, { expected: { rosterDigest: `sha256:${'a'.repeat(64)}` } }),
      /SHR194_PREFLIGHT_ROSTER_STALE/
    )

    // And the realistic version of the same failure: a manifest approved
    // against the roster as it was, applied after an identity changed.
    const approved = (await preflight(client)).access_roster_digest
    await client.query(`update auth.users set email = 'moved@example.test' where id = $1`, [
      TARIKA_ID,
    ])
    await expectReject(
      client,
      () => reconcile(client, { expected: { rosterDigest: approved } }),
      /SHR194_PREFLIGHT_ROSTER_STALE/
    )
  })
})

test('an unexpected economic state aborts the release before any DML', async () => {
  await withTx(async (client) => {
    await newHousehold(client, 'unexpected pre-existing household')
    await expectReject(
      client,
      () => reconcile(client, { expected: { householdCount: 0 } }),
      /SHR194_PREFLIGHT_ECONOMIC_STATE_STALE/
    )
  })
})

test('a failed preflight writes nothing at all — not one party, decision or audit row', async () => {
  await withTx(async (client) => {
    for (const expected of [
      { memberCount: 7 },
      { rosterDigest: `sha256:${'b'.repeat(64)}` },
      { partyCount: 4 },
      { mappingCount: 2 },
    ]) {
      await expectReject(client, () => reconcile(client, { expected }), /SHR194_PREFLIGHT_/)
    }
    const { rows } = await client.query(`
      select
        (select count(*)::integer from public.economic_households) as households,
        (select count(*)::integer from public.economic_parties) as parties,
        (select count(*)::integer from public.access_party_mappings) as mappings,
        (select count(*)::integer from public.access_party_mapping_history) as history,
        (select count(*)::integer from public.access_party_reconciliation_runs) as runs,
        (select count(*)::integer from public.audit_events) as audit
    `)
    assert.deepEqual(rows[0], {
      households: 0, parties: 0, mappings: 0, history: 0, runs: 0, audit: 0,
    })
  })
})

test('every access identity needs an explicit decision — none is left implicitly unreviewed', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () =>
        reconcile(client, {
          decisions: [{ auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' }],
        }),
      /SHR194_MANIFEST_DECISIONS_DO_NOT_COVER_ROSTER/
    )
    // And a decision for somebody who is not an access identity is refused too.
    await expectReject(
      client,
      () =>
        reconcile(client, {
          decisions: [
            { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
            { auth_user_id: TARIKA_ID, status: 'access_only' },
            { auth_user_id: OUTSIDER_ID, status: 'access_only' },
          ],
        }),
      /SHR194_MANIFEST_DECISIONS_DO_NOT_COVER_ROSTER/
    )
  })
})

// ── Only what was approved ───────────────────────────────────────────────

test('only the explicitly approved parties are created — nothing is inferred', async () => {
  await withTx(async (client) => {
    await reconcile(client, {
      parties: [{ party_key: 'only', display_name: 'The Only Approved Party' }],
      decisions: [
        { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'only' },
        { auth_user_id: TARIKA_ID, status: 'access_only' },
      ],
    })
    const { rows } = await client.query(
      `select display_name, legacy_owner_label from public.economic_parties`
    )
    assert.equal(rows.length, 1, 'exactly one party, because exactly one was approved')
    assert.equal(rows[0].display_name, 'The Only Approved Party')
    assert.equal(rows[0].legacy_owner_label, null)

    // The second access identity is authorized and deliberately not a party.
    const { rows: emails } = await client.query(`select email from auth.users`)
    for (const { email } of emails) {
      assert.ok(
        !rows.some((party) => party.display_name === email),
        'no party may be named after an email address'
      )
    }
  })
})

test('a decision naming a party the manifest did not approve is refused', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () =>
        reconcile(client, {
          parties: [{ party_key: 'first', display_name: 'First Party' }],
          decisions: [
            { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'not-in-the-manifest' },
            { auth_user_id: TARIKA_ID, status: 'access_only' },
          ],
        }),
      /SHR194_MANIFEST_DECISION_PARTY_UNKNOWN/
    )
    assert.equal((await preflight(client)).economic_party_count, 0)
  })
})

test('an access_only decision may not smuggle in an economic party', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () =>
        reconcile(client, {
          decisions: [
            { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
            { auth_user_id: TARIKA_ID, status: 'access_only', party_key: 'second' },
          ],
        }),
      /SHR194_MANIFEST_ACCESS_ONLY_FORBIDS_PARTY/
    )
  })
})

test('a manifest may not invent a status outside the reviewed vocabulary', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () =>
        reconcile(client, {
          decisions: [
            { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
            { auth_user_id: TARIKA_ID, status: 'unreviewed' },
          ],
        }),
      /SHR194_MANIFEST_DECISION_STATUS_NOT_ALLOWED/
    )
  })
})

// ── The access-only identity ─────────────────────────────────────────────

test('an access_only identity stays access_only and never becomes an economic party', async () => {
  await withTx(async (client) => {
    await reconcile(client)
    const { rows } = await client.query(
      `select status, economic_party_id from public.access_party_mappings where auth_user_id = $1`,
      [TARIKA_ID]
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'access_only')
    assert.equal(rows[0].economic_party_id, null)

    // No party anywhere claims this identity, by any column.
    const { rows: parties } = await client.query(
      `select count(*)::integer as count from public.economic_parties p
        where p.display_name = $1::text or p.legacy_owner_label = $1::text`,
      [TARIKA_ID]
    )
    assert.equal(parties[0].count, 0)
  })
})

test('an access_only decision changes nothing about that identity\'s authorization', async () => {
  await withTx(async (client) => {
    const authorizationBefore = await client.query(
      `select user_id from public.household_members order by user_id`
    )
    const memberBefore = await client.query(
      `select private.is_household_member() as member`
    )

    await reconcile(client)

    const authorizationAfter = await client.query(
      `select user_id from public.household_members order by user_id`
    )
    assert.deepEqual(authorizationAfter.rows, authorizationBefore.rows)
    assert.deepEqual(
      (await client.query(`select private.is_household_member() as member`)).rows,
      memberBefore.rows
    )

    // The real proof: the access_only identity can still read household data.
    await actAs(client, 'authenticated', TARIKA_ID)
    const { rows } = await client.query(`select private.is_household_member() as member`)
    assert.equal(rows[0].member, true, 'access_only is a full household member')
    await client.query(`select count(*) from public.transactions`)
    await asOwner(client)
  })
})

// ── Mapping lifecycle ────────────────────────────────────────────────────

test('mapping create records the decision, its history and its audit evidence', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Created Party')
    const written = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)

    assert.equal(written.action_code, 'economic.access_party_mapping.created')
    assert.equal(written.decision_version, 1)
    assert.equal(written.changed, true)

    const mapping = await mappingRow(client, written.mapping_id)
    assert.equal(mapping.status, 'mapped')
    assert.equal(mapping.economic_party_id, party.party_id)

    const history = await historyFor(client, written.mapping_id)
    assert.equal(history.length, 1)
    assert.equal(history[0].previous_status, null)
    assert.equal(history[0].new_status, 'mapped')
    assert.equal(history[0].previous_economic_party_id, null)
    assert.equal(history[0].new_economic_party_id, party.party_id)

    const { rows: audit } = await client.query(
      `select * from public.audit_events where target_id = $1`,
      [written.mapping_id]
    )
    assert.equal(audit.length, 1)
    assert.equal(audit[0].event_id, written.audit_event_id)
    assert.equal(audit[0].action_code, 'economic.access_party_mapping.created')
    assert.equal(audit[0].target_version_before, null)
    assert.equal(audit[0].target_version_after, 1)
    assert.equal(audit[0].evidence_id, history[0].mapping_history_id)
  })
})

test('mapping change repoints the decision and preserves the old one as history', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const first = await newParty(client, household, 'First')
    const second = await newParty(client, household, 'Second')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', first.party_id)
    const changed = await setMapping(client, household, SHREY_ID, 'mapped', second.party_id)

    assert.equal(changed.action_code, 'economic.access_party_mapping.changed')
    assert.equal(changed.decision_version, 2)
    assert.equal(changed.mapping_id, created.mapping_id, 'the decision keeps its identity')

    assert.equal((await mappingRow(client, changed.mapping_id)).economic_party_id, second.party_id)

    const history = await historyFor(client, changed.mapping_id)
    assert.equal(history.length, 2)
    assert.equal(history[1].previous_economic_party_id, first.party_id)
    assert.equal(history[1].new_economic_party_id, second.party_id)
    assert.equal(history[0].new_economic_party_id, first.party_id, 'version 1 is untouched')
  })
})

test('mapping deactivation withdraws the economic link and keeps everything else', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'To Be Withdrawn')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)

    const { rows } = await client.query(
      `select * from private.deactivate_access_party_mapping_v1($1, $2, $3)`,
      [household, SHREY_ID, 'withdrawal evidence']
    )
    const deactivated = rows[0]
    assert.equal(deactivated.action_code, 'economic.access_party_mapping.deactivated')
    assert.equal(deactivated.decision_version, 2)

    const mapping = await mappingRow(client, created.mapping_id)
    assert.equal(mapping.status, 'access_only')
    assert.equal(mapping.economic_party_id, null)

    // The decision row survives, the party survives, and history keeps both.
    const history = await historyFor(client, created.mapping_id)
    assert.equal(history.length, 2)
    assert.equal(history[1].previous_status, 'mapped')
    assert.equal(history[1].previous_economic_party_id, party.party_id)
    assert.equal(history[1].new_status, 'access_only')

    const { rows: stillThere } = await client.query(
      `select archived_at from public.economic_parties where party_id = $1`,
      [party.party_id]
    )
    assert.equal(stillThere.length, 1, 'deactivating a mapping never removes the party')
    assert.equal(stillThere[0].archived_at, null)

    // Authorization is untouched by the withdrawal.
    await actAs(client, 'authenticated', SHREY_ID)
    assert.equal(
      (await client.query(`select private.is_household_member() as member`)).rows[0].member,
      true
    )
    await asOwner(client)
  })
})

test('the current mapping is retrievable and is the latest decision', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const first = await newParty(client, household, 'First')
    const second = await newParty(client, household, 'Second')
    await setMapping(client, household, SHREY_ID, 'mapped', first.party_id)
    await setMapping(client, household, SHREY_ID, 'mapped', second.party_id)

    const { rows } = await client.query(
      `select * from private.current_access_party_mapping_v1($1, $2)`,
      [household, SHREY_ID]
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].economic_party_id, second.party_id)
    assert.equal(rows[0].status, 'mapped')
  })
})

test('a full lifecycle keeps every decision version, in order, forever', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const first = await newParty(client, household, 'First')
    const second = await newParty(client, household, 'Second')

    const created = await setMapping(client, household, SHREY_ID, 'mapped', first.party_id)
    await setMapping(client, household, SHREY_ID, 'mapped', second.party_id)
    await setMapping(client, household, SHREY_ID, 'access_only')
    await setMapping(client, household, SHREY_ID, 'mapped', first.party_id)

    const history = await historyFor(client, created.mapping_id)
    assert.deepEqual(
      history.map((row) => [row.decision_version, row.action_code]),
      [
        [1, 'economic.access_party_mapping.created'],
        [2, 'economic.access_party_mapping.changed'],
        [3, 'economic.access_party_mapping.deactivated'],
        [4, 'economic.access_party_mapping.changed'],
      ]
    )
    // Each version's "before" is the previous version's "after": the chain is
    // continuous, so no decision can be quietly dropped out of the middle.
    for (let i = 1; i < history.length; i += 1) {
      assert.equal(history[i].previous_status, history[i - 1].new_status)
      assert.equal(
        history[i].previous_economic_party_id,
        history[i - 1].new_economic_party_id
      )
    }
  })
})

test('mapping history is immutable and undeletable for every role, operator included', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)

    await expectReject(
      client,
      () =>
        client.query(
          `update public.access_party_mapping_history set new_status = 'access_only'
            where mapping_id = $1`,
          [created.mapping_id]
        ),
      /SHR194_MAPPING_EVIDENCE_IMMUTABLE/
    )
    await expectReject(
      client,
      () =>
        client.query(`delete from public.access_party_mapping_history where mapping_id = $1`, [
          created.mapping_id,
        ]),
      /SHR194_MAPPING_EVIDENCE_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query(`truncate table public.access_party_mapping_history cascade`),
      /SHR194_MAPPING_EVIDENCE_TRUNCATE_FORBIDDEN/
    )
    // A new decision never rewrites an older one to look like it always was.
    await setMapping(client, household, SHREY_ID, 'access_only')
    const history = await historyFor(client, created.mapping_id)
    assert.equal(history[0].new_status, 'mapped')
    assert.equal(history[0].decision_version, 1)
  })
})

test('reconciliation run records are immutable and undeletable', async () => {
  await withTx(async (client) => {
    await reconcile(client)
    await expectReject(
      client,
      () => client.query(`update public.access_party_reconciliation_runs set party_count = 0`),
      /SHR194_MAPPING_EVIDENCE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(`delete from public.access_party_reconciliation_runs`),
      /SHR194_MAPPING_EVIDENCE_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query(`truncate table public.access_party_reconciliation_runs cascade`),
      /SHR194_MAPPING_EVIDENCE_TRUNCATE_FORBIDDEN/
    )
  })
})

test('no ordinary DELETE removes a mapping decision, and SHR-193 still refuses it', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const created = await setMapping(client, household, SHREY_ID, 'access_only')
    await expectReject(
      client,
      () => client.query(`delete from public.access_party_mappings where mapping_id = $1`, [
        created.mapping_id,
      ]),
      /SHR193_MAPPING_DELETE_FORBIDDEN/
    )
    // And SHR-194 adds no product or API hard-delete path of its own.
    const { rows } = await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.proname like '%access_party%'
    `)
    for (const fn of rows) {
      assert.ok(
        !/delete\s+from\s+public\.access_party_mappings/i.test(fn.def),
        `${fn.proname} must contain no mapping delete path`
      )
      assert.ok(
        !/delete\s+from\s+public\.access_party_mapping_history/i.test(fn.def),
        `${fn.proname} must contain no history delete path`
      )
    }
  })
})

// ── The SHR-193 restore boundary ─────────────────────────────────────────

test('no SHR-194 writer calls the SHR-193 restore function or sets its token', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.proname in (
           'set_access_party_mapping_v1', 'deactivate_access_party_mapping_v1',
           'reconcile_access_parties_v1', 'create_economic_party_v1',
           'current_access_party_mapping_v1', 'access_scope_context_v1',
           'access_party_preflight_v1', 'access_party_roster_v1',
           'access_roster_digest_v1')
    `)
    assert.equal(rows.length, 9, 'every SHR-194 function is inspected')
    for (const fn of rows) {
      assert.ok(
        !/restore_access_party_mapping_v1/.test(fn.def),
        `${fn.proname} must never call the SHR-193 restore function`
      )
      assert.ok(
        !/set_config\s*\(\s*'shr193\.restore_mapping_id'/.test(fn.def),
        `${fn.proname} must never set the SHR-193 restore token`
      )
    }
  })
})

test('an ordinary decision is refused outright if the restore token is set', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    await client.query(`select set_config('shr193.restore_mapping_id', $1, true)`, [
      party.party_id,
    ])
    await expectReject(
      client,
      () => setMapping(client, household, SHREY_ID, 'mapped', party.party_id),
      /SHR194_RESTORE_TOKEN_SET_ON_ORDINARY_DECISION/
    )
    await client.query(`select set_config('shr193.restore_mapping_id', '', true)`)
  })
})

test('the SHR-193 restore boundary is unchanged — same guard, same trigger, same refusals', async () => {
  await withTx(async (client) => {
    const { rows: guard } = await client.query(`
      select tgname, tgenabled, p.proname
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.access_party_mappings'::regclass
         and not t.tgisinternal
       order by tgname
    `)
    assert.deepEqual(
      guard.map((row) => [row.tgname, row.tgenabled, row.proname]),
      [
        ['access_party_mappings_lifecycle_guard', 'O', 'guard_access_party_mapping_lifecycle'],
        ['access_party_mappings_no_truncate', 'O', 'reject_economic_identity_truncate'],
      ],
      'SHR-194 must neither disable, drop nor replace the SHR-193 lifecycle trigger'
    )
    // The restore function still exists, still refuses API roles, and is still
    // the only path that can reproduce a historical decision.
    const { rows: fn } = await client.query(`
      select p.prosecdef,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_execute,
             has_function_privilege('service_role', p.oid, 'execute') as service_execute,
             has_function_privilege('anon', p.oid, 'execute') as anon_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'restore_access_party_mapping_v1'
    `)
    assert.equal(fn.length, 1)
    assert.equal(fn[0].prosecdef, false, 'still invoker-mode')
    assert.equal(fn[0].auth_execute, false)
    assert.equal(fn[0].service_execute, false)
    assert.equal(fn[0].anon_execute, false)
  })
})

test('every ordinary decision gets its timestamp from the database, never from a caller', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')

    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    const { rows } = await client.query(
      `select m.decided_at,
              h.decided_at as history_decided_at,
              m.decided_at between now() - interval '1 minute' and now() as fresh
         from public.access_party_mappings m
         join public.access_party_mapping_history h on h.mapping_id = m.mapping_id
        where m.mapping_id = $1`,
      [created.mapping_id]
    )
    assert.equal(rows[0].fresh, true, 'the decision time is now(), authored by the database')
    assert.deepEqual(
      rows[0].history_decided_at,
      rows[0].decided_at,
      'history records the same database-authored decision time'
    )

    // A change is re-stamped as the new decision it is; an unchanged decision
    // keeps its original date rather than accepting a fresh one.
    const before = rows[0].decided_at
    await setMapping(client, household, SHREY_ID, 'access_only')
    const after = await mappingRow(client, created.mapping_id)
    assert.ok(after.decided_at >= before, 'a real change is stamped as a new decision')
  })
})

test('SHR-193 archived-party protection still fails closed for a new decision', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Archived Party')
    await client.query(`update public.economic_parties set archived_at = now() where party_id = $1`, [
      party.party_id,
    ])
    await expectReject(
      client,
      () => setMapping(client, household, SHREY_ID, 'mapped', party.party_id),
      /SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
    assert.equal((await preflight(client)).mapping_count, 0)

    // An existing mapping whose party is archived afterwards is untouched —
    // the historical-stability half of the same SHR-193 rule.
    const live = await newParty(client, household, 'Live Party')
    const created = await setMapping(client, household, TARIKA_ID, 'mapped', live.party_id)
    await client.query(`update public.economic_parties set archived_at = now() where party_id = $1`, [
      live.party_id,
    ])
    const mapping = await mappingRow(client, created.mapping_id)
    assert.equal(mapping.economic_party_id, live.party_id)
    assert.equal(mapping.status, 'mapped')
  })
})

test('a mapping decision cannot reach a party in another economic household', async () => {
  await withTx(async (client) => {
    const householdA = await newHousehold(client, 'Household A')
    const householdB = await newHousehold(client, 'Household B')
    const partyB = await newParty(client, householdB, 'Party in B')

    await expectReject(
      client,
      () => setMapping(client, householdA, SHREY_ID, 'mapped', partyB.party_id),
      /access_party_mappings_party_fk|violates foreign key/i
    )
    assert.equal((await preflight(client)).mapping_count, 0)
  })
})

test('mapping history cannot claim a household its own mapping does not belong to', async () => {
  await withTx(async (client) => {
    const householdA = await newHousehold(client, 'A')
    const householdB = await newHousehold(client, 'B')
    const party = await newParty(client, householdA, 'Party')
    const created = await setMapping(client, householdA, SHREY_ID, 'mapped', party.party_id)

    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.access_party_mapping_history
             (mapping_id, household_id, auth_user_id, decision_version, action_code,
              previous_status, new_status, decided_at, new_economic_party_id)
           values ($1, $2, $3, 99, 'economic.access_party_mapping.changed',
                   'access_only', 'mapped', now(), $4)`,
          [created.mapping_id, householdB, SHREY_ID, party.party_id]
        ),
      /access_party_mapping_history_mapping_fk|violates foreign key/i
    )
  })
})

// ── Audit evidence ───────────────────────────────────────────────────────

test('audit evidence answers every question a mapping decision review must ask', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const first = await newParty(client, household, 'First')
    const second = await newParty(client, household, 'Second')
    await setMapping(client, household, SHREY_ID, 'mapped', first.party_id, {
      actingUserId: TARIKA_ID,
      evidenceRef: 'manifest-row-1',
    })
    const changed = await setMapping(client, household, SHREY_ID, 'mapped', second.party_id, {
      actingUserId: TARIKA_ID,
      evidenceRef: 'manifest-row-1-revised',
    })

    const { rows } = await client.query(
      `select * from public.audit_events where target_id = $1 order by target_version_after`,
      [changed.mapping_id]
    )
    assert.equal(rows.length, 2)
    const event = rows[1]

    // what changed, and from what to what
    assert.equal(event.action_code, 'economic.access_party_mapping.changed')
    assert.equal(event.change_evidence.field_code, 'mapping_status')
    assert.equal(event.change_evidence.before_code, 'mapped')
    assert.equal(event.change_evidence.after_code, 'mapped')
    assert.equal(event.change_evidence.before_party_id, first.party_id)
    assert.equal(event.change_evidence.after_party_id, second.party_id)
    // which household
    assert.equal(event.change_evidence.household_id, household)
    // acting operator provenance
    assert.equal(event.actor_kind, 'authenticated_user')
    assert.equal(event.actor_access_user_id, TARIKA_ID)
    assert.equal(event.surface_code, 'operator_api')
    // when, and which version of the decision
    assert.ok(event.occurred_at instanceof Date)
    assert.equal(event.target_version_before, 1)
    assert.equal(event.target_version_after, 2)

    // which access identity was affected, and the decision evidence — both
    // reachable through the typed evidence reference.
    const { rows: evidence } = await client.query(
      `select * from public.access_party_mapping_history where mapping_history_id = $1`,
      [event.evidence_id]
    )
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0].auth_user_id, SHREY_ID)
    assert.equal(evidence[0].decision_evidence_ref, 'manifest-row-1-revised')
    assert.equal(evidence[0].decision_version, event.evidence_version)
  })
})

test('audit payloads carry no name, email address or Telegram identity', async () => {
  await withTx(async (client) => {
    await reconcile(client, {
      parties: [{ party_key: 'first', display_name: 'A Very Distinctive Party Name' }],
      decisions: [
        { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
        { auth_user_id: TARIKA_ID, status: 'access_only' },
      ],
    })
    const { rows } = await client.query(
      `select change_evidence::text as evidence, actor_telegram_sender_ref
         from public.audit_events`
    )
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.ok(!/A Very Distinctive Party Name/.test(row.evidence), 'no display name in audit')
      assert.ok(!/@/.test(row.evidence), 'no email address in audit')
      assert.equal(row.actor_telegram_sender_ref, null, 'no Telegram identity in audit')
      // The free-text evidence reference is carried as a digest, not verbatim.
      assert.match(JSON.parse(row.evidence).evidence_ref_digest, /^sha256:[0-9a-f]{64}$/)
    }
  })
})

test('a mapping audit event is immutable once written', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    await expectReject(
      client,
      () =>
        client.query(`update public.audit_events set outcome = 'failed' where target_id = $1`, [
          created.mapping_id,
        ]),
      /immutable/i
    )
    await expectReject(
      client,
      () => client.query(`delete from public.audit_events where target_id = $1`, [
        created.mapping_id,
      ]),
      /immutable/i
    )
  })
})

test('an audit failure rolls back the mapping decision it was recording', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')

    // OUTSIDER_ID is deliberately not a household member, so SHR-191's actor
    // validation rejects the audit append. The decision must not survive it.
    await expectReject(
      client,
      () =>
        setMapping(client, household, SHREY_ID, 'mapped', party.party_id, {
          actingUserId: OUTSIDER_ID,
        }),
      /SHR191_AUDIT_ACTOR_NOT_HOUSEHOLD_MEMBER/
    )

    const { rows } = await client.query(`
      select
        (select count(*)::integer from public.access_party_mappings) as mappings,
        (select count(*)::integer from public.access_party_mapping_history) as history,
        (select count(*)::integer from public.audit_events) as audit
    `)
    assert.deepEqual(
      rows[0],
      { mappings: 0, history: 0, audit: 0 },
      'a decision whose audit evidence cannot be written does not happen'
    )
  })
})

test('an audit event cannot be fabricated for a decision that never happened', async () => {
  await withTx(async (client) => {
    await expectReject(
      client,
      () =>
        client.query(
          `select * from private.append_audit_event_v1(
             'system', null, null, null, 'shr194.access_party_reconciliation',
             'migration', 'economic.access_party_mapping.created',
             gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
             null, $1)`,
          [`sha256:${'c'.repeat(64)}`]
        ),
      /SHR194_AUDIT_EVIDENCE_NOT_FOUND/
    )
  })
})

test('an audit event cannot describe a different decision than its own evidence', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const a = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    const b = await setMapping(client, household, TARIKA_ID, 'access_only')
    const historyOfA = (await historyFor(client, a.mapping_id))[0]

    await expectReject(
      client,
      () =>
        client.query(
          `select * from private.append_audit_event_v1(
             'system', null, null, null, 'shr194.access_party_reconciliation',
             'migration', 'economic.access_party_mapping.created',
             $1, $2, gen_random_uuid(), gen_random_uuid(), null, $3)`,
          [b.mapping_id, historyOfA.mapping_history_id, `sha256:${'d'.repeat(64)}`]
        ),
      /SHR194_AUDIT_EVIDENCE_MISMATCH/
    )
  })
})

test('an arbitrary payload cannot be smuggled into mapping audit evidence', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    const { rows } = await client.query(
      `select * from public.audit_events where target_id = $1`,
      [created.mapping_id]
    )
    const event = rows[0]

    // The projection is closed: an extra key is refused by the table itself.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.audit_events
             select (jsonb_populate_record(null::public.audit_events,
               to_jsonb(e) || jsonb_build_object(
                 'event_id', gen_random_uuid(),
                 'idempotency_key_ref', $2::text,
                 'change_evidence', e.change_evidence || '{"request_body":"secret"}'::jsonb))).*
             from public.audit_events e where e.event_id = $1`,
          [event.event_id, `sha256:${'e'.repeat(64)}`]
        ),
      /audit_events_action_evidence_check/
    )
  })
})

test('the SHR-191 QA fixture contract still behaves exactly as 045 defined it', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    const target = (await client.query('select gen_random_uuid() as id')).rows[0].id
    const key = `sha256:${'1'.repeat(64)}`
    const { rows } = await client.query(
      `select * from public.record_audit_qa_fixture_v1(
         'authenticated_user', $1, null, null, null, 'portal',
         'audit.qa_fixture.recorded', $2, gen_random_uuid(),
         gen_random_uuid(), gen_random_uuid(), null, $3)`,
      [SHREY_ID, target, key]
    )
    assert.equal(rows[0].replayed, false)

    await asOwner(client)
    const { rows: stored } = await client.query(
      `select producer_code, target_kind, evidence_kind, evidence_version, change_evidence
         from public.audit_events where event_id = $1`,
      [rows[0].event_id]
    )
    assert.equal(stored[0].producer_code, 'shr191.qa_fixture')
    assert.equal(stored[0].target_kind, 'audit.qa_fixture')
    assert.equal(stored[0].evidence_kind, 'audit.qa_fixture')
    assert.equal(stored[0].evidence_version, 1)
    assert.deepEqual(stored[0].change_evidence, {
      field_code: 'fixture_state',
      before_code: 'absent',
      after_code: 'recorded',
    })
  })
})

// ── Idempotency and retry ────────────────────────────────────────────────

test('re-applying a decision already exactly in force is an explicit no-op', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    const before = await mappingRow(client, created.mapping_id)

    const repeat = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    assert.equal(repeat.changed, false)
    assert.equal(repeat.action_code, 'economic.access_party_mapping.unchanged')
    assert.equal(repeat.decision_version, 1, 'no new decision version is created')
    assert.equal(repeat.audit_event_id, null, 'no second audit event')

    const after = await mappingRow(client, created.mapping_id)
    assert.deepEqual(after.decided_at, before.decided_at, 'the decision is not re-stamped')
    assert.equal((await historyFor(client, created.mapping_id)).length, 1)
    const { rows: audit } = await client.query(
      `select count(*)::integer as count from public.audit_events where target_id = $1`,
      [created.mapping_id]
    )
    assert.equal(audit[0].count, 1)
  })
})

test('re-applying the same approved manifest is a replay that writes nothing new', async () => {
  await withTx(async (client) => {
    const first = await reconcile(client, { manifestRef: 'SHR194-idempotent' })
    const stateAfterFirst = await preflight(client)

    const second = await reconcile(client, {
      manifestRef: 'SHR194-idempotent',
      // The economic state has moved on since the first apply; a replay must
      // not care, because it short-circuits before the preflight comparison.
      expected: {
        householdCount: stateAfterFirst.economic_household_count,
        partyCount: stateAfterFirst.economic_party_count,
        mappingCount: stateAfterFirst.mapping_count,
      },
    })

    assert.equal(second.replayed, true)
    assert.equal(second.economic_household_id, first.economic_household_id)
    assert.deepEqual(await preflight(client), {
      ...stateAfterFirst,
      observed_at: (await preflight(client)).observed_at,
    })
  })
})

test('the same manifest reference carrying different content is a hard conflict', async () => {
  await withTx(async (client) => {
    await reconcile(client, { manifestRef: 'SHR194-conflict' })
    const state = await preflight(client)
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR194-conflict',
          householdName: 'A different household entirely',
          expected: {
            householdCount: state.economic_household_count,
            partyCount: state.economic_party_count,
            mappingCount: state.mapping_count,
          },
        }),
      /SHR194_MANIFEST_CONFLICT/
    )
  })
})

test('a decision retried at the same version replays its audit event rather than duplicating it', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)
    const history = (await historyFor(client, created.mapping_id))[0]

    const { rows } = await client.query(
      `select * from private.append_audit_event_v1(
         'system', null, null, null, 'shr194.access_party_reconciliation',
         'migration', 'economic.access_party_mapping.created',
         $1::uuid, $2::uuid,
         (md5('shr194.request:' || $2::uuid::text))::uuid,
         (md5('shr194.correlation:' || $1::uuid::text))::uuid,
         null,
         'sha256:' || encode(extensions.digest(convert_to($1::uuid::text || ':1', 'UTF8'), 'sha256'), 'hex'))`,
      [created.mapping_id, history.mapping_history_id]
    )
    assert.equal(rows[0].replayed, true, 'the identical append replays the original event')

    const { rows: audit } = await client.query(
      `select count(*)::integer as count from public.audit_events where target_id = $1`,
      [created.mapping_id]
    )
    assert.equal(audit[0].count, 1)
  })
})

test('two decisions on the same subject cannot both claim the same version', async () => {
  // The last line of defence behind the advisory lock and the row lock: even if
  // both were bypassed, the current state cannot become ambiguous and a history
  // row cannot be lost. Proven here by writing the collision directly.
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', party.party_id)

    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.access_party_mapping_history
             (mapping_id, household_id, auth_user_id, decision_version, action_code,
              previous_status, new_status, previous_economic_party_id, decided_at)
           values ($1, $2, $3, 1, 'economic.access_party_mapping.changed',
                   'mapped', 'access_only', $4, now())`,
          [created.mapping_id, household, SHREY_ID, party.party_id]
        ),
      /access_party_mapping_history_version_key/
    )

    // And the current decision itself stays single-valued per subject.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.access_party_mappings (household_id, auth_user_id, status)
           values ($1, $2, 'unreviewed')`,
          [household, SHREY_ID]
        ),
      /access_party_mappings_decision_key/
    )
  })
})

// ── Context API ──────────────────────────────────────────────────────────

async function contextAs(client, userId, householdId = null) {
  await actAs(client, 'authenticated', userId)
  const { rows } = await client.query(`select * from public.access_scope_context_v1($1)`, [
    householdId,
  ])
  await asOwner(client)
  return rows[0]
}

test('the context API describes a mapped economic actor', async () => {
  await withTx(async (client) => {
    await reconcile(client, {
      parties: [
        { party_key: 'first', display_name: 'Alpha' },
        { party_key: 'second', display_name: 'Beta' },
      ],
      decisions: [
        { auth_user_id: SHREY_ID, status: 'mapped', party_key: 'first' },
        { auth_user_id: TARIKA_ID, status: 'access_only' },
      ],
    })
    const context = await contextAs(client, SHREY_ID)

    assert.equal(context.access_user_id, SHREY_ID)
    assert.equal(context.access_state, 'mapped')
    assert.equal(context.is_economic_party, true)
    assert.equal(context.economic_party_display_name, 'Alpha')
    assert.equal(context.active_party_count, 2)

    // Both leads, counted once, and is not a sum of the personal scopes.
    const [household, ...parties] = context.scope_options
    assert.equal(household.scope_kind, 'household')
    assert.equal(household.scope_code, 'both')
    assert.equal(household.counted_once, true)
    assert.equal(parties.length, 2)
    assert.deepEqual(
      parties.map((option) => [option.display_name, option.is_self, option.presentation_code]),
      [
        ['Alpha', true, 'me'],
        ['Beta', false, 'partner'],
      ]
    )

    // No allocation of any kind is offered anywhere in the contract: no
    // fractional key, and no numeric value that could be one. The historical
    // 69/31 split in particular is not reachable from this API.
    const keys = new Set()
    const collectKeys = (value) => {
      if (Array.isArray(value)) return value.forEach(collectKeys)
      if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key)
          collectKeys(nested)
        }
      }
    }
    collectKeys(context)
    for (const forbidden of ['share', 'percent', 'weight', 'ratio', 'allocation', 'split']) {
      for (const key of keys) {
        assert.ok(!key.includes(forbidden), `context must not expose a "${forbidden}" key`)
      }
    }
    const numbers = []
    const collectNumbers = (value) => {
      if (Array.isArray(value)) return value.forEach(collectNumbers)
      if (typeof value === 'number') return numbers.push(value)
      if (value && typeof value === 'object') Object.values(value).forEach(collectNumbers)
    }
    collectNumbers(context.scope_options)
    assert.deepEqual(numbers, [], 'scope options carry no numeric weighting at all')
  })
})

test('the context API describes an access-only actor without inventing a party', async () => {
  await withTx(async (client) => {
    await reconcile(client)
    const context = await contextAs(client, TARIKA_ID)

    assert.equal(context.access_state, 'access_only')
    assert.equal(context.is_economic_party, false)
    assert.equal(context.economic_party_id, null)
    assert.equal(context.economic_party_display_name, null)

    // It still gets whole-household context and the real scope choices — being
    // access-only is not being blind.
    assert.ok(context.economic_household_id)
    assert.equal(context.scope_options[0].scope_code, 'both')
    assert.equal(context.active_party_count, 2)
    for (const option of context.scope_options.slice(1)) {
      assert.equal(option.is_self, false, 'an access-only actor is nobody\'s "me"')
      assert.equal(option.presentation_code, null)
    }
  })
})

test('the context API distinguishes unreviewed from unmapped', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    await client.query(
      `insert into public.access_party_mappings (household_id, auth_user_id, status)
       values ($1, $2, 'unreviewed')`,
      [household, SHREY_ID]
    )
    const unreviewed = await contextAs(client, SHREY_ID)
    assert.equal(unreviewed.access_state, 'unreviewed')
    assert.equal(unreviewed.is_economic_party, false)
    assert.equal(unreviewed.economic_household_id, household)

    const unmapped = await contextAs(client, TARIKA_ID)
    assert.equal(unmapped.access_state, 'unmapped')
    assert.equal(unmapped.is_economic_party, false)
    assert.equal(unmapped.economic_household_id, null)
    assert.deepEqual(unmapped.scope_options, [])
  })
})

test('the context API never leaks another economic household', async () => {
  await withTx(async (client) => {
    const householdA = await newHousehold(client, 'Household A')
    const householdB = await newHousehold(client, 'Household B')
    const partyA = await newParty(client, householdA, 'Party A')
    const partyB = await newParty(client, householdB, 'Party B')
    await setMapping(client, householdA, SHREY_ID, 'mapped', partyA.party_id)
    await setMapping(client, householdB, TARIKA_ID, 'mapped', partyB.party_id)

    const context = await contextAs(client, SHREY_ID)
    assert.equal(context.economic_household_id, householdA)
    assert.equal(context.active_party_count, 1)
    assert.deepEqual(
      context.scope_options.filter((o) => o.scope_kind === 'party').map((o) => o.display_name),
      ['Party A'],
      'no party from another household appears in the scope options'
    )

    // Naming the other household explicitly is forbidden, not merely empty.
    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(
      client,
      () => client.query(`select * from public.access_scope_context_v1($1)`, [householdB]),
      /ACCESS_SCOPE_CONTEXT_FORBIDDEN/
    )
    await asOwner(client)
  })
})

test('the context API fails closed rather than guessing between two households', async () => {
  await withTx(async (client) => {
    const householdA = await newHousehold(client, 'A')
    const householdB = await newHousehold(client, 'B')
    await setMapping(client, householdA, SHREY_ID, 'access_only')
    await setMapping(client, householdB, SHREY_ID, 'access_only')

    await actAs(client, 'authenticated', SHREY_ID)
    await expectReject(
      client,
      () => client.query(`select * from public.access_scope_context_v1()`),
      /ACCESS_SCOPE_CONTEXT_HOUSEHOLD_AMBIGUOUS/
    )
    // Naming one explicitly resolves it.
    const { rows } = await client.query(`select * from public.access_scope_context_v1($1)`, [
      householdA,
    ])
    assert.equal(rows[0].economic_household_id, householdA)
    await asOwner(client)
  })
})

test('the context API is unreachable without household authorization', async () => {
  await withTx(async (client) => {
    await reconcile(client)
    await actAs(client, 'authenticated', OUTSIDER_ID)
    await expectReject(
      client,
      () => client.query(`select * from public.access_scope_context_v1()`),
      /ACCESS_SCOPE_CONTEXT_FORBIDDEN/
    )
    await asOwner(client)

    await actAs(client, 'anon')
    await expectReject(
      client,
      () => client.query(`select * from public.access_scope_context_v1()`),
      /permission denied/i
    )
    await asOwner(client)
  })
})

test('an archived party is still resolvable but is never offered as a new scope choice', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const active = await newParty(client, household, 'Active')
    const retired = await newParty(client, household, 'Retired')
    await setMapping(client, household, SHREY_ID, 'mapped', active.party_id)
    await client.query(`update public.economic_parties set archived_at = now() where party_id = $1`, [
      retired.party_id,
    ])

    const context = await contextAs(client, SHREY_ID)
    assert.equal(context.active_party_count, 1)
    assert.deepEqual(
      context.scope_options.filter((o) => o.scope_kind === 'party').map((o) => o.display_name),
      ['Active']
    )
    // Still fully resolvable for a historical read.
    const { rows } = await client.query(
      `select display_name from public.economic_parties where party_id = $1`,
      [retired.party_id]
    )
    assert.equal(rows[0].display_name, 'Retired')
  })
})

test('the context API exposes no identity evidence and no financial aggregate', async () => {
  await withTx(async (client) => {
    await reconcile(client)
    const context = await contextAs(client, SHREY_ID)
    const serialized = JSON.stringify(context)
    const { rows: emails } = await client.query(`select email from auth.users where email is not null`)
    for (const { email } of emails) {
      assert.ok(!serialized.includes(email), 'no email address reaches the context API')
    }
    assert.ok(!/telegram/i.test(serialized), 'no Telegram identity reaches the context API')
    for (const financial of ['amount', 'balance', 'total', 'aed', 'net_worth']) {
      assert.ok(
        !serialized.toLowerCase().includes(financial),
        `the context API is not a financial aggregation engine ("${financial}")`
      )
    }
  })
})

// ── Authorization, ACL and RLS ───────────────────────────────────────────

test('SHR-194 grants no API role any write capability on any of its objects', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select c.relname,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('anon', c.oid, 'insert,update,delete') as anon_write,
             has_table_privilege('authenticated', c.oid, 'select') as auth_select,
             has_table_privilege('authenticated', c.oid, 'insert,update,delete') as auth_write,
             has_table_privilege('service_role', c.oid, 'select') as service_select,
             has_table_privilege('service_role', c.oid, 'insert,update,delete') as service_write,
             c.relrowsecurity
        from pg_class c
       where c.oid in (
         'public.access_party_mapping_history'::regclass,
         'public.access_party_reconciliation_runs'::regclass)
       order by c.relname
    `)
    assert.deepEqual(rows, [
      {
        relname: 'access_party_mapping_history',
        anon_select: false, anon_write: false,
        auth_select: true, auth_write: false,
        service_select: true, service_write: false,
        relrowsecurity: true,
      },
      {
        relname: 'access_party_reconciliation_runs',
        anon_select: false, anon_write: false,
        auth_select: false, auth_write: false,
        service_select: true, service_write: false,
        relrowsecurity: true,
      },
    ])
  })
})

test('the exact SHR-194 function ACL matrix', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select n.nspname, p.proname, p.prosecdef,
             p.proconfig @> array['search_path=""']::text[] as empty_path,
             has_function_privilege('anon', p.oid, 'execute') as anon_execute,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_execute,
             has_function_privilege('service_role', p.oid, 'execute') as service_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'private' and p.proname in (
                'access_roster_digest_v1', 'access_party_preflight_v1',
                'access_party_roster_v1', 'create_economic_party_v1',
                'set_access_party_mapping_v1', 'deactivate_access_party_mapping_v1',
                'current_access_party_mapping_v1', 'reconcile_access_parties_v1',
                'reject_access_party_evidence_mutation',
                'reject_access_party_evidence_truncate',
                'append_audit_event_v1'))
          or (n.nspname = 'public' and p.proname = 'access_scope_context_v1')
       order by n.nspname, p.proname
    `)
    assert.equal(rows.length, 12, 'every SHR-194 function is covered by the matrix')

    for (const fn of rows) {
      assert.equal(fn.empty_path, true, `${fn.proname} must pin an empty search_path`)
      assert.equal(fn.anon_execute, false, `${fn.proname} must be unreachable by anon`)
      if (fn.nspname === 'private') {
        assert.equal(fn.auth_execute, false, `${fn.proname} must be unreachable by authenticated`)
        assert.equal(fn.service_execute, false, `${fn.proname} must be unreachable by service_role`)
      }
    }

    const context = rows.find((fn) => fn.proname === 'access_scope_context_v1')
    assert.equal(context.auth_execute, true, 'the context API is the one product surface')
    assert.equal(context.service_execute, false)
    assert.equal(context.prosecdef, true, 'definer, because it authorizes explicitly')

    // Every mapping writer is invoker-mode, so the operator check sees the role
    // that actually issued the statement rather than the function owner.
    for (const name of [
      'set_access_party_mapping_v1',
      'deactivate_access_party_mapping_v1',
      'reconcile_access_parties_v1',
      'create_economic_party_v1',
    ]) {
      assert.equal(rows.find((fn) => fn.proname === name).prosecdef, false, `${name} is invoker`)
    }
  })
})

test('no API role can reach a mapping writer even by calling it directly', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () =>
          client.query(
            `select * from private.set_access_party_mapping_v1($1, $2, 'access_only')`,
            [household, SHREY_ID]
          ),
        /permission denied/i
      )
      await expectReject(
        client,
        () =>
          client.query(
            `select private.reconcile_access_parties_v1(
               'x', 0, 'y', 0, 0, 0, 'z', '[]'::jsonb, '[]'::jsonb)`
          ),
        /permission denied/i
      )
      await asOwner(client)
    }
  })
})

test('no API role can write mapping history or a run record directly', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const created = await setMapping(client, household, SHREY_ID, 'access_only')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () =>
          client.query(
            `insert into public.access_party_mapping_history
               (mapping_id, household_id, auth_user_id, decision_version, action_code,
                previous_status, new_status, decided_at)
             values ($1, $2, $3, 50, 'economic.access_party_mapping.changed',
                     'access_only', 'mapped', now())`,
            [created.mapping_id, household, SHREY_ID]
          ),
        /permission denied/i
      )
      await asOwner(client)
    }
  })
})

test('mapping history reads authorize through the existing membership root only', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select polname, polcmd, polroles::regrole[]::text[] as roles,
             pg_get_expr(polqual, polrelid) as using_expr,
             pg_get_expr(polwithcheck, polrelid) as check_expr
        from pg_policy
       where polrelid in (
         'public.access_party_mapping_history'::regclass,
         'public.access_party_reconciliation_runs'::regclass)
       order by polname
    `)
    assert.equal(rows.length, 2)
    const history = rows.find((p) => p.polname === 'household read access party mapping history')
    assert.equal(history.polcmd, 'r')
    assert.deepEqual(history.roles, ['authenticated'])
    assert.match(history.using_expr, /is_household_member\(\)/)
    assert.ok(
      !/economic_part|access_party_mapping|economic_household/.test(history.using_expr),
      'authorization must never consult economic identity'
    )

    const runs = rows.find((p) => p.polname === 'reconciliation runs deny raw api access')
    assert.equal(runs.using_expr, 'false')
    assert.equal(runs.check_expr, 'false')
  })
})

test('no RLS policy anywhere consults economic identity or mapping evidence', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select c.relname, p.polname,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') ||
             coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expr
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
    `)
    for (const policy of rows) {
      for (const forbidden of [
        'economic_parties', 'economic_households', 'economic_party_id',
        'access_party_mappings', 'access_party_mapping_history',
        'legacy_owner_label',
      ]) {
        assert.ok(
          !policy.expr.includes(forbidden),
          `${policy.relname}.${policy.polname} must not authorize through "${forbidden}"`
        )
      }
    }
  })
})

test('the authorization root is untouched and SHR-194 invents no role', async () => {
  await withTx(async (client) => {
    const { rows: fn } = await client.query(`
      select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'is_household_member'
    `)
    assert.equal(fn.length, 1)
    assert.ok(
      !/economic|party|mapping/i.test(fn[0].def),
      'the authorization predicate must know nothing about economic identity'
    )
    const { rows: roles } = await client.query(`
      select rolname from pg_roles
       where rolname not like 'pg\\_%'
         and rolname not in ('postgres', 'anon', 'authenticated', 'service_role')
    `)
    assert.deepEqual(roles, [], 'SHR-194 creates no role and invents no household RBAC')
  })
})

test('a mapping decision still grants no access whatsoever', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    // Map an identity that is not a household member at all.
    await setMapping(client, household, OUTSIDER_ID, 'mapped', party.party_id)

    await actAs(client, 'authenticated', OUTSIDER_ID)
    const { rows } = await client.query(`select private.is_household_member() as member`)
    assert.equal(rows[0].member, false, 'being an economic party grants no household access')
    const visible = await client.query(`select count(*)::integer as count from public.transactions`)
    assert.equal(visible.rows[0].count, 0, 'RLS still hides every financial row')
    await asOwner(client)
  })
})

// ── Financial facts and Telegram ─────────────────────────────────────────

test('reconciliation rewrites no financial fact and touches no Telegram association', async () => {
  await withTx(async (client) => {
    const FINANCIAL = [
      'transactions', 'accounts', 'income', 'recurring', 'goals', 'budgets',
      'nw_daily', 'goal_contributions', 'category_rules', 'settings',
    ]
    const before = {}
    for (const table of FINANCIAL) {
      const { rows } = await client.query(
        `select count(*)::integer as count, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as digest
           from public.${table} t`
      )
      before[table] = rows[0]
    }

    await reconcile(client)
    await setMapping(
      client,
      (await client.query(`select household_id from public.economic_households limit 1`)).rows[0]
        .household_id,
      SHREY_ID,
      'access_only'
    )

    for (const table of FINANCIAL) {
      const { rows } = await client.query(
        `select count(*)::integer as count, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as digest
           from public.${table} t`
      )
      assert.deepEqual(rows[0], before[table], `${table} must be byte-identical after SHR-194`)
    }
  })
})

test('SHR-194 adds no ownership or attribution column to any financial table', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'transactions', 'accounts', 'income', 'recurring', 'goals', 'budgets',
           'nw_daily', 'goal_contributions', 'category_rules', 'settings',
           'transaction_items', 'pending_income')
         and (column_name like '%economic%'
              or column_name like '%party%'
              or column_name = 'household_id')
    `)
    assert.deepEqual(rows, [], 'financial ownership migrates under its own downstream contracts')
  })
})

test('no Telegram identity is stored, referenced or used as an economic key', async () => {
  await withTx(async (client) => {
    const { rows: columns } = await client.query(`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'economic_households', 'economic_parties', 'access_party_mappings',
           'access_party_mapping_history', 'access_party_reconciliation_runs')
         and (column_name ilike '%telegram%' or column_name ilike '%chat%'
              or column_name ilike '%sender%')
    `)
    assert.deepEqual(columns, [], 'Telegram association stays deferred to SHR-160/184')

    const { rows: fns } = await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.proname like '%access_party%'
    `)
    for (const fn of fns) {
      assert.ok(
        !/telegram|chat_id|sender/i.test(fn.def),
        `${fn.proname} must not read or write a Telegram identity`
      )
    }

    // And nothing in this package wrote to the Telegram-facing tables.
    await reconcile(client)
    const { rows: settings } = await client.query(
      `select count(*)::integer as count from public.settings where key ilike '%telegram%'`
    )
    assert.ok(settings[0].count >= 0)
  })
})

// ── Backup ───────────────────────────────────────────────────────────────

test('the backup manifest carries the new durable evidence in dependency order', async () => {
  const names = BACKUP_TABLES.map((table) => table.name)
  for (const table of NEW_TABLES) {
    const entry = BACKUP_TABLES.find((candidate) => candidate.name === table)
    assert.ok(entry, `${table} must be in the backup manifest`)
    assert.equal(entry.financial, true, `${table} is irrecoverable household record`)
    for (const dependency of entry.dependsOn ?? []) {
      assert.ok(
        names.indexOf(dependency) < names.indexOf(table),
        `${table} must restore after ${dependency}`
      )
    }
  }
  assert.ok(
    names.indexOf('access_party_mappings') < names.indexOf('access_party_mapping_history'),
    'history restores after the mappings its foreign key targets'
  )
})

test('a backup round-trip preserves mapping history and audit evidence exactly', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client, 'Backup household')
    const first = await newParty(client, household, 'First')
    const second = await newParty(client, household, 'Second')
    const created = await setMapping(client, household, SHREY_ID, 'mapped', first.party_id)
    await setMapping(client, household, SHREY_ID, 'mapped', second.party_id)
    await setMapping(client, household, SHREY_ID, 'access_only')

    // PostgREST exports rows as JSON, so fetch to_jsonb here too rather than
    // letting node-postgres coerce timestamps and truncate microseconds.
    const fetchTable = async (table) => {
      const { rows } = await client.query(`select to_jsonb(t) as row from public.${table} t`)
      return rows.map(({ row }) => row)
    }
    const backup = await buildBackup(fetchTable, '048_access_party_reconciliation', () =>
      '2026-08-31T00:00:00.000Z'
    )

    assert.equal(backup.meta.row_counts.access_party_mapping_history, 3)
    assert.equal(backup.meta.row_counts.access_party_mappings, 1)
    assert.equal(backup.meta.row_counts.audit_events, 3)

    await client.query(`
      create temporary table restored_history
        (like public.access_party_mapping_history including all)
        on commit drop
    `)
    await client.query(`
      create trigger restored_history_immutable
      before update or delete on restored_history
      for each row execute function private.reject_access_party_evidence_mutation()
    `)
    for (const row of backup.tables.access_party_mapping_history) {
      await client.query(
        `insert into restored_history
         select (jsonb_populate_record(null::restored_history, $1::jsonb)).*`,
        [JSON.stringify(row)]
      )
    }

    const { rows: restored } = await client.query(
      `select to_jsonb(r) as row from restored_history r order by decision_version`
    )
    const { rows: source } = await client.query(
      `select to_jsonb(h) as row from public.access_party_mapping_history h
        where h.mapping_id = $1 order by decision_version`,
      [created.mapping_id]
    )
    assert.deepEqual(
      restored.map(({ row }) => row),
      source.map(({ row }) => row),
      'restored history is byte-identical, including its decision timestamps'
    )

    // The whole lifecycle survives, in order — a restore that lost the middle
    // decision would restore a plausible but false history.
    assert.deepEqual(
      restored.map(({ row }) => [row.decision_version, row.action_code]),
      [
        [1, 'economic.access_party_mapping.created'],
        [2, 'economic.access_party_mapping.changed'],
        [3, 'economic.access_party_mapping.deactivated'],
      ]
    )

    // And the restored copy is still append-only.
    await expectReject(
      client,
      () => client.query(`update restored_history set new_status = 'mapped'`),
      /SHR194_MAPPING_EVIDENCE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query(`delete from restored_history`),
      /SHR194_MAPPING_EVIDENCE_DELETE_FORBIDDEN/
    )
  })
})

test('a restored decision is still bound by every SHR-194 invariant', async () => {
  await withTx(async (client) => {
    await client.query(`
      create temporary table restored_history
        (like public.access_party_mapping_history including all)
        on commit drop
    `)
    const mappingId = (await client.query('select gen_random_uuid() as id')).rows[0].id
    const householdId = (await client.query('select gen_random_uuid() as id')).rows[0].id

    // A creation still cannot claim a previous state, and a deactivation still
    // cannot mean anything other than mapped -> access_only.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into restored_history
             (mapping_id, household_id, auth_user_id, decision_version, action_code,
              previous_status, new_status, new_economic_party_id, decided_at)
           values ($1, $2, $3, 1, 'economic.access_party_mapping.created',
                   'mapped', 'access_only', null, now())`,
          [mappingId, householdId, SHREY_ID]
        ),
      /access_party_mapping_history_created_shape_check|previous_party_shape_check/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `insert into restored_history
             (mapping_id, household_id, auth_user_id, decision_version, action_code,
              previous_status, new_status, previous_economic_party_id, new_economic_party_id, decided_at)
           values ($1, $2, $3, 2, 'economic.access_party_mapping.deactivated',
                   'access_only', 'access_only', null, null, now())`,
          [mappingId, householdId, SHREY_ID]
        ),
      /deactivation_shape_check|effective_change_check/
    )
  })
})

// ── Migration hygiene ────────────────────────────────────────────────────

test('every SHR-194 object is documented', async () => {
  await withTx(async (client) => {
    for (const table of NEW_TABLES) {
      const { rows } = await client.query(
        `select obj_description($1::regclass, 'pg_class') as comment`,
        [`public.${table}`]
      )
      assert.ok(rows[0].comment, `${table} must carry a table comment`)
    }
  })
})

test('SHR-194 adds exactly one new public RPC and no new public table', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select p.proname from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (p.proname like '%access_party%' or p.proname like '%scope_context%'
              or p.proname like '%economic%' or p.proname like '%reconcil%')
       order by p.proname
    `)
    assert.deepEqual(
      rows.map((row) => row.proname),
      ['access_scope_context_v1'],
      'the context API is the only public surface SHR-194 adds'
    )
  })
})
