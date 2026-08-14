import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveServiceKey } from './serviceKey.ts'

test('falls back to the platform-injected legacy key when nothing else is set', () => {
  assert.equal(resolveServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-key' }), 'legacy-key')
})

test('SERVICE_ROLE_KEY overrides the deprecated platform key', () => {
  assert.equal(
    resolveServiceKey({
      SERVICE_ROLE_KEY: 'static-key',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-key',
    }),
    'static-key'
  )
})

test('a blank SERVICE_ROLE_KEY falls back rather than booting with an empty key', () => {
  assert.equal(
    resolveServiceKey({ SERVICE_ROLE_KEY: '   ', SUPABASE_SERVICE_ROLE_KEY: 'legacy-key' }),
    'legacy-key'
  )
})

test('throws naming all three sources when none is set', () => {
  assert.throws(() => resolveServiceKey({}), /SUPABASE_SECRET_KEYS.*SERVICE_ROLE_KEY.*SUPABASE_SERVICE_ROLE_KEY/s)
})

test('SUPABASE_SECRET_KEYS takes precedence over both fallbacks when it parses to a known shape', () => {
  const env = {
    SUPABASE_SECRET_KEYS: JSON.stringify({ service_role: 'from-secret-keys' }),
    SERVICE_ROLE_KEY: 'static-key',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-key',
  }
  assert.equal(resolveServiceKey(env), 'from-secret-keys')
})

test('SUPABASE_SECRET_KEYS: tries each plausible key name', () => {
  for (const name of ['service_role', 'secret', 'sb_secret', 'default']) {
    const env = { SUPABASE_SECRET_KEYS: JSON.stringify({ [name]: 'value-for-' + name }) }
    assert.equal(resolveServiceKey(env), 'value-for-' + name, `should recognise "${name}"`)
  }
})

test('SUPABASE_SECRET_KEYS: unparseable JSON falls through silently, not an error', () => {
  const env = { SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: 'legacy-key' }
  assert.equal(resolveServiceKey(env), 'legacy-key')
})

test('SUPABASE_SECRET_KEYS: valid JSON with none of the known keys falls through', () => {
  const env = {
    SUPABASE_SECRET_KEYS: JSON.stringify({ anon: 'anon-key', publishable: 'pub-key' }),
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-key',
  }
  assert.equal(resolveServiceKey(env), 'legacy-key')
})

test('SUPABASE_SECRET_KEYS: an array or non-object value falls through, not a crash', () => {
  for (const raw of ['[]', '"just a string"', '42', 'null']) {
    const env = { SUPABASE_SECRET_KEYS: raw, SUPABASE_SERVICE_ROLE_KEY: 'legacy-key' }
    assert.equal(resolveServiceKey(env), 'legacy-key')
  }
})

test('SUPABASE_SECRET_KEYS: a blank string entry for a known key does not count as found', () => {
  const env = {
    SUPABASE_SECRET_KEYS: JSON.stringify({ service_role: '   ' }),
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-key',
  }
  assert.equal(resolveServiceKey(env), 'legacy-key')
})
