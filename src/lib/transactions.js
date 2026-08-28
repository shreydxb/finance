import { supabase } from './supabaseClient'

export async function listTransactions(filters = {}) {
  let query = supabase.from('transactions').select('*').is('deleted_at', null)

  if (filters.category) query = query.eq('category', filters.category)
  if (filters.owner) query = query.eq('owner', filters.owner)
  if (filters.accountId) query = query.eq('account_id', filters.accountId)
  if (filters.dateFrom) query = query.gte('date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('date', filters.dateTo)
  if (filters.search) query = query.ilike('note', `%${filters.search}%`)
  if (filters.needsReview) query = query.eq('needs_review', true)
  if (filters.unreviewed) query = query.is('reviewed_at', null)
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters.goalId) query = query.eq('goal_id', filters.goalId)

  const sortColumn = filters.sort === 'amount' ? 'amount' : 'date'
  query = query.order(sortColumn, { ascending: false }).order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) throw error
  return data
}

const MANUAL_ERROR_MESSAGES = {
  SHR126_REQUEST_KEY_INVALID: ['general', 'This save request is invalid. Close the form and try again.'],
  SHR126_REQUEST_ALREADY_DELETED: ['general', 'This transaction was already saved and then deleted. Restore it instead of retrying.'],
  SHR126_REQUEST_KEY_CONFLICT: ['general', 'This save request was already used with different details. Close the form and try again.'],
  SHR126_DATE_REQUIRED: ['date', 'Choose a transaction date.'],
  SHR126_DATE_FUTURE: ['date', 'Transaction date cannot be after today in Dubai.'],
  SHR126_DATE_INVALID: ['date', 'Choose a valid transaction date.'],
  SHR126_AMOUNT_INVALID: ['amount', 'Enter a positive amount with no more than two decimal places.'],
  SHR126_CURRENCY_INVALID: ['currency', 'Choose a supported currency.'],
  SHR126_ACCOUNT_REQUIRED: ['account', 'Choose an account.'],
  SHR126_ACCOUNT_INVALID: ['account', 'That account is no longer available. Choose a current account.'],
  SHR126_CATEGORY_REQUIRED: ['category', 'Choose a category.'],
  SHR126_CATEGORY_INVALID: ['category', 'That category is no longer available. Choose a current category.'],
  SHR126_OWNER_INVALID: ['owner', 'Choose a valid owner.'],
  SHR126_ASSIGNEE_INVALID: ['assignedTo', 'Choose a valid person to review this transaction.'],
  SHR126_GOAL_INVALID: ['linkedGoal', 'That goal is no longer available. Choose another goal or no goal.'],
  SHR126_TRANSACTION_NOT_FOUND: ['general', 'This transaction no longer exists. Refresh Activity.'],
  SHR126_TRANSACTION_DELETED: ['general', 'This transaction was deleted and cannot be edited. Restore it first.'],
  SHR126_GROUPED_CORRECTION_UNSUPPORTED: ['general', 'Grouped and split transactions must be corrected from their group editor.'],
  SHR126_TRANSFER_UNSUPPORTED: ['category', 'Transfers cannot be created or corrected as expenses. Transfer entry is temporarily unavailable here.'],
  SHR126_SPLIT_LINES_REQUIRED: ['general', 'Add at least one split line.'],
  SHR126_SPLIT_REPLACEMENT_INVALID: ['general', 'This split replacement is invalid. Refresh Activity and try again.'],
  SHR126_SPLIT_BASE_INVALID: ['general', 'Check the split date and account.'],
  SHR126_SPLIT_NOT_FOUND: ['general', 'This split no longer exists. Refresh Activity.'],
  SHR126_SPLIT_SOURCE_INVALID: ['general', 'This transaction cannot be converted to a split. Refresh Activity.'],
}

function manualRpcArgs(transactionId, requestKey, fields) {
  return {
    p_transaction_id: transactionId ?? null,
    p_request_key: requestKey ?? null,
    p_date: fields.date,
    p_amount: fields.amount,
    p_currency: fields.currency ?? 'AED',
    p_account_id: fields.account_id ?? null,
    p_category: fields.category ?? null,
    p_owner: fields.owner ?? null,
    p_note: fields.note ?? null,
    p_tags: fields.tags ?? [],
    p_assigned_to: fields.assigned_to ?? null,
    p_goal_id: fields.goal_id ?? null,
  }
}

export function ordinaryTransactionFields(transaction, patch = {}) {
  return {
    date: transaction.date,
    amount: transaction.amount,
    currency: transaction.currency,
    account_id: transaction.account_id,
    category: transaction.category,
    owner: transaction.owner,
    note: transaction.note,
    tags: transaction.tags ?? [],
    assigned_to: transaction.assigned_to ?? null,
    goal_id: transaction.goal_id ?? null,
    ...patch,
  }
}

export async function runCommittedTransactionFollowUps({ rule, createRule, refresh }) {
  const warnings = []
  if (rule && createRule) {
    try {
      await createRule(rule.pattern, rule.category)
    } catch {
      warnings.push('The transaction was saved, but its category rule was not created.')
    }
  }
  try {
    const refreshed = await refresh()
    if (refreshed === false) throw new Error('refresh failed')
  } catch {
    warnings.push('The transaction was saved, but Activity could not refresh.')
  }
  return warnings
}

