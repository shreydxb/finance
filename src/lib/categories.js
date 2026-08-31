import { supabase } from './supabaseClient'

export const GROUPS = ['Needs', 'Wants', 'Savings']

export async function listCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createCategory(category) {
  const { data, error } = await supabase.from('categories').insert(category).select().single()
  if (error) throw error
  return data
}

/**
 * Presentation edits only, from migration 046 onward.
 *
 * The database refuses any change to `categories.name` for every role, because
 * category text still carries financial meaning (`transactions.category`,
 * `category_rules.category`, and 041's canonical classification all read it),
 * and SHR-157 requires a measurable zero-text-semantic-consumer gate before a
 * label may change. Group and icon edits are unaffected and still work.
 *
 * This helper is left as-is on purpose: the database is the single authority
 * on what may change, and duplicating the rule here would create a second,
 * weaker one. A rename attempt therefore fails at the database with
 * `SHR196_CATEGORY_RENAME_NOT_ENABLED`; surfacing that to the household is
 * SHR-158's Settings work, not this package's.
 */
export async function updateCategory(id, patch) {
  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

/**
 * Category hard delete is not part of the v6 contract (SHR-157 decision 4):
 * historical identity has to survive lifecycle changes, so ordinary removal
 * becomes archive, never a destructive delete. Migration 046 enforces that at
 * the database boundary for every path, including this one.
 *
 * This function is kept — the Settings screen still imports it, and SHR-158
 * owns replacing that control with archive UX — but it no longer issues the
 * destructive request. The database is the real boundary; failing here as
 * well just means the request is never sent.
 */
export async function deleteCategory() {
  throw new Error(
    'SHR196_CATEGORY_DELETE_FORBIDDEN: categories are archived, not deleted. Archive is not enabled yet.'
  )
}
