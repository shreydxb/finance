// Generic propose-then-tap write plumbing (Taskiv #60).
//
// Transactions are write-then-flag: a spend not written is a spend lost
// forever, nobody remembers the coffee. That justification does not
// transfer to any other write — nobody forgets moving 2,000 AED into a
// goal, and an unwanted accounts.value overwrite corrupts nw_daily
// permanently, which is never backfilled. So every other bot write
// proposes first: nothing hits the database until a household member taps
// Apply.
//
// This file owns propose / expire / idempotent-resolve / allowlist only.
// The actual write for a given `kind` is not this file's job — no kind is
// implemented yet (see 037_pending_actions.sql's header); each future
// action (goal contribution, balance update, income log, category rule —
// Taskiv #63-67) registers its own handler in a PendingActionHandlers map
// and calls proposeAction to create the proposal.

import type { IntakeStore, Messenger, PendingAction } from '../../_shared/types.ts'

// Narrowed to exactly what this module needs, the same way query/types.ts's
// QueryStore is kept separate from IntakeStore — a test fake here only has
// to implement four methods, not the whole intake pipeline's storage surface.
export type PendingActionStore = Pick<
  IntakeStore,
  'createPendingAction' | 'getPendingAction' | 'setPendingActionPromptMsgId' | 'resolvePendingAction'
>

/**
 * Everything a handler's `apply()` gets beyond the payload — the full
 * storage surface and the messenger, so a handler can do more than a single
 * table write (e.g. /undo's handler also edits the original Confirm/Fix
 * prompt on the row it just removed). Deliberately NOT the narrower
 * `PendingActionStore` above: that one is scoped to this file's own
 * plumbing, this one is scoped to what a real handler needs to do its job.
 */
export interface PendingActionContext {
  store: IntakeStore
  messenger: Messenger
}

/** One `kind`'s actual write, run only after a tap has already been claimed. Returns the household-facing confirmation text — never a generic default, so each kind states plainly what just happened. */
export interface PendingActionHandler {
  apply(payload: unknown, ctx: PendingActionContext): Promise<string>
}

export type PendingActionHandlers = Record<string, PendingActionHandler>

/**
 * Insert the proposal and send the Apply/Cancel prompt. Nothing outside
 * `pending_actions` exists yet — the actual write happens only when
 * `handlePendingActionCallback` later resolves this row as applied.
 */
export async function proposeAction(
  kind: string,
  payload: unknown,
  chatId: number,
  requestedBy: number,
  summary: string,
  store: PendingActionStore,
  messenger: Messenger,
  buttonLabels: { apply?: string; cancel?: string } = {}
): Promise<PendingAction> {
  const pending = await store.createPendingAction(kind, payload, chatId, requestedBy)
  const sent = await messenger.sendMessage(chatId, summary, {
    inlineKeyboard: [
      [
        { text: buttonLabels.apply ?? '✅ Apply', callback_data: `apply:${pending.id}` },
        { text: buttonLabels.cancel ?? '✖️ Cancel', callback_data: `cancel:${pending.id}` },
      ],
    ],
  })
  await store.setPendingActionPromptMsgId(pending.id, sent.message_id)
  return pending
}

export type PendingActionOutcome =
  | { status: 'applied'; message: string }
  | { status: 'cancelled' }
  | { status: 'not_found' }
  | { status: 'already_resolved' }
  | { status: 'expired' }
  | { status: 'forbidden' }

/**
 * Resolves one Apply/Cancel tap. Every rejection reason from the task is
 * checked before any write: not found, already resolved (the idempotency
 * guard against Telegram redelivering the same callback), expired, or the
 * tapper isn't in the household allowlist — reused verbatim from the check
 * `handleCallback` already performs for confirm/fix/cashback, kept here too
 * so this module is independently correct and testable without relying on
 * the caller to have done it first.
 */
export async function handlePendingActionCallback(
  action: 'apply' | 'cancel',
  pendingId: string,
  tapperId: number,
  allowedTelegramIds: ReadonlySet<number>,
  store: PendingActionStore,
  handlers: PendingActionHandlers,
  ctx: PendingActionContext,
  now: () => Date = () => new Date()
): Promise<PendingActionOutcome> {
  const pending = await store.getPendingAction(pendingId)
  if (!pending) return { status: 'not_found' }
  if (!allowedTelegramIds.has(tapperId)) return { status: 'forbidden' }
  if (pending.resolvedAt) return { status: 'already_resolved' }

  if (now() > new Date(pending.expiresAt)) {
    // Best-effort: if this loses a race to another resolve, the outcome the
    // household sees ("already handled" vs "expired") differs but nothing
    // is ever written twice either way.
    await store.resolvePendingAction(pendingId, 'expired')
    return { status: 'expired' }
  }

  if (action === 'cancel') {
    const resolved = await store.resolvePendingAction(pendingId, 'cancelled')
    return resolved ? { status: 'cancelled' } : { status: 'already_resolved' }
  }

  // Claim before writing, not after: a redelivered callback that races this
  // one finds nothing left to claim and never reaches handler.apply at all.
  const claimed = await store.resolvePendingAction(pendingId, 'applied')
  if (!claimed) return { status: 'already_resolved' }

  const handler = handlers[pending.kind]
  if (!handler) {
    // The proposal is already claimed at this point — never left stuck
    // "resolved but nothing happened" is still a real failure, but it must
    // surface loudly (a thrown error the caller logs), not as a silent
    // no-op the household mistakes for success.
    throw new Error(`no pending-action handler registered for kind "${pending.kind}"`)
  }
  const message = await handler.apply(claimed.payload, ctx)
  return { status: 'applied', message }
}
