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

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}
