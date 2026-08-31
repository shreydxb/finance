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
