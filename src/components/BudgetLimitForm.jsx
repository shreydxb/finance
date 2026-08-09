import { useState } from 'react'
import { BUDGET_GROUPS } from '../lib/budgets'

export default function BudgetLimitForm({ category, budget, onSave, onCancel }) {
  const [group, setGroup] = useState(budget?.group ?? 'Flexible')
  const [limit, setLimit] = useState(budget ? String(budget.monthly_limit) : '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!limit || Number.isNaN(Number(limit)) || Number(limit) < 0) {
      setError('Enter a valid monthly limit.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({ id: budget?.id, category_id: category.id, monthly_limit: Number(limit), group })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-1 text-lg font-semibold text-ink-900">
          {category.icon} {category.name}
        </h2>
        <p className="mb-4 text-sm text-ink-500">Set a monthly budget limit</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="limit" className="mb-1 block text-sm font-medium text-ink-700">
              Monthly limit (AED)
            </label>
            <input
              id="limit"
              type="number"
              step="0.01"
              autoFocus
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="0.00"
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-ink-700">Group</span>
            <div className="grid grid-cols-3 gap-2">
              {BUDGET_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium ${
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
          </div>
        </form>
      </div>
    </div>
  )
}
