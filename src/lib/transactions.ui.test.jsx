import { describe, expect, it, vi } from 'vitest'

import {
  createTransaction,
  canEditExistingActivitySplit,
  manualTransactionError,
  newManualRequestKey,
  ordinaryTransactionFields,
  replaceCategorySplit,
  runCommittedTransactionFollowUps,
  splitTransactionError,
} from './transactions'
import { supabase } from './supabaseClient'

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

  it('retains durable safe-replay guidance for an unknown ordinary manual save outcome', () => {
    const error = manualTransactionError({ message: 'network interrupted' })
    expect(error.field).toBe('general')
    expect(error.message).toMatch(/Retrying this form is safe/)
  })

  it('never claims an unknown non-idempotent split outcome is safe to retry', () => {
    const error = splitTransactionError({ message: 'network interrupted' })
    expect(error.field).toBe('general')
    expect(error.message).toBe('The split save result could not be confirmed. Check Activity before trying again.')
    expect(error.message).not.toMatch(/safe|will not create/i)
  })

  it('allows Activity split controls only for an existing split group', () => {
    expect(canEditExistingActivitySplit('new')).toBe(false)
    expect(canEditExistingActivitySplit({ id: 'single-1' })).toBe(false)
    expect(canEditExistingActivitySplit({ splitGroup: [{ id: 'line-1' }] })).toBe(true)
  })

  it('refuses a fresh split before the non-idempotent RPC can be called', async () => {
    await expect(replaceCategorySplit({}, [], {})).rejects.toMatchObject({
      field: 'general',
      message: 'New split entry is temporarily unavailable. Save one category for now.',
    })
  })

  it('keeps unknown split RPC failures truthful while ordinary keyed retry remains safe', async () => {
    const rpc = vi.spyOn(supabase, 'rpc')
      .mockResolvedValueOnce({ data: null, error: { message: 'network interrupted' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'network interrupted' } })
    const fields = {
      date: '2026-08-28', amount: 12.34, currency: 'AED', account_id: 'account-1', category: 'Dining',
      owner: 'Shrey', note: 'Cafe', tags: [], assigned_to: null, goal_id: null,
    }

    await expect(replaceCategorySplit(fields, [{ category: 'Dining', amount: 12.34 }], { groupId: 'split-group-1' }))
      .rejects.toMatchObject({ message: 'The split save result could not be confirmed. Check Activity before trying again.' })
    await expect(createTransaction(fields, 'manual:6ec90a20-6d45-4fb1-8991-92e89ccfa6a6'))
      .rejects.toMatchObject({ message: expect.stringMatching(/Retrying this form is safe/) })

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_group_id: 'split-group-1', p_transaction_id: null })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_request_key: 'manual:6ec90a20-6d45-4fb1-8991-92e89ccfa6a6' })
    rpc.mockRestore()
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
