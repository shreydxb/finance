// SHR-193 — economic household, party and access-mapping schema foundation.
//
// The single claim this file exists to prove is the one the whole package is
// built around:
//
//     AUTHORIZATION ACTOR  !=  ECONOMIC PARTY
//
// Everything else — N-party capability, mapping cardinality, archive lifecycle,
// the frozen legacy label — is in service of that separation staying true under
// pressure. So alongside the ordinary constraint vectors there are tests here
// that deliberately try to turn economic identity into an access grant, and
// fail.
//
// No API role may write any of these tables, so fixtures are created by the
// migration/operator authority (the session's own role), exactly as SHR-194's
// reviewed path will.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, TARIKA_ID, withTx } from './helpers.mjs'

const ECONOMIC_TABLES = ['economic_households', 'economic_parties', 'access_party_mappings']

/** Back to the migration/operator authority after a role-scoped assertion. */
async function asOwner(client) {
  await client.query('reset role')
}

async function newHousehold(client, name = 'SHR-193 fixture household') {
  const { rows } = await client.query(
    `insert into public.economic_households (display_name) values ($1) returning household_id`,
    [name]
  )
  return rows[0].household_id
}

async function newParty(client, householdId, displayName, extra = {}) {
  const { rows } = await client.query(
    `insert into public.economic_parties (household_id, display_name, legacy_owner_label, archived_at)
     values ($1, $2, $3, $4) returning *`,
    [householdId, displayName, extra.legacyOwnerLabel ?? null, extra.archivedAt ?? null]
  )
  return rows[0]
}

async function newMapping(client, householdId, authUserId, opts = {}) {
  const { rows } = await client.query(
    `insert into public.access_party_mappings
       (household_id, auth_user_id, economic_party_id, status, decided_at)
     values ($1, $2, $3, coalesce($4, 'unreviewed'), $5) returning *`,
    [householdId, authUserId, opts.partyId ?? null, opts.status ?? null, opts.decidedAt ?? null]
  )
  return rows[0]
}

/**
 * The sanctioned restore path. Ordinary DML cannot reproduce a historical
 * decision, so every restore assertion below goes through this function — which
 * is exactly the point of the boundary.
 */
async function restoreMapping(client, row) {
  const { rows } = await client.query(
    `select * from private.restore_access_party_mapping_v1($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.mappingId, row.householdId, row.authUserId, row.partyId ?? null,
      row.status, row.decidedAt ?? null, row.decidedBy ?? null,
      row.evidenceRef ?? null, row.createdAt ?? null, row.updatedAt ?? null,
    ]
  )
  return rows[0]
}

// ── Foundation: the package ships empty ──────────────────────────────────

test('the substrate exists and is completely empty — no party or mapping is ever seeded', async () => {
  await withTx(async (client) => {
    for (const table of ECONOMIC_TABLES) {
      const { rows } = await client.query(
        `select count(*)::integer as count from public.${table}`
      )
      assert.equal(rows[0].count, 0, `${table} must contain no rows after 047`)
    }
  })
})

test('no economic party is inferred from an authentication identity or a display name', async () => {
  // The migration must not have looked at household_members, auth.users or any
  // owner text and decided somebody is an economic party.
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        (select count(*)::integer from public.household_members) as members,
        (select count(*)::integer from public.economic_parties) as parties,
        (select count(*)::integer from public.access_party_mappings) as mappings
    `)
    assert.ok(rows[0].members > 0, 'the fixture household has access members')
    assert.equal(rows[0].parties, 0, 'access identities must not become economic parties')
    assert.equal(rows[0].mappings, 0, 'no mapping decision may be made implicitly')
  })
})

// ── N-party model ────────────────────────────────────────────────────────

test('0, 1, 2 and 3+ active parties are all valid — nothing assumes a couple', async () => {
  await withTx(async (client) => {
    for (const size of [0, 1, 2, 3, 5]) {
      const household = await newHousehold(client, `SHR-193 household of ${size}`)
      for (let i = 0; i < size; i += 1) {
        await newParty(client, household, `Party ${i + 1}`)
      }
      const { rows } = await client.query(
        `select count(*)::integer as count from public.economic_parties
         where household_id = $1 and archived_at is null`,
        [household]
      )
      assert.equal(rows[0].count, size, `a household with ${size} active parties must be valid`)
    }
  })
})

