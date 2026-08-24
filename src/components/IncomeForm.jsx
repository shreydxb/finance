import { useState } from 'react'
import { INCOME_KINDS } from '../lib/income'
import { todayLocal } from '../lib/dates'
import ProtectedForm from './ProtectedForm'

const PEOPLE = ['Shrey', 'Tarika']

function today() {
  return todayLocal()
}

export default function IncomeForm({ income, onSave, onCancel, onDelete }) {
  const [person, setPerson] = useState(income?.person ?? PEOPLE[0])
  const [source, setSource] = useState(income?.source ?? '')
  const [kind, setKind] = useState(income?.kind ?? 'salary')
  const [amount, setAmount] = useState(income ? String(income.amount) : '')
  const [currency, setCurrency] = useState(income?.currency ?? 'AED')
  const [date, setDate] = useState(income?.date ?? today())
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (amount === '' || Number.isNaN(Number(amount))) {
      setError('Enter a valid amount.')
      return
    }
    if (kind !== 'trading_pnl' && Number(amount) <= 0) {
      setError('Amount must be greater than 0 (only trading P&L can be negative, for realized losses).')
      return
    }
    setSubmitting(true)
    try {
      await onSave({ person, source: source.trim() || null, kind, amount: Number(amount), currency, date })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">{income ? 'Edit income' : 'Add income'}</h2>
        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="person" className="mb-1 block text-sm font-medium text-ink-700">
                Person
              </label>
              <select
                id="person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {PEOPLE.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="kind" className="mb-1 block text-sm font-medium text-ink-700">
                Kind
              </label>
              <select
                id="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {INCOME_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="source" className="mb-1 block text-sm font-medium text-ink-700">
              Source
            </label>
            <input
              id="source"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="optional, e.g. employer name"
            />
          </div>

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label htmlFor="amount" className="mb-1 block text-sm font-medium text-ink-700">
                Amount
              </label>
              <input
                id="amount"
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
              <label htmlFor="currency" className="mb-1 block text-sm font-medium text-ink-700">
                Currency
              </label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {['AED', 'USD', 'INR'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {kind === 'trading_pnl' && (
            <p className="text-xs text-ink-400">
              Only log this when a position is actually closed — not for unrealized gains/losses. Negative amounts are allowed for realized losses.
            </p>
          )}

          <div>
            <label htmlFor="date" className="mb-1 block text-sm font-medium text-ink-700">
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
            {income && (
              <button
                type="button"
                onClick={onDelete}
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
