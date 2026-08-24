import { useState } from 'react'
import { GROUPS } from '../lib/categories'
import ProtectedForm from './ProtectedForm'

export default function CategoryForm({ category, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(category?.name ?? '')
  const [group, setGroup] = useState(category?.group ?? GROUPS[0])
  const [icon, setIcon] = useState(category?.icon ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({ name: name.trim(), group, icon: icon.trim() || null })
    } catch {
      setError('Could not save. Try again — category names must be unique.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">
          {category ? 'Edit category' : 'Add category'}
        </h2>
        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label htmlFor="cat-name" className="mb-1 block text-sm font-medium text-ink-700">
                Name
              </label>
              <input
                id="cat-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
            <div>
              <label htmlFor="cat-icon" className="mb-1 block text-sm font-medium text-ink-700">
                Icon
              </label>
              <input
                id="cat-icon"
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-center text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="❓"
              />
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-ink-700">Group</span>
            <div className="grid grid-cols-3 gap-2">
              {GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                    group === g ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-neg-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Cancel
            </button>
            {category && (
              <button
                type="button"
                onClick={() => onDelete(category.id)}
                className="rounded-lg border border-neg-200 px-3 py-2 text-sm font-medium text-neg-600 hover:bg-neg-50"
              >
                Delete
              </button>
            )}
          </div>
        </ProtectedForm>
      </div>
    </div>
  )
}
