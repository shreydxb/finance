import { useEffect, useState } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory, GROUPS } from '../lib/categories'
import { listAccounts, updateAccount } from '../lib/accounts'
import { getSetting, upsertSetting } from '../lib/settings'
import CategoryForm from '../components/CategoryForm'

const BUCKETS = [
  { value: '', label: 'Unassigned' },
  { value: 'joint', label: 'Joint' },
  { value: 'emergency_house', label: 'Emergency + House' },
  { value: 'shrey_personal', label: 'Shrey Personal' },
  { value: 'wife_personal', label: 'Tarika Personal' },
]

export default function Settings() {
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [split, setSplit] = useState({ shrey: 0.69, tarika: 0.31 })
  const [splitDraft, setSplitDraft] = useState({ shrey: '69', tarika: '31' })
  const [savingSplit, setSavingSplit] = useState(false)
  const [splitError, setSplitError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // category, or 'new'

  async function refresh() {
    setError('')
    try {
      const [cats, accts, splitSetting] = await Promise.all([listCategories(), listAccounts(), getSetting('income_split')])
      setCategories(cats)
      setAccounts(accts)
      if (splitSetting) {
        setSplit(splitSetting)
        setSplitDraft({
          shrey: String(Math.round(splitSetting.shrey * 100)),
          tarika: String(Math.round(splitSetting.tarika * 100)),
        })
      }
    } catch {
      setError('Could not load settings. Check your connection and try again.')
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

  async function handleSaveSplit(e) {
    e.preventDefault()
    setSplitError('')
    const shrey = Number(splitDraft.shrey)
    const tarika = Number(splitDraft.tarika)
    if (Number.isNaN(shrey) || Number.isNaN(tarika) || shrey < 0 || tarika < 0) {
      setSplitError('Enter valid percentages.')
      return
    }
    if (Math.round(shrey + tarika) !== 100) {
      setSplitError('Shrey + Tarika must add up to 100%.')
      return
    }
    setSavingSplit(true)
    try {
      const value = { shrey: shrey / 100, tarika: tarika / 100 }
      await upsertSetting('income_split', value)
      setSplit(value)
    } catch {
      setSplitError('Could not save. Try again.')
    } finally {
      setSavingSplit(false)
    }
  }

  async function handleBucketChange(accountId, bucket) {
    await updateAccount(accountId, { bucket: bucket || null })
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

      <div className="mb-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold text-stone-900">Household split</h2>
        <p className="mb-4 text-sm text-stone-500">
          Target contribution ratio, used by Cash Flow's person breakdown. Currently {Math.round(split.shrey * 100)}/
          {Math.round(split.tarika * 100)}.
        </p>
        <form onSubmit={handleSaveSplit} className="flex items-end gap-3">
          <div>
            <label htmlFor="shrey-split" className="mb-1 block text-xs font-medium text-stone-700">
              Shrey %
            </label>
            <input
              id="shrey-split"
              type="number"
              value={splitDraft.shrey}
              onChange={(e) => setSplitDraft((s) => ({ ...s, shrey: e.target.value }))}
              className="w-20 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="tarika-split" className="mb-1 block text-xs font-medium text-stone-700">
              Tarika %
            </label>
            <input
              id="tarika-split"
              type="number"
              value={splitDraft.tarika}
              onChange={(e) => setSplitDraft((s) => ({ ...s, tarika: e.target.value }))}
              className="w-20 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={savingSplit}
            className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {savingSplit ? 'Saving…' : 'Save'}
          </button>
        </form>
        {splitError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {splitError}
          </p>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold text-stone-900">Four-account structure</h2>
        <p className="mb-4 text-sm text-stone-500">
          Label which bucket each account belongs to. Descriptive only — no money moves automatically.
        </p>
        {accounts.length === 0 ? (
          <p className="text-sm text-stone-500">No accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-stone-900">{a.name}</span>
                <select
                  value={a.bucket ?? ''}
                  onChange={(e) => handleBucketChange(a.id, e.target.value)}
                  className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                >
                  {BUCKETS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

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
