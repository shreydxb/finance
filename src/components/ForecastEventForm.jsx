import { useState } from 'react'
import { EVENT_KINDS } from '../lib/forecastEvents'
import { todayLocal } from '../lib/dates'
import ProtectedForm from './ProtectedForm'

/** Add/edit one forecast_events row — the click-to-edit alternative to a draggable pin, see ForecastChart's comment. */
export default function ForecastEventForm({ event, onSave, onCancel, onDelete }) {
  const isEdit = Boolean(event?.id)
  const [kind, setKind] = useState(event?.kind ?? 'custom')
  const [label, setLabel] = useState(event?.params?.label ?? '')
  const [targetDate, setTargetDate] = useState(event?.target_date ?? todayLocal())
  const [amount, setAmount] = useState(event?.params?.amount != null ? String(event.params.amount) : '')
  const [monthlyDelta, setMonthlyDelta] = useState(event?.params?.monthlyDelta != null ? String(event.params.monthlyDelta) : '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!targetDate) {
      setError('Pick a date.')
      return
    }
    const params = { label: label.trim() || null }
    if (amount) params.amount = Number(amount)
    if (monthlyDelta) params.monthlyDelta = Number(monthlyDelta)

    setSubmitting(true)
    try {
      await onSave({ kind, target_date: targetDate, params })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">{isEdit ? 'Edit life event' : 'Add a life event'}</h2>

        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="kind" className="mb-1 block text-sm font-medium text-ink-700">
              Type
            </label>
            <select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              {EVENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.icon} {k.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="label" className="mb-1 block text-sm font-medium text-ink-700">
              Label
            </label>
            <input
              id="label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Down payment on a 2BR"
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>

          <div>
            <label htmlFor="targetDate" className="mb-1 block text-sm font-medium text-ink-700">
              Date
            </label>
            <input
              id="targetDate"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>

          {kind !== 'retirement' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="amount" className="mb-1 block text-sm font-medium text-ink-700">
                  One-time amount (AED)
                </label>
                <input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="negative for a cost"
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                />
              </div>
              <div>
                <label htmlFor="monthlyDelta" className="mb-1 block text-sm font-medium text-ink-700">
                  Ongoing monthly change
                </label>
                <input
                  id="monthlyDelta"
                  type="number"
                  value={monthlyDelta}
                  onChange={(e) => setMonthlyDelta(e.target.value)}
                  placeholder="e.g. -3000 for a new EMI"
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                />
              </div>
            </div>
          )}

          {kind === 'retirement' && (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
              Retirement's post-retirement income is set in the forecast's assumptions, not per-event.
            </p>
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
            {isEdit && (
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
