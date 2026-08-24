import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { loadAccountsWealthView } from './wealthLoader.js'

test('opening Accounts performs canonical/history reads and zero snapshot writes', async () => {
  const calls = []
  const result = await loadAccountsWealthView({
    loadWealth: async () => { calls.push('canonical-read'); return { balance: {}, investments: {}, accounts: [] } },
    listHistory: async (limit) => { calls.push(`history-read:${limit}`); return [] },
  })
  assert.deepEqual(calls, ['canonical-read', 'history-read:90'])
  assert.deepEqual(result.history, [])
  assert.equal(calls.some((call) => /insert|update|upsert|record|capture/i.test(call)), false)
})

test('Accounts component has no snapshot mutation path and uses canonical wealth without a legacy fallback', () => {
  const source = readFileSync(new URL('../screens/Accounts.jsx', import.meta.url), 'utf8')
  assert.match(source, /useCanonicalWealth/)
  assert.doesNotMatch(source, /recordDailyNetWorth|upsert\s*\(|capture_nw_snapshot|claim_nw_snapshot/)
  assert.doesNotMatch(source, /toAED\(Number\(a\.value/)
})