export function newManualRequestKey() {
  return `manual:${crypto.randomUUID()}`
}

export function manualTransactionError(error) {
  const match = Object.entries(MANUAL_ERROR_MESSAGES).find(([code]) =>
    error?.message?.includes(code) || error?.details?.includes(code)
  )
  const [field, message] = match?.[1] ?? [
    'general',
    'The save result could not be confirmed. Retrying this form is safe and will not create a second transaction.',
  ]
  const translated = new Error(message)
  translated.field = field
  translated.cause = error
  return translated
}

export async function createTransaction(fields, requestKey) {
  const { data, error } = await supabase.rpc('save_manual_transaction', manualRpcArgs(null, requestKey, fields))
  if (error) throw manualTransactionError(error)
  return data
}

export async function correctTransaction(id, fields) {
  const { data, error } = await supabase.rpc('save_manual_transaction', manualRpcArgs(id, null, fields))
  if (error) throw manualTransactionError(error)
  return data
}

/**
 * Create, or atomically replace, a set of category-split lines.
 *
 * Goes through a Postgres function rather than a delete followed by an insert
 * (DATA-02). The old sequence removed the original rows first, so a dropped
 * connection between the two calls destroyed the transaction outright and left
 * nothing in its place. Inside the function both steps share one transaction:
 * either the replacement exists or the original still does.
 *
 * @param replaces  { groupId } to replace a whole split, { transactionId } to
 *                  convert a single row into one, or nothing to create anew.
 */
export async function replaceCategorySplit(baseFields, splitLines, replaces = {}) {
  const { data, error } = await supabase.rpc('replace_category_split', {
    p_group_id: replaces.groupId ?? null,
    p_transaction_id: replaces.transactionId ?? null,
    p_base: {
      date: baseFields.date,
      currency: baseFields.currency ?? 'AED',
      account_id: baseFields.account_id ?? null,
      owner: baseFields.owner ?? null,
      note: baseFields.note ?? null,
      tags: baseFields.tags ?? [],
    },
    p_lines: splitLines.map((line) => ({ category: line.category, amount: line.amount })),
  })
  if (error) throw manualTransactionError(error)
  return data
}

export async function countNeedsReview() {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('needs_review', true)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

/** The in-app safety net for anything the Telegram Confirm/Fix prompt missed. */
export async function markReviewed(id) {
  return updateTransaction(id, { needs_review: false })
}

export async function countUnreviewed() {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .is('reviewed_at', null)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

/** Weekend-reconciliation review — independent of the AI-confidence `needs_review` flag. */
export async function setReviewed(id, reviewed) {
  return updateTransaction(id, { reviewed_at: reviewed ? new Date().toISOString() : null })
}

/** Same as setReviewed, for a split group's lines or a bulk-selected batch in one round trip. */
export async function setReviewedMany(ids, reviewed) {
  const { error } = await supabase
    .from('transactions')
    .update({ reviewed_at: reviewed ? new Date().toISOString() : null })
    .in('id', ids)
  if (error) throw error
}

/**
 * "Can you check this one?" — flags a transaction for the *other* partner,
 * independent of `reviewed_at` (which is the weekend-reconciliation pass, not
 * a request aimed at a specific person). `person` is null to clear the flag.
 */
export async function assignForReview(id, person) {
  return updateTransaction(id, { assigned_to: person })
}

/**
 * Tags a transaction as related to a goal — display only, never a
 * contribution. A goal's actual progress still only moves via
 * goal_contributions (see src/lib/goals.js's createContributionWithTransfer);
 * this just lets "that Ikea run" show up next to the New Sofa goal.
 */
export async function linkToGoal(id, goalId) {
  return updateTransaction(id, { goal_id: goalId })
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

/**
 * Remove a transaction.
 *
 * Soft delete, not a real one (DATA-04). `deleted_at` was added in 015 for the
 * bot's `/undo` and every read here already filters on it, but the UI still
 * issued a hard DELETE — so a mis-tap in the app was unrecoverable while the
 * same mistake made from Telegram was not. Now they behave the same way, and
 * the row survives as an audit trail.
 */
export async function deleteTransaction(id) {
  const { data, error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** Undo a soft delete. */
export async function restoreTransaction(id) {
  const { data, error } = await supabase.from('transactions').update({ deleted_at: null }).eq('id', id).select('id').single()
  if (error) throw error
  return data
}

export async function restoreTransactions(ids) {
  const { data, error } = await supabase.from('transactions').update({ deleted_at: null }).in('id', ids).select('id')
  if (error) throw error
  return data
}

/**
 * Delete every row of one group.
 *
 * Only ever called for a category split, whose lines are meaningless apart.
 * Transfers and bulk batches must not be routed here: a bulk batch's rows are
 * independent spends that merely arrived together, and deleting the batch
 * because one row was selected destroys the others.
 */
export async function deleteTransactionGroup(groupId) {
  const { data, error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('transaction_group_id', groupId)
    .is('deleted_at', null)
    .select('id')
  if (error) throw error
  return data
}
