import assert from 'node:assert/strict'
import test from 'node:test'

import { authorizeWebhook, MAX_BODY_BYTES, secretsMatch } from './gate.ts'
import type { GateConfig } from './gate.ts'

/** Minimal stand-in for `Headers` — case-insensitive `get`, like the real thing. */
function headers(bag: Record<string, string> = {}) {
  const lower = new Map(Object.entries(bag).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

const SECRET = 'a-real-high-entropy-webhook-secret'
const configured: GateConfig = { telegramWebhookSecret: SECRET, demoMode: false }

// ── fail closed ──────────────────────────────────────────────────────────────

test('an unset webhook secret refuses the request instead of processing it', () => {
  // The regression this whole module exists for: the old code logged a warning
  // and carried on, leaving the endpoint unauthenticated against real money.
  const decision = authorizeWebhook(headers({ 'x-telegram-bot-api-secret-token': 'anything' }), {
    telegramWebhookSecret: null,
    demoMode: false,
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 503)
})

test('an unset secret refuses even a request carrying no header at all', () => {
  const decision = authorizeWebhook(headers(), { telegramWebhookSecret: null, demoMode: false })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 503)
})

// ── secret enforcement ───────────────────────────────────────────────────────

test('a missing secret header is forbidden', () => {
  const decision = authorizeWebhook(headers(), configured)
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 403)
})

test('a wrong secret header is forbidden', () => {
  const decision = authorizeWebhook(headers({ 'x-telegram-bot-api-secret-token': 'guess' }), configured)
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 403)
})

test('a secret that is a prefix of the real one is forbidden', () => {
  const decision = authorizeWebhook(
    headers({ 'x-telegram-bot-api-secret-token': SECRET.slice(0, -1) }),
    configured
  )
  assert.equal(decision.ok, false)
})

test('the correct secret is accepted', () => {
  const decision = authorizeWebhook(headers({ 'x-telegram-bot-api-secret-token': SECRET }), configured)
  assert.equal(decision.ok, true)
})

test('the secret header is matched case-insensitively on the header name', () => {
  const decision = authorizeWebhook(headers({ 'X-Telegram-Bot-Api-Secret-Token': SECRET }), configured)
  assert.equal(decision.ok, true)
})

// ── demo mode is no longer an authentication bypass ──────────────────────────

test('x-demo-mode does not bypass a missing secret header', () => {
  const decision = authorizeWebhook(headers({ 'x-demo-mode': '1' }), {
    telegramWebhookSecret: SECRET,
    demoMode: true,
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 403)
})

test('x-demo-mode does not bypass an unconfigured secret', () => {
  const decision = authorizeWebhook(headers({ 'x-demo-mode': '1' }), {
    telegramWebhookSecret: null,
    demoMode: true,
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 503)
})

test('x-demo-mode has no effect when DEMO_MODE is off, even with a valid secret', () => {
  const decision = authorizeWebhook(
    headers({ 'x-telegram-bot-api-secret-token': SECRET, 'x-demo-mode': '1' }),
    configured
  )

  assert.equal(decision.ok, true)
  assert.equal(decision.ok === true && decision.demo, false)
})

test('demo recording is available only to a caller that already proved the secret', () => {
  const decision = authorizeWebhook(
    headers({ 'x-telegram-bot-api-secret-token': SECRET, 'x-demo-mode': '1' }),
    { telegramWebhookSecret: SECRET, demoMode: true }
  )

  assert.equal(decision.ok, true)
  assert.equal(decision.ok === true && decision.demo, true)
})

// ── body cap ─────────────────────────────────────────────────────────────────

test('an oversized body is rejected', () => {
  const decision = authorizeWebhook(
    headers({ 'x-telegram-bot-api-secret-token': SECRET }),
    configured,
    String(MAX_BODY_BYTES + 1)
  )

  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.status, 413)
})

test('a normal-sized body passes, and a missing content-length is not fatal', () => {
  const withLength = authorizeWebhook(
    headers({ 'x-telegram-bot-api-secret-token': SECRET }),
    configured,
    '2048'
  )
  assert.equal(withLength.ok, true)

  const withoutLength = authorizeWebhook(headers({ 'x-telegram-bot-api-secret-token': SECRET }), configured, null)
  assert.equal(withoutLength.ok, true)
})

test('the body cap is only reached after the secret check', () => {
  // An unauthenticated caller must not learn anything about size limits.
  const decision = authorizeWebhook(headers(), configured, String(MAX_BODY_BYTES + 1))
  assert.equal(decision.ok === false && decision.status, 403)
})

// ── constant-time compare ────────────────────────────────────────────────────

test('secretsMatch handles null, length differences and exact matches', () => {
  assert.equal(secretsMatch(null, SECRET), false)
  assert.equal(secretsMatch('', SECRET), false)
  assert.equal(secretsMatch(`${SECRET}x`, SECRET), false)
  assert.equal(secretsMatch(SECRET, SECRET), true)
})

test('secretsMatch is not confused by multi-byte characters', () => {
  assert.equal(secretsMatch('sécret', 'sécret'), true)
  assert.equal(secretsMatch('sécret', 'secret'), false)
})