test('no constraint, index or check encodes a two-party assumption', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid in (
        'public.economic_households'::regclass,
        'public.economic_parties'::regclass,
        'public.access_party_mappings'::regclass
      )
    `)
    assert.ok(rows.length > 0)
    for (const { conname, def } of rows) {
      // Person-shaped role words only — "PRIMARY KEY" is SQL, not a party role.
      assert.doesNotMatch(
        def,
        /\b(partner|spouse|husband|wife|shrey|tarika)\b/i,
        `${conname} must not encode a couple: ${def}`
      )
      assert.doesNotMatch(
        conname,
        /primary|secondary|partner|spouse/i,
        `${conname} must not name a fixed party role`
      )
      // A cardinality cap would be the other way to smuggle "exactly two" in.
      assert.doesNotMatch(def, /count\s*\(/i, `${conname} must not cap the number of parties`)
    }
  })
})

// ── Stable identity and display-name lifecycle ───────────────────────────

test('renaming a party does not change its identity, its label or any mapping', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Original Name', {
      legacyOwnerLabel: 'Shrey',
    })
    const mapping = await newMapping(client, household, SHREY_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })

    const { rows } = await client.query(
      `update public.economic_parties set display_name = 'A Completely Different Name'
       where party_id = $1 returning *`,
      [party.party_id]
    )
    assert.equal(rows[0].party_id, party.party_id, 'the UUID is the identity and never moves')
    assert.equal(rows[0].household_id, party.household_id)
    assert.equal(rows[0].created_at.getTime(), party.created_at.getTime())
    assert.equal(rows[0].legacy_owner_label, 'Shrey', 'a rename never rewrites the frozen label')

    const after = await client.query(
      `select economic_party_id, status from public.access_party_mappings where mapping_id = $1`,
      [mapping.mapping_id]
    )
    assert.equal(after.rows[0].economic_party_id, party.party_id, 'mappings follow the UUID')
    assert.equal(after.rows[0].status, 'mapped')
  })
})

test('party identity, household, kind and created_at are immutable; deletion is refused', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const other = await newHousehold(client, 'SHR-193 other household')
    const party = await newParty(client, household, 'Party')

    for (const [sql, matcher] of [
      [
        `update public.economic_parties set party_id = gen_random_uuid() where party_id = $1`,
        /SHR193_ECONOMIC_PARTY_IDENTITY_IMMUTABLE/,
      ],
      [
        `update public.economic_parties set created_at = now() - interval '1 year' where party_id = $1`,
        /SHR193_ECONOMIC_PARTY_CREATED_AT_IMMUTABLE/,
      ],
      [
        `delete from public.economic_parties where party_id = $1`,
        /SHR193_ECONOMIC_PARTY_DELETE_FORBIDDEN/,
      ],
    ]) {
      await expectReject(client, () => client.query(sql, [party.party_id]), matcher)
    }

    await expectReject(
      client,
      () =>
        client.query(
          `update public.economic_parties set household_id = $2 where party_id = $1`,
          [party.party_id, other]
        ),
      /SHR193_ECONOMIC_PARTY_HOUSEHOLD_IMMUTABLE/
    )
  })
})

// ── Legacy label is compatibility only ───────────────────────────────────

test('the legacy owner label is not an identity, not unique and not an authorization key', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    // Two distinct parties may legitimately carry the same legacy text, and two
    // parties may share a display name: only the UUID distinguishes them.
    const a = await newParty(client, household, 'Shrey', { legacyOwnerLabel: 'Shrey' })
    const b = await newParty(client, household, 'Shrey', { legacyOwnerLabel: 'Shrey' })
    assert.notEqual(a.party_id, b.party_id)

    const constraints = await client.query(`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'economic_parties'
    `)
    for (const { indexdef } of constraints.rows) {
      if (/unique/i.test(indexdef)) {
        assert.doesNotMatch(
          indexdef,
          /legacy_owner_label|display_name/,
          'neither the legacy label nor the display name may become an alternate key'
        )
      }
    }

    // It is not consulted by any policy, so it can grant nothing.
    const policies = await client.query(`
      select schemaname, tablename, policyname, qual, with_check from pg_policies
      where coalesce(qual, '') || coalesce(with_check, '') ilike '%legacy_owner_label%'
    `)
    assert.equal(policies.rows.length, 0, 'no policy may derive permission from a legacy label')
  })
})

test('the legacy owner label is frozen once set', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const labelled = await newParty(client, household, 'Party', { legacyOwnerLabel: 'Joint' })

    for (const value of ['Shrey', null]) {
      await expectReject(
        client,
        () =>
          client.query(
            `update public.economic_parties set legacy_owner_label = $2 where party_id = $1`,
            [labelled.party_id, value]
          ),
        /SHR193_LEGACY_OWNER_LABEL_IMMUTABLE/
      )
    }

    // A party that has none may still receive one on the operator path — that is
    // the compatibility backfill SHR-194 performs — and it is frozen from then on.
    const bare = await newParty(client, household, 'Unlabelled')
    const { rows } = await client.query(
      `update public.economic_parties set legacy_owner_label = 'Tarika' where party_id = $1
       returning legacy_owner_label`,
      [bare.party_id]
    )
    assert.equal(rows[0].legacy_owner_label, 'Tarika')
    await expectReject(
      client,
      () =>
        client.query(
          `update public.economic_parties set legacy_owner_label = 'Shrey' where party_id = $1`,
          [bare.party_id]
        ),
      /SHR193_LEGACY_OWNER_LABEL_IMMUTABLE/
    )
  })
})

// ── Mapping decision invariants ──────────────────────────────────────────

test('exactly one mapping decision exists per (household, auth identity)', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    await newMapping(client, household, SHREY_ID)
    await expectReject(
      client,
      () => newMapping(client, household, SHREY_ID),
      /access_party_mappings_decision_key|duplicate key/
    )

    // The same auth identity may hold a decision in a different economic
    // household: the key is the pair, not the identity alone.
    const second = await newHousehold(client, 'SHR-193 second household')
    const row = await newMapping(client, second, SHREY_ID)
    assert.equal(row.auth_user_id, SHREY_ID)
  })
})

test('mapped requires a party; access_only and unreviewed forbid one', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')

    await expectReject(
      client,
      () => newMapping(client, household, SHREY_ID, { status: 'mapped' }),
      /access_party_mappings_shape_check/
    )
    await expectReject(
      client,
      () =>
        newMapping(client, household, SHREY_ID, {
          status: 'access_only',
          partyId: party.party_id,
        }),
      /access_party_mappings_shape_check/
    )
    await expectReject(
      client,
      () =>
        newMapping(client, household, SHREY_ID, {
          status: 'unreviewed',
          partyId: party.party_id,
        }),
      /access_party_mappings_shape_check/
    )
    await expectReject(
      client,
      () => newMapping(client, household, SHREY_ID, { status: 'owner' }),
      // Either constraint legitimately rejects it; Postgres does not promise
      // which of the two it reports first.
      /access_party_mappings_(status|decision_evidence)_check/
    )

    // The three valid shapes.
    const mapped = await newMapping(client, household, SHREY_ID, {
      status: 'mapped',
      partyId: party.party_id,
    })
    assert.equal(mapped.status, 'mapped')
    assert.ok(mapped.decided_at, 'a decision is stamped by the database')

    const accessOnly = await newMapping(client, household, TARIKA_ID, { status: 'access_only' })
    assert.equal(accessOnly.economic_party_id, null)
    assert.ok(accessOnly.decided_at)

    const unreviewed = await newMapping(client, household, OUTSIDER_ID)
    assert.equal(unreviewed.status, 'unreviewed')
    assert.equal(unreviewed.economic_party_id, null)
    assert.equal(unreviewed.decided_at, null, 'unreviewed genuinely means undecided')
  })
})

test('one mapping decision selects at most one economic party', async () => {
  await withTx(async (client) => {
    // Structural, not conventional: there is exactly one column referencing
    // economic_parties, so a decision cannot name two parties at all, and no
    // join table exists that would let it.
    const { rows } = await client.query(`
      select a.attname
      from pg_constraint c
      join unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'public.access_party_mappings'::regclass
        and c.contype = 'f'
        and c.confrelid = 'public.economic_parties'::regclass
        and a.attname <> 'household_id'
    `)
    assert.deepEqual(
      rows.map((r) => r.attname),
      ['economic_party_id']
    )

    // The claim being protected is that no *join or allocation* table exists —
    // nothing that could let one decision name two parties, or split a fact
    // between them. Asserted structurally rather than by table name, because
    // SHR-194 legitimately adds decision-evidence tables whose names match the
    // old '%part%' probe. This form is stronger: it covers every table in the
    // schema, including ones no name pattern would catch.
    const joins = await client.query(`
      select c.conrelid::regclass::text as table_name, count(*)::integer as party_refs
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.economic_parties'::regclass
      group by c.conrelid
      having count(*) > 1
    `)
    assert.deepEqual(
      joins.rows.filter((row) => row.table_name !== 'access_party_mapping_history'),
      [],
      'no table may reference two economic parties at once'
    )
    // The one table that does carry two party references is SHR-194's decision
    // history, and they are the before and after of a single transition rather
    // than a join: the decision in force still names exactly one party, on the
    // mapping row itself.
    const history = await client.query(`
      select count(*)::integer as count from information_schema.columns
      where table_schema = 'public' and table_name = 'access_party_mapping_history'
        and column_name in ('previous_economic_party_id', 'new_economic_party_id')
    `)
    assert.equal(history.rows[0].count, 2)

    // No fractional ownership anywhere in the economic identity substrate. The
    // probe is scoped to that substrate on purpose: an unrelated percentage
    // elsewhere (goal progress, a duration) is not an ownership share, and
    // sweeping the whole schema would assert something this package never
    // claimed.
    const allocation = await client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'economic_households', 'economic_parties', 'access_party_mappings',
          'access_party_mapping_history', 'access_party_reconciliation_runs')
        and (column_name ilike '%share%' or column_name ilike '%percent%'
             or column_name ilike '%allocation%' or column_name ilike '%weight%'
             or column_name ilike '%ratio%' or column_name ilike '%split%')
    `)
    assert.deepEqual(
      allocation.rows,
      [],
      'no fractional ownership column may exist in the economic identity substrate'
    )
  })
})

