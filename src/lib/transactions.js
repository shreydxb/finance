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

  const sortColumn = filters.sort === 'amount' ? 'amount' : 'date'
  query = query.order(sortColumn, { ascending: false }).order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createTransaction(fields) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({ ...fields, source: 'manual', needs_review: false })
    .select()
    .single()
  if (error) throw error
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
  if (error) throw error
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
  const { error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw error
}

/** Undo a soft delete. */
export async function restoreTransaction(id) {
  const { error } = await supabase.from('transactions').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
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
  const { error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('transaction_group_id', groupId)
    .is('deleted_at', null)
  if (error) throw error
}
