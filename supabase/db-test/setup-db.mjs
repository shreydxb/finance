// Builds a scratch Postgres database from empty and applies every
// supabase/schema/*.sql file in order, the same way our-rokda's did. See
// README.md for what this stands in for and what it deliberately doesn't.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg

const here = dirname(fileURLToPath(import.meta.url))
const schemaDir = join(here, '..', 'schema')

const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const dbName = process.env.TEST_DB_NAME || 'our_money_test'

function withDatabase(url, database) {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.toString()
}

async function recreateDatabase() {
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    // Terminate anything left over from a previous crashed run before dropping.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [dbName]
    )
    await admin.query(`drop database if exists ${admin.escapeIdentifier(dbName)}`)
    await admin.query(`create database ${admin.escapeIdentifier(dbName)}`)
  } finally {
    await admin.end()
  }
}

// Stands in for the two pieces of Supabase-managed infrastructure the schema
// files reference but do not create themselves: the `auth` schema (023
// reads `auth.users` directly, `is_household_member()` calls `auth.uid()`)
// and the `anon` / `authenticated` / `service_role` roles that `to <role>`
// policy clauses target. Nothing else about Supabase is emulated.
const BOOTSTRAP = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant anon to current_user;
grant authenticated to current_user;
grant service_role to current_user;

create schema if not exists auth;
create schema if not exists extensions;

-- Hosted Supabase installs relocatable extensions in the extensions
-- schema. Keep the clean-database harness faithful to that layout so schema-
-- qualified extension calls cannot pass locally and fail only when hosted.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pgcrypto') then
    alter extension pgcrypto set schema extensions;
  else
    create extension pgcrypto with schema extensions;
  end if;
end $$;

grant usage on schema extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Real Supabase resolves this from the request's JWT. Locally, tests set the
-- session variable directly with 'set local "request.jwt.claim.sub" = ...' —
-- same name Supabase's PostgREST sets, so auth.uid() behaves identically.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- 003_realtime.sql adds tables to this publication; it exists by default on
-- every Supabase project but not on a plain Postgres install.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Seeded *before* any schema file runs: 023_household_members.sql seeds
-- household_members from auth.users mid-migration, in the same transaction
-- as the policy rewrite. Without rows here that seed is empty and the RLS
-- suite would be testing a household of nobody.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'shrey@example.test', '{"name":"Shrey"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'tarika@example.test', '{"name":"Tarika"}'::jsonb)
on conflict (id) do nothing;
`

async function applySchema() {
  const client = new Client({ connectionString: withDatabase(adminUrl, dbName) })
  await client.connect()
  try {
    await client.query(BOOTSTRAP)

    // Supabase's platform grants anon/authenticated/service_role table and
    // sequence privileges on the public schema outside of any migration file
    // — RLS is what narrows access from there, not GRANT. That setup doesn't
    // live in supabase/schema/, so it's reproduced here, before any table
    // exists, via default privileges so every table the migrations go on to
    // create picks it up automatically. Functions need no equivalent: plain
    // Postgres already grants EXECUTE to PUBLIC on a new function unless a
    // migration explicitly revokes it (023/024 do, for is_household_member)
    // — reproducing that here would silently undo those revokes.
    await client.query(`
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public
        grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public
        grant all on sequences to anon, authenticated, service_role;
    `)

    const files = readdirSync(schemaDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const sql = readFileSync(join(schemaDir, file), 'utf8')
      try {
        await client.query(sql)
      } catch (err) {
        throw new Error(`${file} failed against a clean database: ${err.message}`, { cause: err })
      }
    }

    console.log(`Applied ${files.length} schema files to ${dbName}.`)
  } finally {
    await client.end()
  }
}

async function main() {
  await recreateDatabase()
  await applySchema()
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
