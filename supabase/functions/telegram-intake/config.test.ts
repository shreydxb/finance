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
