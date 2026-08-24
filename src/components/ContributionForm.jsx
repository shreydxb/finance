import { useState } from 'react'
import { todayLocal } from '../lib/dates'
import ProtectedForm from './ProtectedForm'

function today() {
  return todayLocal()
}

export default function ContributionForm({ accounts = [], onSave, onCancel }) {
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [fromAccountId, setFromAccountId] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Enter a valid amount.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({ date, amount: Number(amount), note: note.trim() || null, fromAccountId: fromAccountId || null })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">Log a contribution</h2>
        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="c-amount" className="mb-1 block text-sm font-medium text-ink-700">
              Amount (AED)
            </label>
            <input
              id="c-amount"
              type="number"
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="0.00"
            />
          </div>
          <div>
            <label htmlFor="c-date" className="mb-1 block text-sm font-medium text-ink-700">
              Date
            </label>
            <input
              id="c-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>
          {accounts.length > 0 && (
            <div>
              <label htmlFor="c-from" className="mb-1 block text-sm font-medium text-ink-700">
                Paid from (optional)
              </label>
              <select
                id="c-from"
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="">— just log it, no transaction —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-400">
                Picking an account also logs this as a Transfer transaction, so it shows up in Transactions and Budget.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="c-note" className="mb-1 block text-sm font-medium text-ink-700">
              Note
            </label>
            <input
              id="c-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="optional"
            />
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
        </ProtectedForm>
      </div>
    </div>
  )
}
