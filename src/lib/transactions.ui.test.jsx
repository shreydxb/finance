import { describe, expect, it } from 'vitest'

import {
  manualTransactionError,
  newManualRequestKey,
  ordinaryTransactionFields,
  runCommittedTransactionFollowUps,
} from './transactions'

describe('manual transaction client contract', () => {
  it('uses a UUID-backed durable manual request namespace', () => {
    expect(newManualRequestKey()).toMatch(/^manual:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('turns server validation failures into actionable field errors', () => {
    const staleAccount = manualTransactionError({ message: 'SHR126_ACCOUNT_INVALID' })
    expect(staleAccount.field).toBe('account')
    expect(staleAccount.message).toBe('That account is no longer available. Choose a current account.')

    const transfer = manualTransactionError({ details: 'SHR126_TRANSFER_UNSUPPORTED' })
    expect(transfer.field).toBe('category')
    expect(transfer.message).toMatch(/Transfers cannot be created or corrected as expenses/)
  })

  it('states that retry is safe when the response outcome is unknown', () => {
    const error = manualTransactionError({ message: 'network interrupted' })
    expect(error.field).toBe('general')
    expect(error.message).toMatch(/Retrying this form is safe/)
  })

  it('copies only the complete allowlisted fact into a correction', () => {
    const fields = ordinaryTransactionFields({
      date: '2026-08-28', amount: 10, currency: 'AED', account_id: 'account-1', category: 'Dining',
      owner: 'Shrey', note: 'Lunch', tags: ['meal'], assigned_to: null, goal_id: null,
      source: 'telegram', idempotency_key: 'telegram:1', needs_review: true, reviewed_at: null,
    }, { category: 'Groceries' })

    expect(fields).toEqual({
      date: '2026-08-28', amount: 10, currency: 'AED', account_id: 'account-1', category: 'Groceries',
      owner: 'Shrey', note: 'Lunch', tags: ['meal'], assigned_to: null, goal_id: null,
    })
    expect(fields).not.toHaveProperty('source')
    expect(fields).not.toHaveProperty('idempotency_key')
  })

  it('keeps a committed write successful when both optional rule and refresh fail', async () => {
    const createRule = async () => { throw new Error('rule unavailable') }
    const refresh = async () => { throw new Error('network unavailable') }
    await expect(runCommittedTransactionFollowUps({
      rule: { pattern: 'Cafe', category: 'Dining' }, createRule, refresh,
    })).resolves.toEqual([
      'The transaction was saved, but its category rule was not created.',
      'The transaction was saved, but Activity could not refresh.',
    ])
  })
})
