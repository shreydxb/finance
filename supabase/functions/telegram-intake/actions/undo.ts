// /undo — soft-delete the last bot-logged transaction in this chat
// (Taskiv #61). Never a hard DELETE: the schema is additive-only, and an
// Edge Function reachable from a public webhook that can erase rows is far
// worse to own than one that can only add. Uses the propose-then-tap
// plumbing (Taskiv #60) — a wrong deletion happening silently is worse than
// one extra tap, so nothing is touched until Remove is tapped.

import { formatAmount } from '../format.ts'
import type { PendingActionContext, PendingActionHandler } from './pending.ts'

export const UNDO_KIND = 'undo_transaction'

export interface UndoPayload {
  transactionId: string
}

export const undoHandler: PendingActionHandler = {
  async apply(payload: unknown, ctx: PendingActionContext): Promise<string> {
    const { transactionId } = payload as UndoPayload
    const row = await ctx.store.getTransaction(transactionId)
    // Already gone by the time the tap landed (deleted some other way in the
    // meantime) — nothing left to do, and not a failure to report as one.
    if (!row || row.deleted_at) return "That one's already gone."

    const updated = await ctx.store.updateTransaction(transactionId, { deleted_at: new Date().toISOString() })

    // The row may still have an open Confirm/Fix prompt from when it was
    // first logged — drop its keyboard so a deleted row can't be "confirmed".
    if (updated.telegram_prompt_msg_id && updated.telegram_chat_id) {
      await ctx.messenger.editMessageText(
        updated.telegram_chat_id,
        updated.telegram_prompt_msg_id,
        `${updated.category ?? 'Uncategorised'} · ${formatAmount(Number(updated.amount))} ${updated.currency} — removed via /undo.`
      )
    }

    return "Removed. It's gone from the app too."
  },
}
