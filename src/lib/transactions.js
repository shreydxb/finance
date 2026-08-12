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

export async function createSplitTransaction(baseFields, splitLines) {
  const groupId = crypto.randomUUID()
  const rows = splitLines.map((line) => ({
    ...baseFields,
    category: line.category,
    amount: line.amount,
    source: 'manual',
    needs_review: false,
    // Declared, never inferred: these rows are lines of one purchase, which is
    // a different relationship from a transfer pair or a bulk batch (DATA-01).
    transaction_group_id: groupId,
    group_kind: 'category_split',
  }))
  const { data, error } = await supabase.from('transactions').insert(rows).select()
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

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
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
  const { error } = await supabase.from('transactions').delete().eq('transaction_group_id', groupId)
  if (error) throw error
}