test('several access identities may map to one economic party', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'One Person')

    // A replacement login, a second device, a re-created account: all the same
    // economic person. Nothing here imposes one-auth-identity-per-party.
    const identities = [SHREY_ID, TARIKA_ID, OUTSIDER_ID]
    for (const identity of identities) {
      await newMapping(client, household, identity, {
        partyId: party.party_id,
        status: 'mapped',
      })
    }
    const { rows } = await client.query(
      `select count(*)::integer as count from public.access_party_mappings
       where economic_party_id = $1`,
      [party.party_id]
    )
    assert.equal(rows[0].count, identities.length)
  })
})

test('a mapping cannot reference a party in another economic household', async () => {
  await withTx(async (client) => {
    const a = await newHousehold(client, 'SHR-193 household A')
    const b = await newHousehold(client, 'SHR-193 household B')
    const partyInB = await newParty(client, b, 'Party in B')

    await expectReject(
      client,
      () => newMapping(client, a, SHREY_ID, { partyId: partyInB.party_id, status: 'mapped' }),
      /access_party_mappings_party_fk|violates foreign key/
    )

    // And the containment survives an update, not just an insert.
    const partyInA = await newParty(client, a, 'Party in A')
    const mapping = await newMapping(client, a, SHREY_ID, {
      partyId: partyInA.party_id,
      status: 'mapped',
    })
    await expectReject(
      client,
      () =>
        client.query(
          `update public.access_party_mappings set economic_party_id = $2 where mapping_id = $1`,
          [mapping.mapping_id, partyInB.party_id]
        ),
      /access_party_mappings_party_fk|violates foreign key/
    )
  })
})

test('the subject of a mapping decision is immutable', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const other = await newHousehold(client, 'SHR-193 elsewhere')
    const mapping = await newMapping(client, household, SHREY_ID)

    for (const [sql, params, matcher] of [
      [
        `update public.access_party_mappings set auth_user_id = $2 where mapping_id = $1`,
        [mapping.mapping_id, TARIKA_ID],
        /SHR193_MAPPING_AUTH_IDENTITY_IMMUTABLE/,
      ],
      [
        `update public.access_party_mappings set household_id = $2 where mapping_id = $1`,
        [mapping.mapping_id, other],
        /SHR193_MAPPING_HOUSEHOLD_IMMUTABLE/,
      ],
      [
        `update public.access_party_mappings set mapping_id = gen_random_uuid() where mapping_id = $1`,
        [mapping.mapping_id],
        /SHR193_MAPPING_IDENTITY_IMMUTABLE/,
      ],
    ]) {
      await expectReject(client, () => client.query(sql, params), matcher)
    }
  })
})

// ── Archived-party lifecycle ─────────────────────────────────────────────

test('an archived party stays resolvable and keeps its existing mappings', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Archived Later')
    const mapping = await newMapping(client, household, SHREY_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })

    await client.query(
      `update public.economic_parties set archived_at = now() where party_id = $1`,
      [party.party_id]
    )

    const { rows } = await client.query(
      `select m.status, m.economic_party_id, p.display_name, p.archived_at
       from public.access_party_mappings m
       join public.economic_parties p on p.party_id = m.economic_party_id
       where m.mapping_id = $1`,
      [mapping.mapping_id]
    )
    assert.equal(rows.length, 1, 'archiving rewrites nothing and hides nothing from history')
    assert.equal(rows[0].economic_party_id, party.party_id)
    assert.equal(rows[0].status, 'mapped')
    assert.ok(rows[0].archived_at)
  })
})

