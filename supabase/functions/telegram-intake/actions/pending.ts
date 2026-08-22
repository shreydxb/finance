// Generic propose-then-confirm plumbing for sensitive Telegram writes.
// Database RPCs own identity, expiry, and state transitions; this module owns
// the Telegram orchestration and never directly PATCHes pending_actions.

import type { IntakeStore, Messenger, PendingAction } from '../../_shared/types.ts'

export type PendingActionStore = Pick<
  IntakeStore,
  | 'createPendingAction'
  | 'getPendingAction'
  | 'bindPendingActionPrompt'
  | 'claimPendingAction'
  | 'applyPendingAction'
  | 'cancelPendingAction'
  | 'expirePendingAction'
>

export interface PendingActionContext {
  store: IntakeStore
  messenger: Messenger
}

export interface PendingActionHandler {
  apply(payload: unknown, ctx: PendingActionContext): Promise<string>
}

export type PendingActionHandlers = Record<string, PendingActionHandler>

/**
 * Create one idempotent proposal and bind the Telegram prompt once. A replay
 * after binding returns the existing row without sending another button.
 */
export async function proposeAction(
  kind: string,
  payload: unknown,
  chatId: number,
  requestedBy: number,
  requestKey: string,
  summary: string,
  store: PendingActionStore,
  messenger: Messenger,
  buttonLabels: { apply?: string; cancel?: string } = {}
): Promise<PendingAction> {
  const pending = await store.createPendingAction(kind, payload, chatId, requestedBy, requestKey)
  if (pending.promptMsgId !== null) return pending

  const sent = await messenger.sendMessage(chatId, summary, {
    inlineKeyboard: [
      [
        { text: buttonLabels.apply ?? '✅ Apply', callback_data: `apply:${pending.id}` },
        { text: buttonLabels.cancel ?? '✖️ Cancel', callback_data: `cancel:${pending.id}` },
      ],
    ],
  })

  const bound = await store.bindPendingActionPrompt(pending.id, requestedBy, chatId, sent.message_id)
  if (!bound) throw new Error(`pending action ${pending.id} prompt could not be bound`)
  return bound
}

export type PendingActionOutcome =
  | { status: 'applied'; message: string }
  | { status: 'cancelled' }
  | { status: 'not_found' }
  | { status: 'already_resolved' }
  | { status: 'expired' }
  | { status: 'forbidden' }

/**
 * Handle one Apply/Cancel callback. The pre-read gives honest user feedback;
 * the service-only RPC remains authoritative and repeats every binding/state
 * predicate atomically with database time.
 */
export async function handlePendingActionCallback(
  action: 'apply' | 'cancel',
  pendingId: string,
  tapperId: number,
  chatId: number,
  promptMsgId: number,
  allowedTelegramIds: ReadonlySet<number>,
  store: PendingActionStore,
  handlers: PendingActionHandlers,
  ctx: PendingActionContext
): Promise<PendingActionOutcome> {
  const pending = await store.getPendingAction(pendingId)
  if (!pending) return { status: 'not_found' }
  if (!allowedTelegramIds.has(tapperId)) return { status: 'forbidden' }
  if (pending.requestedBy !== tapperId || pending.chatId !== chatId || pending.promptMsgId !== promptMsgId) {
    return { status: 'forbidden' }
  }
  if (pending.resolvedAt || pending.claimedAt) return { status: 'already_resolved' }

  if (action === 'cancel') {
    const cancelled = await store.cancelPendingAction(pendingId, tapperId, chatId, promptMsgId)
    if (cancelled) return { status: 'cancelled' }

    const expired = await store.expirePendingAction(pendingId, tapperId, chatId, promptMsgId)
    return expired ? { status: 'expired' } : { status: 'already_resolved' }
  }

  const claimed = await store.claimPendingAction(pendingId, tapperId, chatId, promptMsgId)
  if (!claimed) {
    const expired = await store.expirePendingAction(pendingId, tapperId, chatId, promptMsgId)
    return expired ? { status: 'expired' } : { status: 'already_resolved' }
  }

  // Missing/throwing handlers deliberately leave the row claimed/unresolved.
  // Automatic replay is unsafe because the financial write may have completed.
  const handler = handlers[claimed.kind]
  if (!handler) throw new Error(`no pending-action handler registered for kind "${claimed.kind}"`)

  const message = await handler.apply(claimed.payload, ctx)
  const applied = await store.applyPendingAction(pendingId, tapperId, chatId, promptMsgId)
  if (!applied) {
    throw new Error(`pending action ${pendingId} handler succeeded but applied finalization failed`)
  }
  return { status: 'applied', message }
}
