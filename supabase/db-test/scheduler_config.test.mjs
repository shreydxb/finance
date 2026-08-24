import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const activation = readFileSync(
  new URL('../scheduler/activate_authoritative_net_worth.sql', import.meta.url),
  'utf8',
)
const disable = readFileSync(
  new URL('../scheduler/disable_authoritative_net_worth.sql', import.meta.url),
  'utf8',
)

const occurrences = (source, pattern) => [...source.matchAll(pattern)].length

test('Phase C installs one named daily UTC job for the previous Dubai day', () => {
  assert.match(activation, /create extension if not exists pg_cron;/)
  assert.match(
    activation,
    /create extension if not exists pg_net with schema extensions;/,
  )
  assert.equal(occurrences(activation, /\bcron\.schedule\s*\(/gi), 1)
  assert.equal(occurrences(activation, /shr-113-authoritative-net-worth-close/g), 1)
  assert.match(activation, /'0 22 \* \* \*'/)
  assert.match(activation, /if current_user <> 'postgres'/)
  assert.match(
    activation,
    /\(\(clock_timestamp\(\) at time zone 'Asia\/Dubai'\)::date - 1\)/,
  )
  assert.match(activation, /'trigger_kind', 'scheduled'/)
  assert.match(activation, /'target_day', v_target_day::text/)
  assert.doesNotMatch(activation, /\*\/15|22-23/)
})

test('Phase C reads dual authentication material from Vault only', () => {
  for (const name of [
    'shr113_snapshot_endpoint',
    'shr113_snapshot_anon_jwt',
    'shr113_snapshot_job_secret',
  ]) {
    assert.match(activation, new RegExp(name))
  }

  assert.match(activation, /from vault\.decrypted_secrets/)
  assert.match(activation, /'Authorization', 'Bearer ' \|\| v_anon_jwt/)
  assert.match(activation, /'apikey', v_anon_jwt/)
  assert.match(activation, /'x-snapshot-job-secret', v_job_secret/)
  assert.match(activation, /timeout_milliseconds := 120000/)

  assert.doesNotMatch(activation, /https:\/\//i)
  assert.doesNotMatch(activation, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./)
  assert.doesNotMatch(activation, /sb_(?:secret|publishable)_/i)
  assert.doesNotMatch(activation, /service[_-]role.*(?:Bearer|apikey)/i)
})

test('Phase C dispatcher is private, invoker-mode, pinned, and uncallable by API roles', () => {
  assert.match(
    activation,
    /create or replace function private\.dispatch_authoritative_net_worth_snapshot\(\)/,
  )
  assert.match(activation, /security invoker\s+set search_path = ''/)
  assert.match(
    activation,
    /revoke all on function private\.dispatch_authoritative_net_worth_snapshot\(\)\s+from public, anon, authenticated, service_role;/,
  )
  assert.match(activation, /return net\.http_post\(/)
  assert.doesNotMatch(activation, /security definer/i)
  assert.doesNotMatch(activation, /grant execute/i)
})

test('Phase C rollback only deactivates the exact job and preserves evidence', () => {
  assert.match(disable, /where job\.jobname = 'shr-113-authoritative-net-worth-close'/)
  assert.match(disable, /cron\.alter_job\(job_id := v_job_id, active := false\)/)
  assert.doesNotMatch(disable, /\b(delete|drop|truncate|unschedule|update\s+public\.nw_)\b/i)
})
