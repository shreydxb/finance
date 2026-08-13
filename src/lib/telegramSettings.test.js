// UI-03: the Settings screen and the Edge Function disagreed about what a
// valid Telegram configuration is, and the screen was the optimistic one.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeConfiguration,
  isEffectivePerson,
  payableAccounts,
  validateTelegramSettings,
} from './telegramSettings.js'

const ACCOUNTS = [
  { id: 'a-cash', name: 'Joint Current', type: 'cash' },
  { id: 'a-card', name: 'ENBD Credit Card', type: 'credit_card', is_liability: true },
  { id: 'a-loan', name: 'ENBD Car Loan', type: 'loan', is_liability: true },
  { id: 'a-inv', name: 'Zerodha', type: 'investment' },
]

const person = (over = {}) => ({ person: 'Shrey', telegramUserId: '12345', ...over })

// ── what the backend actually honours ────────────────────────────────────────

test('a person needs both a name and an id to be effective', () => {
  assert.equal(isEffectivePerson(person()), true)
  // The mismatch: the screen counted this as configured, the backend drops it.
  assert.equal(isEffectivePerson(person({ person: '' })), false, 'id with no name')
  assert.equal(isEffectivePerson(person({ telegramUserId: '' })), false, 'name with no id')
  assert.equal(isEffectivePerson(person({ telegramUserId: '0' })), false, 'zero is not a user id')
  assert.equal(isEffectivePerson(person({ person: '   ' })), false, 'whitespace is not a name')
})

// ── the status message must be true ──────────────────────────────────────────

test('with nobody configured the bot ignores everything', () => {
  const result = describeConfiguration([person({ person: '', telegramUserId: '' })])
  assert.equal(result.level, 'none')
  assert.match(result.message, /ignores every message/)
})

test('one configured person is a working setup, not a broken one', () => {
  // The screen used to say "until both are filled in, the bot ignores
  // everything". The backend accepts either person alone, so that was false.
  const result = describeConfiguration([person(), person({ person: '', telegramUserId: '' })])

  assert.equal(result.level, 'partial')
  assert.match(result.message, /Shrey can log spends/)
  assert.doesNotMatch(result.message, /ignores everything/)
})

test('both configured says so plainly', () => {
  const result = describeConfiguration([person(), person({ person: 'Tarika', telegramUserId: '67890' })])
  assert.equal(result.level, 'complete')
})

test('an id with no name does not count towards the configured people', () => {
  const result = describeConfiguration([person({ person: '' })])
  assert.equal(result.level, 'none', 'the backend would ignore this entry entirely')
})

// ── validation ───────────────────────────────────────────────────────────────

const valid = { people: [person()], thresholdPercent: '85', defaultAccountId: 'a-cash', accounts: ACCOUNTS }

test('a complete configuration validates', () => {
  assert.equal(validateTelegramSettings(valid).ok, true)
})

test('a non-numeric id is rejected with the remedy, not the rule', () => {
  const result = validateTelegramSettings({ ...valid, people: [person({ telegramUserId: 'abc' })] })
  assert.equal(result.ok, false)
  assert.match(result.error, /send \/id to the bot/)
})

test('an id without a name is rejected rather than silently ignored', () => {
  const result = validateTelegramSettings({ ...valid, people: [person({ person: '' })] })
  assert.equal(result.ok, false)
  assert.match(result.error, /ignores an id with no name/)
})

test('a name without an id is rejected', () => {
  const result = validateTelegramSettings({ ...valid, people: [person({ telegramUserId: '' })] })
  assert.equal(result.ok, false)
  assert.match(result.error, /Shrey's Telegram user id/)
})

test('an empty slot is fine — one person is a valid setup', () => {
  const result = validateTelegramSettings({
    ...valid,
    people: [person(), { person: '', telegramUserId: '' }],
  })
  assert.equal(result.ok, true)
})

test('the threshold must be a percentage', () => {
  assert.equal(validateTelegramSettings({ ...valid, thresholdPercent: '101' }).ok, false)
  assert.equal(validateTelegramSettings({ ...valid, thresholdPercent: '-1' }).ok, false)
  assert.equal(validateTelegramSettings({ ...valid, thresholdPercent: 'abc' }).ok, false)
  assert.equal(validateTelegramSettings({ ...valid, thresholdPercent: '0' }).ok, true)
  assert.equal(validateTelegramSettings({ ...valid, thresholdPercent: '100' }).ok, true)
})

// ── the fallback account ─────────────────────────────────────────────────────

test('only cash and credit-card accounts can be a fallback', () => {
  // The picker offered every account, but the backend only ever loads
  // cash/credit_card — so choosing a loan or a holding did nothing at all.
  assert.deepEqual(
    payableAccounts(ACCOUNTS).map((a) => a.id),
    ['a-cash', 'a-card']
  )
})

test('a credit card qualifies despite being a liability', () => {
  // It is the most common way a receipt actually gets paid.
  assert.ok(payableAccounts(ACCOUNTS).some((a) => a.id === 'a-card'))
})

test('choosing an account the bot cannot use is rejected', () => {
  const result = validateTelegramSettings({ ...valid, defaultAccountId: 'a-loan' })
  assert.equal(result.ok, false)
  assert.match(result.error, /cash or credit-card/)
})

test('no fallback account at all is valid', () => {
  assert.equal(validateTelegramSettings({ ...valid, defaultAccountId: null }).ok, true)
  assert.equal(validateTelegramSettings({ ...valid, defaultAccountId: '' }).ok, true)
})

test('a fallback account that no longer exists is rejected', () => {
  const result = validateTelegramSettings({ ...valid, defaultAccountId: 'a-deleted' })
  assert.equal(result.ok, false)
})
