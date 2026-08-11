import { useState } from 'react'
import { ASSET_TYPES, LIABILITY_TYPES, OWNERS, CURRENCIES } from '../lib/accounts'

const EMPTY = {
  name: '',
  owner: OWNERS[0],
  kind: 'asset',
  type: ASSET_TYPES[0].value,
  currency: 'AED',
  value: '',
  ticker: '',
  quantity: '',
  avg_cost: '',
}

export default function AccountForm({ account, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(() =>
    account
      ? {
          name: account.name,
          owner: account.owner,
          kind: account.is_liability ? 'liability' : 'asset',
          type: account.type,
          currency: account.currency,
          value: String(account.value ?? ''),
          ticker: account.ticker ?? '',
          quantity: account.quantity != null ? String(account.quantity) : '',
          avg_cost: account.avg_cost != null ? String(account.avg_cost) : '',
        }
      : EMPTY
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const typeOptions = form.kind === 'asset' ? ASSET_TYPES : LIABILITY_TYPES

  function setKind(kind) {
    const options = kind === 'asset' ? ASSET_TYPES : LIABILITY_TYPES
    setForm((f) => ({ ...f, kind, type: options[0].value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (form.value === '' || Number.isNaN(Number(form.value))) {
      setError('Enter a valid value.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({
        name: form.name.trim(),
        owner: form.owner,
        type: form.type,
        is_liability: form.kind === 'liability',
        currency: form.currency,
        value: Number(form.value),
        ticker: form.type === 'investment' && form.ticker ? form.ticker.trim() : null,
        quantity: form.type === 'investment' && form.quantity !== '' ? Number(form.quantity) : null,
        avg_cost: form.type === 'investment' && form.avg_cost !== '' ? Number(form.avg_cost) : null,
      })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">
          {account ? 'Edit account' : 'Add account'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-ink-700">Asset or liability?</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('asset')}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  form.kind === 'asset'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                }`}
              >
                Asset
              </button>
              <button
                type="button"
                onClick={() => setKind('liability')}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  form.kind === 'liability'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                }`}
              >
                Liability
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="type" className="mb-1 block text-sm font-medium text-ink-700">
              Type
            </label>
            <select
              id="type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-ink-700">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="e.g. Zerodha, Car Loan"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="owner" className="mb-1 block text-sm font-medium text-ink-700">
                Owner
              </label>
              <select
                id="owner"
                value={form.owner}
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="currency" className="mb-1 block text-sm font-medium text-ink-700">
                Currency
              </label>
              <select
                id="currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="value" className="mb-1 block text-sm font-medium text-ink-700">
              {form.kind === 'liability' ? 'Amount owed' : 'Value'}
            </label>
            <input
              id="value"
              type="number"
              step="0.01"
              required
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="0.00"
            />
          </div>

          {form.type === 'investment' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="ticker" className="mb-1 block text-sm font-medium text-ink-700">
                  Ticker
                </label>
                <input
                  id="ticker"
                  type="text"
                  value={form.ticker}
                  onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  placeholder="optional"
                />
              </div>
              <div>
                <label htmlFor="quantity" className="mb-1 block text-sm font-medium text-ink-700">
                  Qty
                </label>
                <input
                  id="quantity"
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  placeholder="optional"
                />
              </div>
              <div>
                <label htmlFor="avg_cost" className="mb-1 block text-sm font-medium text-ink-700">
                  Avg cost
                </label>
                <input
                  id="avg_cost"
                  type="number"
                  step="any"
                  value={form.avg_cost}
                  onChange={(e) => setForm((f) => ({ ...f, avg_cost: e.target.value }))}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  placeholder="optional"
                />
              </div>
            </div>
          )}

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
            {account && (
              <button
                type="button"
                onClick={() => onDelete(account.id)}
                className="rounded-lg border border-neg-200 px-3 py-2 text-sm font-medium text-neg-600 hover:bg-neg-50"
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