test('a new mapping to an archived party fails closed for every role, operator included', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const archived = await newParty(client, household, 'Archived', {
      archivedAt: new Date(Date.now() - 60_000),
    })

    await expectReject(
      client,
      () => newMapping(client, household, SHREY_ID, { partyId: archived.party_id, status: 'mapped' }),
      /SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN/
    )

    // Re-pointing an existing decision at an archived party is equally a new
    // selection, and is refused even though the row already existed.
    const active = await newParty(client, household, 'Active')
    const mapping = await newMapping(client, household, TARIKA_ID, {
      partyId: active.party_id,
      status: 'mapped',
    })
    await expectReject(
      client,
      () =>
        client.query(
          `update public.access_party_mappings set economic_party_id = $2 where mapping_id = $1`,
          [mapping.mapping_id, archived.party_id]
        ),
      /SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

// ── The restore boundary ─────────────────────────────────────────────────
//
// These replace an earlier test that treated a caller-supplied old decided_at
// as proof of restore. That behaviour no longer exists — independent Tier-3
// review rejected it, because SHR-194's ordinary writer runs with the same
// operator authority and could have forged it. The tests below are the stronger
// equivalents: they prove the ordinary path cannot forge a historical decision
// at all, and that only the explicit named boundary can reproduce one.

test('an ordinary INSERT has its decision time authored by the database', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')

    const stamped = await newMapping(client, household, SHREY_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })
    assert.ok(stamped.decided_at, 'a decision made with no timestamp is stamped')

    // ...and a caller-supplied timestamp is overridden rather than honoured, so
    // no ordinary write can present itself as historical.
    const forged = new Date('2020-01-01T00:00:00Z')
    const overridden = await newMapping(client, household, TARIKA_ID, {
      partyId: party.party_id,
      status: 'mapped',
      decidedAt: forged,
    })
    assert.notEqual(
      overridden.decided_at.getTime(),
      forged.getTime(),
      'a caller may not choose the authoritative decision time'
    )
    assert.ok(
      overridden.decided_at.getTime() > forged.getTime(),
      'the database authors it as now, not as the forged past'
    )
    // created_at and updated_at are database-authored on the ordinary path too.
    assert.ok(overridden.created_at.getTime() > forged.getTime())
    assert.ok(overridden.updated_at.getTime() > forged.getTime())
  })
})

test('the operator cannot forge a historical archived-party mapping through ordinary DML', async () => {
  await withTx(async (client) => {
    // This is the exact forgery the review found: an old decided_at supplied to
    // a normal INSERT, by the same operator authority SHR-194's writer will use.
    const household = await newHousehold(client)
    const archivedAt = new Date('2026-06-01T00:00:00Z')
    const party = await newParty(client, household, 'Archived', { archivedAt })

    await expectReject(
      client,
      () =>
        newMapping(client, household, SHREY_ID, {
          partyId: party.party_id,
          status: 'mapped',
          decidedAt: new Date('2026-01-01T00:00:00Z'), // predates archival
        }),
      /SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('an explicit restore reproduces a historical decision exactly', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const mappingId = '00000000-0000-0000-0000-0000000000a1'
    const decidedAt = new Date('2026-01-01T00:00:00Z')
    const createdAt = new Date('2025-12-31T00:00:00Z')
    const updatedAt = new Date('2026-02-02T00:00:00Z')

    const restored = await restoreMapping(client, {
      mappingId,
      householdId: household,
      authUserId: SHREY_ID,
      partyId: party.party_id,
      status: 'mapped',
      decidedAt,
      decidedBy: TARIKA_ID,
      evidenceRef: 'shr194-manifest-row-1',
      createdAt,
      updatedAt,
    })

    // Every field the contract requires a restore to preserve.
    assert.equal(restored.mapping_id, mappingId)
    assert.equal(restored.household_id, household)
    assert.equal(restored.auth_user_id, SHREY_ID)
    assert.equal(restored.economic_party_id, party.party_id)
    assert.equal(restored.status, 'mapped')
    assert.equal(restored.decided_at.getTime(), decidedAt.getTime())
    assert.equal(restored.decided_by_access_user_id, TARIKA_ID)
    assert.equal(restored.decision_evidence_ref, 'shr194-manifest-row-1')
    assert.equal(restored.created_at.getTime(), createdAt.getTime())
    assert.equal(restored.updated_at.getTime(), updatedAt.getTime())
  })
})

test('an explicit restore reproduces a mapping whose decision predates later archival', async () => {
  await withTx(async (client) => {
    // The case a naive fail-closed rule would make unrestorable: the party comes
    // back already archived, carrying a decision made long before that.
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Departed Party', {
      archivedAt: new Date('2026-06-01T00:00:00Z'),
    })
    const decidedAt = new Date('2026-01-01T00:00:00Z')

    const restored = await restoreMapping(client, {
      mappingId: '00000000-0000-0000-0000-0000000000a2',
      householdId: household,
      authUserId: SHREY_ID,
      partyId: party.party_id,
      status: 'mapped',
      decidedAt,
    })
    assert.equal(restored.economic_party_id, party.party_id)
    assert.equal(restored.decided_at.getTime(), decidedAt.getTime())
  })
})

test('a restore cannot invent a historical decision that never happened', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Archived', {
      archivedAt: new Date('2026-06-01T00:00:00Z'),
    })

    // A "restore" of an archived-party mapping decided *after* the archival is
    // not a restore of anything — it could never have existed.
    for (const decidedAt of [new Date('2026-07-01T00:00:00Z'), null]) {
      await expectReject(
        client,
        () =>
          restoreMapping(client, {
            mappingId: '00000000-0000-0000-0000-0000000000a3',
            householdId: household,
            authUserId: SHREY_ID,
            partyId: party.party_id,
            status: 'mapped',
            decidedAt,
          }),
        /SHR193_RESTORE_DECISION_NOT_HISTORICAL|access_party_mappings_decision_evidence_check/
      )
    }
  })
})

