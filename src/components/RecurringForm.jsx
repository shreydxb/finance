import { useState } from 'react'
import { RECURRING_KINDS, MONTH_NAMES } from '../lib/recurring'
import { OWNERS } from '../lib/accounts'

export default function RecurringForm({ entry, accounts, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(entry?.name ?? '')
  const [kind, setKind] = useState(entry?.kind ?? 'expense')
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [currency, setCurrency] = useState(entry?.currency ?? 'AED')
  const [owner, setOwner] = useState(entry?.owner ?? OWNERS[0])
  const [dayOfMonth, setDayOfMonth] = useState(entry?.day_of_month ? String(entry.day_of_month) : '')
  const [months, setMonths] = useState(entry?.months ?? [])
  const [linkedAccountId, setLinkedAccountId] = useState(entry?.linked_account_id ?? '')
  const [autopay, setAutopay] = useState(entry?.autopay ?? false)
  const [endDate, setEndDate] = useState(entry?.end_date ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function toggleMonth(m) {
    setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (amount === '' || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (dayOfMonth && (Number(dayOfMonth) < 1 || Number(dayOfMonth) > 31)) {
      setError('Day of month must be between 1 and 31.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({
        name: name.trim(),
        kind,
        amount: Number(amount),
        currency,
        owner,
        day_of_month: dayOfMonth ? Number(dayOfMonth) : null,
        months,
        linked_account_id: linkedAccountId || null,
        autopay,
        end_date: endDate || null,
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
        <h2 className="mb-4 text-lg font-semibold text-ink-900">{entry ? 'Edit recurring' : 'Add recurring'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="r-name" className="mb-1 block text-sm font-medium text-ink-700">
              Name
            </label>
            <input
              id="r-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="e.g. Car Loan EMI"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="r-kind" className="mb-1 block text-sm font-medium text-ink-700">
                Kind
              </label>
              <select
                id="r-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {RECURRING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="r-owner" className="mb-1 block text-sm font-medium text-ink-700">
                Owner
              </label>
              <select
                id="r-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label htmlFor="r-amount" className="mb-1 block text-sm font-medium text-ink-700">
                Amount
              </label>
              <input
                id="r-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="r-currency" className="mb-1 block text-sm font-medium text-ink-700">
                Currency
              </label>
              <select
                id="r-currency"
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

          <div>
            <label htmlFor="r-day" className="mb-1 block text-sm font-medium text-ink-700">
              Day of month
            </label>
            <input
              id="r-day"
              type="number"
              min="1"
              max="31"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              className="w-24 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="e.g. 6"
            />
            <p className="mt-1 text-xs text-ink-400">Leave blank if you don't know the exact day yet.</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-ink-700">Months</span>
            <div className="grid grid-cols-6 gap-1.5">
              {MONTH_NAMES.map((label, i) => {
                const m = i + 1
                const active = months.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMonth(m)}
                    className={`rounded-lg border px-1 py-1.5 text-xs font-medium ${
                      active ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-ink-400">Leave all unselected for "every month".</p>
          </div>

          <div>
            <label htmlFor="r-linked" className="mb-1 block text-sm font-medium text-ink-700">
              Linked account
            </label>
            <select
              id="r-linked"
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="r-end" className="mb-1 block text-sm font-medium text-ink-700">
              Ends after (optional)
            </label>
            <input
              id="r-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
            Autopay
          </label>

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
            {entry && (
              <button
                type="button"
                onClick={onDelete}
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
