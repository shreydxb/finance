import { useState } from 'react'
import { ASSET_TYPES, LIABILITY_TYPES, OWNERS, CURRENCIES } from '../lib/accounts'
import { Button } from '../design-system'
import ProtectedForm from './ProtectedForm'

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
  interest_rate: '',
  credit_limit: '',
  statement_day: '',
  due_day: '',
}

export default function AccountForm({ account, embedded = false, onSave, onCancel, onDelete }) {
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
          interest_rate: account.interest_rate != null ? String(account.interest_rate) : '',
          credit_limit: account.credit_limit != null ? String(account.credit_limit) : '',
          statement_day: account.statement_day != null ? String(account.statement_day) : '',
          due_day: account.due_day != null ? String(account.due_day) : '',
        }
      : EMPTY
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const typeOptions = form.kind === 'asset' ? ASSET_TYPES : LIABILITY_TYPES
  const isCard = form.type === 'credit_card'

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
    // Checked here as well as in the database (035_statement_cycle) so a typo
    // reads as a sentence rather than as a raw constraint violation.
    if (isCard) {
      if (form.credit_limit !== '' && !(Number(form.credit_limit) > 0)) {
        setError('Credit limit must be greater than zero, or left blank if you don’t know it.')
        return
      }
      for (const [key, label] of [
        ['statement_day', 'Statement day'],
        ['due_day', 'Payment due day'],
      ]) {
        const raw = form[key]
        if (raw === '') continue
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1 || n > 31) {
          setError(`${label} must be a day of the month between 1 and 31.`)
          return
        }
      }
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
        interest_rate: form.type === 'fixed_deposit' && form.interest_rate !== '' ? Number(form.interest_rate) : null,
        credit_limit: isCard && form.credit_limit !== '' ? Number(form.credit_limit) : null,
        statement_day: isCard && form.statement_day !== '' ? Number(form.statement_day) : null,
        due_day: isCard && form.due_day !== '' ? Number(form.due_day) : null,
      })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <>
        {!embedded && <h2 className="mb-4 text-lg font-semibold text-ink-900">
          {account ? 'Edit account' : 'Add account'}
        </h2>}

        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-ink-700">Asset or liability?</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

          {isCard && (
            <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3">
              <p className="mb-2 text-sm font-medium text-ink-700">Card details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="credit_limit" className="mb-1 block text-xs font-medium text-ink-600">
                    Credit limit
                  </label>
                  <input
                    id="credit_limit"
                    type="number"
                    step="any"
                    min="0"
                    value={form.credit_limit}
                    onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                    placeholder="optional"
                  />
                </div>
                <div>
                  <label htmlFor="statement_day" className="mb-1 block text-xs font-medium text-ink-600">
                    Closes on
                  </label>
                  <input
                    id="statement_day"
                    type="number"
                    step="1"
                    min="1"
                    max="31"
                    value={form.statement_day}
                    onChange={(e) => setForm((f) => ({ ...f, statement_day: e.target.value }))}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                    placeholder="e.g. 17"
                  />
                </div>
                <div>
                  <label htmlFor="due_day" className="mb-1 block text-xs font-medium text-ink-600">
                    Due on
                  </label>
                  <input
                    id="due_day"
                    type="number"
                    step="1"
                    min="1"
                    max="31"
                    value={form.due_day}
                    onChange={(e) => setForm((f) => ({ ...f, due_day: e.target.value }))}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                    placeholder="e.g. 5"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                Days of the month, from your card statement or bank app — not a date. Leave blank if you don’t know
                them; the card still shows, just without a cycle.
              </p>
            </div>
          )}

          {form.type === 'fixed_deposit' && (
            <div>
              <label htmlFor="interest_rate" className="mb-1 block text-sm font-medium text-ink-700">
                Annual interest rate (%)
              </label>
              <input
                id="interest_rate"
                type="number"
                step="any"
                value={form.interest_rate}
                onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="e.g. 7.5"
              />
              <p className="mt-1 text-xs text-ink-400">
                Used only to project a goal's time-to-target — the value above still comes from your bank statement, never
                computed automatically.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-neg-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={submitting}
              loading={submitting}
              className="flex-1"
            >
              {submitting ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              onClick={onCancel}
              intent="secondary"
            >
              Cancel
            </Button>
            {account && (
              <Button
                type="button"
                onClick={() => onDelete(account.id)}
                intent="danger"
              >
                Delete
              </Button>
            )}
          </div>
        </ProtectedForm>
    </>
  )

  if (embedded) return content

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        {content}
      </div>
    </div>
  )
}