test('a restore token is bound to one row and consumed, so it cannot unlock a second', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const decidedAt = new Date('2026-01-01T00:00:00Z')

    await restoreMapping(client, {
      mappingId: '00000000-0000-0000-0000-0000000000a4',
      householdId: household,
      authUserId: SHREY_ID,
      partyId: party.party_id,
      status: 'mapped',
      decidedAt,
    })

    // The token issued for that row is spent. An ordinary INSERT immediately
    // afterwards, in the same transaction, is stamped normally.
    const next = await newMapping(client, household, TARIKA_ID, {
      partyId: party.party_id,
      status: 'mapped',
      decidedAt,
    })
    assert.notEqual(
      next.decided_at.getTime(),
      decidedAt.getTime(),
      'a spent restore token must not carry over to the next row'
    )
  })
})

test('a restore token issued for one row does not admit a different row', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const archived = await newParty(client, household, 'Archived', {
      archivedAt: new Date('2026-06-01T00:00:00Z'),
    })

    // Even holding a token — the strongest position an operator could reach
    // short of dropping the trigger — it only names one mapping_id, so a
    // different row is still an ordinary write and still fails closed.
    await client.query(`select set_config('shr193.restore_mapping_id', $1, true)`, [
      '00000000-0000-0000-0000-0000000000a5',
    ])
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.access_party_mappings
             (mapping_id, household_id, auth_user_id, economic_party_id, status, decided_at)
           values ($1, $2, $3, $4, 'mapped', $5)`,
          [
            '00000000-0000-0000-0000-0000000000a6',
            household,
            SHREY_ID,
            archived.party_id,
            new Date('2026-01-01T00:00:00Z'),
          ]
        ),
      /SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('a restore is still bound by every structural invariant', async () => {
  await withTx(async (client) => {
    const a = await newHousehold(client, 'SHR-193 household A')
    const b = await newHousehold(client, 'SHR-193 household B')
    const partyInB = await newParty(client, b, 'Party in B')
    const decidedAt = new Date('2026-01-01T00:00:00Z')

    // Cross-household containment survives the restore path.
    await expectReject(
      client,
      () =>
        restoreMapping(client, {
          mappingId: '00000000-0000-0000-0000-0000000000a7',
          householdId: a,
          authUserId: SHREY_ID,
          partyId: partyInB.party_id,
          status: 'mapped',
          decidedAt,
        }),
      /access_party_mappings_party_fk|violates foreign key/
    )

    // ...as does the status/party shape.
    await expectReject(
      client,
      () =>
        restoreMapping(client, {
          mappingId: '00000000-0000-0000-0000-0000000000a8',
          householdId: b,
          authUserId: SHREY_ID,
          partyId: partyInB.party_id,
          status: 'access_only',
          decidedAt,
        }),
      /access_party_mappings_shape_check/
    )

    // ...and the one-decision-per-identity key.
    await restoreMapping(client, {
      mappingId: '00000000-0000-0000-0000-0000000000a9',
      householdId: b,
      authUserId: SHREY_ID,
      partyId: partyInB.party_id,
      status: 'mapped',
      decidedAt,
    })
    await expectReject(
      client,
      () =>
        restoreMapping(client, {
          mappingId: '00000000-0000-0000-0000-0000000000aa',
          householdId: b,
          authUserId: SHREY_ID,
          partyId: partyInB.party_id,
          status: 'mapped',
          decidedAt,
        }),
      /access_party_mappings_decision_key|duplicate key/
    )

    // A restore must name the row it is reproducing.
    await expectReject(
      client,
      () =>
        restoreMapping(client, {
          mappingId: null,
          householdId: b,
          authUserId: TARIKA_ID,
          partyId: partyInB.party_id,
          status: 'mapped',
          decidedAt,
        }),
      /SHR193_RESTORE_REQUIRES_MAPPING_ID/
    )
  })
})

test('no API role can reach the restore boundary', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')

    const { rows } = await client.query(`
      select p.oid,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
      from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and p.proname = 'restore_access_party_mapping_v1'
    `)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].anon, false)
    assert.equal(rows[0].authenticated, false)
    assert.equal(rows[0].service_role, false)

    // Not merely ungranted — unusable. Each role is refused, and even holding a
    // forged token an API role still has no INSERT privilege on the table.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expectReject(
        client,
        async () => {
          await client.query(`set local role ${role}`)
          if (role === 'authenticated') {
            await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [SHREY_ID])
          }
          await client.query(
            `select * from private.restore_access_party_mapping_v1(
               $1, $2, $3, $4, 'mapped', $5, null, null, null, null)`,
            [
              '00000000-0000-0000-0000-0000000000ab',
              household,
              SHREY_ID,
              party.party_id,
              new Date('2026-01-01T00:00:00Z'),
            ]
          )
        },
        /permission denied|SHR193_RESTORE_FORBIDDEN/
      )
      await asOwner(client)
    }
  })
})

// ── Mapping evidence is durable ──────────────────────────────────────────

test('a mapping decision cannot be hard-deleted by any role, operator included', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    const mapping = await newMapping(client, household, SHREY_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })

    // The operator/database-owner ordinary DML path — the one the review found
    // open — is refused by the guard itself.
    await expectReject(
      client,
      () =>
        client.query(`delete from public.access_party_mappings where mapping_id = $1`, [
          mapping.mapping_id,
        ]),
      /SHR193_MAPPING_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query(`delete from public.access_party_mappings`),
      /SHR193_MAPPING_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query(`truncate table public.access_party_mappings cascade`),
      /SHR193_ECONOMIC_IDENTITY_TRUNCATE_FORBIDDEN/
    )

    // API roles are refused earlier still, on privilege.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expectReject(
        client,
        async () => {
          await client.query(`set local role ${role}`)
          if (role === 'authenticated') {
            await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [SHREY_ID])
          }
          await client.query(`delete from public.access_party_mappings`)
        },
        /permission denied/
      )
      await asOwner(client)
    }

    // The evidence is still there.
    const { rows } = await client.query(
      `select status from public.access_party_mappings where mapping_id = $1`,
      [mapping.mapping_id]
    )
    assert.equal(rows[0].status, 'mapped')
  })
})

test('no foreign key can silently cascade mapping evidence away', async () => {
  await withTx(async (client) => {
    // Every reference to a mapping decision is ON DELETE RESTRICT, and the two
    // keys the table itself holds point at tables whose own DELETE is refused
    // outright — so there is no cascade path to these rows from anywhere.
    //
    // SHR-194 adds an inbound reference (its decision history). That does not
    // weaken this claim, it extends it: a RESTRICT reference makes a mapping
    // harder to remove, never easier, and the assertion below now proves that
    // property of every referencing table rather than relying on there being
    // none.
    const inbound = await client.query(`
      select c.conname, c.conrelid::regclass::text as referencing, c.confdeltype
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.access_party_mappings'::regclass
    `)
    for (const fk of inbound.rows) {
      // 'r' = RESTRICT, 'a' = NO ACTION. Never 'c' (cascade) or 'n' (set null).
      assert.ok(
        ['r', 'a'].includes(fk.confdeltype),
        `${fk.conname} on ${fk.referencing} must never cascade mapping evidence away`
      )
    }

    const outbound = await client.query(`
      select c.conname, c.confdeltype, c.confrelid::regclass::text as referenced
      from pg_constraint c
      where c.contype = 'f' and c.conrelid = any($1::regclass[])
    `, [['public.access_party_mappings', 'public.economic_parties']])
    assert.ok(outbound.rows.length >= 3)
    for (const fk of outbound.rows) {
      // 'r' = RESTRICT. Never 'c' (cascade) or 'n' (set null).
      assert.equal(fk.confdeltype, 'r', `${fk.conname} must be ON DELETE RESTRICT`)
    }
  })
})

test('reactivating a party is non-destructive and restores new-write eligibility', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Paused', { archivedAt: new Date() })

    const { rows } = await client.query(
      `update public.economic_parties set archived_at = null where party_id = $1 returning *`,
      [party.party_id]
    )
    assert.equal(rows[0].party_id, party.party_id, 'reactivation never mints a new identity')
    assert.equal(rows[0].archived_at, null)

    const mapping = await newMapping(client, household, SHREY_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })
    assert.equal(mapping.economic_party_id, party.party_id)
  })
})

// ── The separation proof: economic identity is never authorization ───────

test('a mapping decision grants no household access whatsoever', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Outsider Party')
    // OUTSIDER_ID is deliberately not in household_members.
    await newMapping(client, household, OUTSIDER_ID, {
      partyId: party.party_id,
      status: 'mapped',
    })

    await actAs(client, 'authenticated', OUTSIDER_ID)
    const member = await client.query(`select private.is_household_member() as ok`)
    assert.equal(member.rows[0].ok, false, 'being an economic party is not being a member')

    for (const table of [...ECONOMIC_TABLES, 'transactions', 'accounts', 'goals']) {
      const { rows } = await client.query(`select count(*)::integer as count from public.${table}`)
      assert.equal(rows[0].count, 0, `${table} must stay invisible to a mapped non-member`)
    }
    await asOwner(client)
  })
})

test('revoked household access stays revoked despite a stale mapping', async () => {
  await withTx(async (client) => {
    const revoked = '00000000-0000-0000-0000-0000000000f1'
    await client.query(
      `insert into auth.users (id, email) values ($1, 'revoked@example.test')`,
      [revoked]
    )
    await client.query(`insert into public.household_members (user_id) values ($1)`, [revoked])

    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Formerly Present')
    await newMapping(client, household, revoked, { partyId: party.party_id, status: 'mapped' })

    await actAs(client, 'authenticated', revoked)
    assert.equal(
      (await client.query(`select private.is_household_member() as ok`)).rows[0].ok,
      true,
      'while a member, access is normal'
    )
    await asOwner(client)

    // Authorization is revoked; the economic mapping is deliberately left behind.
    await client.query(`delete from public.household_members where user_id = $1`, [revoked])

    await actAs(client, 'authenticated', revoked)
    assert.equal(
      (await client.query(`select private.is_household_member() as ok`)).rows[0].ok,
      false,
      'a stale mapping must not restore membership'
    )
    for (const table of [...ECONOMIC_TABLES, 'transactions']) {
      const { rows } = await client.query(`select count(*)::integer as count from public.${table}`)
      assert.equal(rows[0].count, 0, `${table} must be invisible after revocation`)
    }
    await asOwner(client)

    // The mapping evidence itself survives the revocation.
    const { rows } = await client.query(
      `select status from public.access_party_mappings where auth_user_id = $1`,
      [revoked]
    )
    assert.equal(rows[0].status, 'mapped', 'the economic record outlives the access decision')
  })
})

test('replacing an auth identity does not rewrite economic party identity', async () => {
  await withTx(async (client) => {
    const oldIdentity = '00000000-0000-0000-0000-0000000000f2'
    const newIdentity = '00000000-0000-0000-0000-0000000000f3'
    await client.query(
      `insert into auth.users (id, email) values ($1, 'old@example.test'), ($2, 'new@example.test')`,
      [oldIdentity, newIdentity]
    )

    const household = await newHousehold(client)
    const party = await newParty(client, household, 'One Human')
    await newMapping(client, household, oldIdentity, {
      partyId: party.party_id,
      status: 'mapped',
    })

    // The person re-registers. The old decision is a historical fact and a new
    // decision is made; both point at the same unchanged party UUID.
    await newMapping(client, household, newIdentity, {
      partyId: party.party_id,
      status: 'mapped',
    })
    // Deleting the old authentication identity must not cascade into economic
    // history — there is deliberately no foreign key to auth.users.
    await client.query(`delete from auth.users where id = $1`, [oldIdentity])

    const { rows } = await client.query(
      `select auth_user_id from public.access_party_mappings
       where economic_party_id = $1 order by created_at`,
      [party.party_id]
    )
    assert.equal(rows.length, 2, 'both decisions survive an authentication change')
    const survived = await client.query(
      `select party_id, display_name from public.economic_parties where party_id = $1`,
      [party.party_id]
    )
    assert.equal(survived.rows[0].party_id, party.party_id)
    assert.equal(survived.rows[0].display_name, 'One Human')
  })
})

test('an access_only identity is a full household member and never an economic party', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    await newMapping(client, household, SHREY_ID, { status: 'access_only' })

    await actAs(client, 'authenticated', SHREY_ID)
    assert.equal(
      (await client.query(`select private.is_household_member() as ok`)).rows[0].ok,
      true,
      'access_only says nothing about authorization, which is unchanged'
    )
    const { rows } = await client.query(
      `select status, economic_party_id from public.access_party_mappings`
    )
    assert.equal(rows[0].status, 'access_only')
    assert.equal(rows[0].economic_party_id, null, 'access_only can never carry a party')
    await asOwner(client)
  })
})

test('an unreviewed identity never becomes an economic party implicitly', async () => {
  await withTx(async (client) => {
    const household = await newHousehold(client)
    await newParty(client, household, 'The Only Party')
    const mapping = await newMapping(client, household, SHREY_ID)

    assert.equal(mapping.status, 'unreviewed')
    assert.equal(mapping.economic_party_id, null)
    // Even with exactly one candidate party in the household, nothing resolves.
    const { rows } = await client.query(`
      select count(*)::integer as count from public.access_party_mappings
      where status = 'mapped'
    `)
    assert.equal(rows[0].count, 0)
  })
})

test('the authorization root is unchanged and economic identity is absent from it', async () => {
  await withTx(async (client) => {
    // private.is_household_member() still reads household_members and nothing else.
    const { rows } = await client.query(`
      select prosrc, prosecdef from pg_proc
      where pronamespace = 'private'::regnamespace and proname = 'is_household_member'
    `)
    assert.equal(rows.length, 1, 'the authorization root must still exist')
    assert.equal(rows[0].prosecdef, true)
    assert.match(rows[0].prosrc, /household_members/)
    assert.doesNotMatch(rows[0].prosrc, /economic_part|access_party/i)

    // No replacement authorization mechanism was created.
    const invented = await client.query(`
      select proname from pg_proc
      where proname ilike '%economic_party_member%' or proname ilike '%is_economic%'
    `)
    assert.deepEqual(invented.rows, [], 'no second authorization root may exist')
  })
})

test('no RLS policy anywhere references economic ownership', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as predicate
      from pg_policies where schemaname = 'public'
    `)
    assert.ok(rows.length > 0)
    for (const { tablename, policyname, predicate } of rows) {
      assert.doesNotMatch(
        predicate,
        /economic_part|access_party|party_id|owner_party|legacy_owner_label/i,
        `${tablename}.${policyname} must not authorize through economic ownership`
      )
    }
  })
})

