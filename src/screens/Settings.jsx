import { useEffect, useState } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory, GROUPS } from '../lib/categories'
import CategoryForm from '../components/CategoryForm'

export default function Settings() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // category, or 'new'

  async function refresh() {
    setError('')
    try {
      setCategories(await listCategories())
    } catch {
      setError('Could not load categories. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSave(values) {
    if (editing && editing !== 'new') {
      await updateCategory(editing.id, values)
    } else {
      await createCategory(values)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id) {
    await deleteCategory(id)
    setEditing(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Categories</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
        >
          + Add category
        </button>
      </div>

      <div className="space-y-5">
        {GROUPS.map((group) => {
          const items = categories.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{group}</h3>
              <div className="rounded-xl border border-stone-200 bg-white">
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setEditing(c)}
                    className="flex w-full items-center gap-2 border-b border-stone-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-stone-50"
                  >
                    <span>{c.icon || '❓'}</span>
                    <span className="font-medium text-stone-900">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <CategoryForm
          category={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
