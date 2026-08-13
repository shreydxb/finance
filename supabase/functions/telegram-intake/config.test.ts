import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS, loadConfig, parseIdList, parseThreshold } from './config.ts'

const MINIMAL = {
  TELEGRAM_BOT_TOKEN: 'bot-token',
  OPENROUTER_API_KEY: 'or-key',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

test('the minimum viable secret set boots with sane defaults', () => {
  const config = loadConfig(MINIMAL)

  assert.equal(config.openRouterModel, DEFAULTS.openRouterModel)
  assert.equal(config.groqWhisperModel, DEFAULTS.groqWhisperModel)
  assert.equal(config.confidenceThreshold, DEFAULTS.confidenceThreshold)
  assert.equal(config.defaultCurrency, 'AED')
  assert.equal(config.groqApiKey, null, 'voice stays off until a key is set')
  assert.equal(config.telegramWebhookSecret, null)
  assert.equal(config.demoMode, false)
})

test('every required secret is named when it is missing', () => {
  for (const key of Object.keys(MINIMAL)) {
    const env = { ...MINIMAL, [key]: undefined }
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} should be reported`)
  }
})

test('the model is swappable without a code change', () => {
  const config = loadConfig({ ...MINIMAL, OPENROUTER_MODEL: 'anthropic/claude-haiku-4.5' })
  assert.equal(config.openRouterModel, 'anthropic/claude-haiku-4.5')
})

test('parseThreshold rejects anything outside 0–1', () => {
  assert.equal(parseThreshold('0.7', 0.85), 0.7)
  assert.equal(parseThreshold('0', 0.85), 0)
  assert.equal(parseThreshold('1', 0.85), 1)
  assert.equal(parseThreshold('1.5', 0.85), 0.85)
  assert.equal(parseThreshold('-1', 0.85), 0.85)
  assert.equal(parseThreshold('high', 0.85), 0.85)
  assert.equal(parseThreshold('', 0.85), 0.85)
  assert.equal(parseThreshold(undefined, 0.85), 0.85)
})

test('parseIdList takes commas or whitespace and drops junk', () => {
  assert.deepEqual(parseIdList('111,222'), [111, 222])
  assert.deepEqual(parseIdList('111 222'), [111, 222])
  assert.deepEqual(parseIdList('111, abc, 222'), [111, 222])
  assert.deepEqual(parseIdList(''), [])
  assert.deepEqual(parseIdList(undefined), [])
})

test('a webhook secret pasted with stray whitespace still matches', () => {
  // A dashboard field is filled in by hand and very easily picks up a trailing
  // newline or space. Telegram's header never carries one, so an untrimmed
  // value fails every request forever with nothing visible but a 403 — which
  // is exactly what happened on 13 Aug 2026.
  const config = loadConfig({ ...MINIMAL, TELEGRAM_WEBHOOK_SECRET: '  s3cr3tValue\n' })
  assert.equal(config.telegramWebhookSecret, 's3cr3tValue')
})

test('a secret of only whitespace counts as unset, not as a valid secret', () => {
  // Otherwise the gate would fail closed with 403 rather than 503, hiding a
  // misconfiguration behind what looks like an authentication failure.
  const config = loadConfig({ ...MINIMAL, TELEGRAM_WEBHOOK_SECRET: '   ' })
  assert.equal(config.telegramWebhookSecret, null)
})

test('SERVICE_ROLE_KEY overrides the deprecated platform key', () => {
  // The platform's injected key is minted per request and started failing with
  // "JWT issued at future" once this project moved to JWT Signing Keys. A
  // custom secret cannot be named SUPABASE_*, so the override carries its own
  // name.
  const config = loadConfig({ ...MINIMAL, SERVICE_ROLE_KEY: 'static-key' })
  assert.equal(config.supabaseServiceKey, 'static-key')
})

test('the platform key is still used when no override is set', () => {
  assert.equal(loadConfig(MINIMAL).supabaseServiceKey, 'service-key')
})

test('a blank override falls back rather than booting with an empty key', () => {
  assert.equal(loadConfig({ ...MINIMAL, SERVICE_ROLE_KEY: '   ' }).supabaseServiceKey, 'service-key')
})