test('every policy on the new tables authorizes through the existing membership root', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname, cmd, roles::text, qual
      from pg_policies where schemaname = 'public' and tablename = any($1)
      order by tablename
    `, [ECONOMIC_TABLES])
    assert.equal(rows.length, 3, 'exactly one policy per new table')
    for (const policy of rows) {
      assert.equal(policy.cmd, 'SELECT', 'read is the only capability granted')
      assert.match(policy.roles, /authenticated/)
      assert.match(policy.qual, /is_household_member/)
    }

    const rls = await client.query(`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relname = any($1)
    `, [ECONOMIC_TABLES])
    assert.equal(rls.rows.length, 3)
    for (const table of rls.rows) {
      assert.equal(table.relrowsecurity, true, `${table.relname} must have RLS enabled`)
    }
  })
})

// ── ACL matrix ───────────────────────────────────────────────────────────

test('anon has no privilege of any kind on the economic identity substrate', async () => {
  await withTx(async (client) => {
    for (const table of ECONOMIC_TABLES) {
      const { rows } = await client.query(
        `select coalesce(array_agg(privilege_type::text), '{}'::text[]) as privs
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1 and grantee = 'anon'`,
        [table]
      )
      assert.deepEqual(rows[0].privs, [], `anon must hold nothing on ${table}`)
    }

    const household = await newHousehold(client)
    await newParty(client, household, 'Party')
    await actAs(client, 'anon')
    for (const table of ECONOMIC_TABLES) {
      await expectReject(
        client,
        () => client.query(`select * from public.${table}`),
        /permission denied/
      )
    }
    await asOwner(client)
  })
})

test('authenticated holds SELECT only — no browser write path exists', async () => {
  await withTx(async (client) => {
    for (const table of ECONOMIC_TABLES) {
      const { rows } = await client.query(
        `select array_agg(privilege_type::text order by privilege_type::text) as privs
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1 and grantee = 'authenticated'`,
        [table]
      )
      assert.deepEqual(rows[0].privs, ['SELECT'], `authenticated must hold only SELECT on ${table}`)
    }

    const household = await newHousehold(client)
    const party = await newParty(client, household, 'Party')
    await actAs(client, 'authenticated', SHREY_ID)

    // A member reads their household's economic identity records...
    const read = await client.query(`select count(*)::integer as count from public.economic_parties`)
    assert.equal(read.rows[0].count, 1)

    // ...and can write none of them, on any table, by any statement.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.economic_parties (household_id, display_name) values ($1, 'Injected')`,
          [household]
        ),
      /permission denied/
    )
    await expectReject(
      client,
      () =>
        client.query(`update public.economic_parties set display_name = 'Renamed' where party_id = $1`, [
          party.party_id,
        ]),
      /permission denied/
    )
    await expectReject(
      client,
      () => client.query(`delete from public.access_party_mappings`),
      /permission denied/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.access_party_mappings (household_id, auth_user_id) values ($1, $2)`,
          [household, SHREY_ID]
        ),
      /permission denied/
    )
    await asOwner(client)
  })
})

test('service_role holds the raw read the backup exporter needs and nothing more', async () => {
  await withTx(async (client) => {
    for (const table of ECONOMIC_TABLES) {
      const { rows } = await client.query(
        `select array_agg(privilege_type::text order by privilege_type::text) as privs
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1 and grantee = 'service_role'`,
        [table]
      )
      assert.deepEqual(rows[0].privs, ['SELECT'], `service_role must hold only SELECT on ${table}`)
    }

    const household = await newHousehold(client)
    await newParty(client, household, 'Party')
    await actAs(client, 'service_role')
    // service_role bypasses RLS by construction, which is exactly why the
    // grant, not the policy, has to be the limit.
    const read = await client.query(`select count(*)::integer as count from public.economic_parties`)
    assert.equal(read.rows[0].count, 1)
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.economic_parties (household_id, display_name) values ($1, 'Injected')`,
          [household]
        ),
      /permission denied/
    )
    await asOwner(client)
  })
})

