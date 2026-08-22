// /undo soft-deletes the latest transaction this bot logged in the current
// chat. It never hard-deletes and runs only after the guarded pending-action
// claim succeeds.

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
    if (!row || row.deleted_at) return "That one's already gone."

    const updated = await ctx.store.updateTransaction(transactionId, { deleted_at: new Date().toISOString() })

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