test('no API role can execute the guard or operator functions', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select p.proname, p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
      from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and (p.proname like '%economic%' or p.proname like '%access_party%')
    `)
    // SHR-193's own six — the four guards, the operator predicate and the
    // restore boundary — named exactly rather than counted, so that a later
    // package adding its own private functions cannot make this assertion pass
    // by coincidence or fail by arithmetic. Every function the probe matches,
    // SHR-194's included, still has to satisfy every property below.
    for (const required of [
      'economic_identity_operator_authority',
      'guard_economic_household_lifecycle',
      'guard_economic_party_lifecycle',
      'guard_access_party_mapping_lifecycle',
      'reject_economic_identity_truncate',
      'restore_access_party_mapping_v1',
    ]) {
      assert.ok(
        rows.some((fn) => fn.proname === required),
        `${required} is covered by this matrix, not exempt from it`
      )
    }
    assert.ok(rows.length >= 6)
    for (const fn of rows) {
      assert.equal(fn.anon, false, `${fn.proname} must be uncallable by anon`)
      assert.equal(fn.authenticated, false, `${fn.proname} must be uncallable by authenticated`)
      assert.equal(fn.service_role, false, `${fn.proname} must be uncallable by service_role`)
      assert.equal(fn.prosecdef, false, `${fn.proname} must be SECURITY INVOKER`)
      assert.ok(
        (fn.proconfig ?? []).some((c) => c.startsWith('search_path=')),
        `${fn.proname} must pin its search_path`
      )
    }
  })
})

test('SHR-193 adds no public RPC and no new database role', async () => {
  await withTx(async (client) => {
    const rpcs = await client.query(`
      select proname from pg_proc
      where pronamespace = 'public'::regnamespace
        and (proname ilike '%econom%' or proname ilike '%party%' or proname ilike '%household_context%')
    `)
    assert.deepEqual(rpcs.rows, [], 'no product mutation or read API is invented here')

    const roles = await client.query(`
      select rolname from pg_roles
      where rolname ~* '^(me|partner|shrey|tarika|joint|spouse|primary|owner)$'
    `)
    assert.deepEqual(roles.rows, [], 'no person-shaped database role may be introduced')
  })
})

// ── Bounded scope: nothing downstream is implemented early ───────────────

test('no financial table receives ownership or attribution in SHR-193', async () => {
  await withTx(async (client) => {
    const financialTables = [
      'transactions', 'accounts', 'income', 'recurring', 'goals', 'goal_contributions',
      'budgets', 'category_rules', 'nw_snapshots', 'nw_daily', 'pending_actions',
      'forecast_events', 'settings',
    ]
    const { rows } = await client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1)
        and (column_name like '%party%'
             or column_name = 'household_id'
             or column_name like '%attribution%'
             or column_name like '%ownership%'
             or column_name like '%scope_kind%')
    `, [financialTables])
    assert.deepEqual(
      rows, [],
      `SHR-193 adds no attribution column and no household_id fan-out: found ${JSON.stringify(rows)}`
    )
  })
})

test('no fractional ownership or allocation exists anywhere in the substrate', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = any($1)
    `, [ECONOMIC_TABLES])
    for (const column of rows) {
      assert.doesNotMatch(
        column.column_name,
        /share|percent|ratio|weight|allocat|split|fraction/i,
        `${column.table_name}.${column.column_name} looks like fractional ownership`
      )
      assert.notEqual(column.data_type, 'numeric', 'the identity substrate carries no quantities')
    }

    const allocationTables = await client.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and (table_name ilike '%allocation%' or table_name ilike '%ownership_share%')
    `)
    assert.deepEqual(allocationTables.rows, [], 'no allocation table may be introduced')
  })
})

test('no Telegram identity is mapped to an economic party', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%telegram%' or column_name ilike '%tg_%')
        and table_name = any($1)
    `, [ECONOMIC_TABLES])
    assert.deepEqual(rows, [], 'Telegram identity is provenance, never economic ownership')

    const tables = await client.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name ilike '%telegram%'
    `)
    assert.deepEqual(tables.rows, [], 'Telegram storage is deferred to SHR-160/184')
  })
})

test('no audit evidence is fabricated for an empty substrate', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`select count(*)::integer as count from public.audit_events`)
    assert.equal(rows[0].count, 0, 'SHR-193 synthesizes no history and wires no writer into audit')
  })
})

test('the economic identity substrate cannot be truncated', async () => {
  await withTx(async (client) => {
    for (const table of ECONOMIC_TABLES) {
      await expectReject(
        client,
        () => client.query(`truncate table public.${table} cascade`),
        /SHR193_ECONOMIC_IDENTITY_TRUNCATE_FORBIDDEN/
      )
    }
  })
})
