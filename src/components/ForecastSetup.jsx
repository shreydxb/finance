import { useState } from 'react'
import { Button } from '../design-system'
import ProtectedForm from './ProtectedForm'

/**
 * The forecast's assumptions — Accounts → Forecast (Taskiv #24). A single
 * scrollable form rather than Monarch's multi-step wizard: same inputs
 * (birthday, reviewed assumptions, participating accounts, retirement age),
 * fewer taps. Assumptions default from real trailing-12-month income/expense
 * actuals (`defaultMonthlyIncome`/`defaultMonthlyExpenses`), editable here as
 * an override — never a hand-typed guess unless the household chooses to
 * override the real figure.
 */
export default function ForecastSetup({ accounts, defaultMonthlyIncome, defaultMonthlyExpenses, initial, onSave, onCancel }) {
  const [birthday, setBirthday] = useState(initial?.birthday ?? '')
  const [growthRatePct, setGrowthRatePct] = useState(String(initial?.growthRatePct ?? 6))
  const [retirementAge, setRetirementAge] = useState(String(initial?.retirementAge ?? 55))
  const [retirementIncome, setRetirementIncome] = useState(String(initial?.retirementIncome ?? 0))
  const [monthlyIncome, setMonthlyIncome] = useState(String(initial?.monthlyIncomeOverride ?? Math.round(defaultMonthlyIncome)))
  const [monthlyExpenses, setMonthlyExpenses] = useState(String(initial?.monthlyExpenseOverride ?? Math.round(defaultMonthlyExpenses)))
  const [participatingAccountIds, setParticipatingAccountIds] = useState(
    initial?.participatingAccountIds ?? accounts.map((a) => a.id)
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function toggleAccount(id) {
    setParticipatingAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!birthday) {
      setError('Birthday is required — retirement math needs an age.')
      return
    }
    setSubmitting(true)
    try {
      await onSave({
        birthday,
        growthRatePct: Number(growthRatePct) || 0,
        retirementAge: Number(retirementAge) || 0,
        retirementIncome: Number(retirementIncome) || 0,
        monthlyIncomeOverride: Number(monthlyIncome) || 0,
        monthlyExpenseOverride: Number(monthlyExpenses) || 0,
        participatingAccountIds,
      })
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-1 text-lg font-semibold text-ink-900">Forecast assumptions</h2>
        <p className="mb-4 text-xs text-ink-500">
          An estimate, not a promise — one blended growth rate and your real trailing-12-month savings rate, projected forward.
        </p>

        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="birthday" className="mb-1 block text-sm font-medium text-ink-700">
              Your birthday
            </label>
            <input
              id="birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="monthlyIncome" className="mb-1 block text-sm font-medium text-ink-700">
                Monthly income (AED)
              </label>
              <input
                id="monthlyIncome"
                type="number"
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
              <p className="mt-1 text-[11px] text-ink-400">From your last 12 months: {Math.round(defaultMonthlyIncome).toLocaleString()}</p>
            </div>
            <div>
              <label htmlFor="monthlyExpenses" className="mb-1 block text-sm font-medium text-ink-700">
                Monthly expenses (AED)
              </label>
              <input
                id="monthlyExpenses"
                type="number"
                value={monthlyExpenses}
                onChange={(e) => setMonthlyExpenses(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
              <p className="mt-1 text-[11px] text-ink-400">From your last 12 months: {Math.round(defaultMonthlyExpenses).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="growthRate" className="mb-1 block text-sm font-medium text-ink-700">
                Annual growth rate (%)
              </label>
              <input
                id="growthRate"
                type="number"
                step="0.1"
                value={growthRatePct}
                onChange={(e) => setGrowthRatePct(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
            <div>
              <label htmlFor="retirementAge" className="mb-1 block text-sm font-medium text-ink-700">
                Retirement age
              </label>
              <input
                id="retirementAge"
                type="number"
                value={retirementAge}
                onChange={(e) => setRetirementAge(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="retirementIncome" className="mb-1 block text-sm font-medium text-ink-700">
              Monthly income after retirement (AED)
            </label>
            <input
              id="retirementIncome"
              type="number"
              value={retirementIncome}
              onChange={(e) => setRetirementIncome(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="0 if you'll be living off savings"
            />
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-ink-700">Accounts to include</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-2">
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={participatingAccountIds.includes(a.id)}
                    onChange={() => toggleAccount(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>

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
          </div>
        </ProtectedForm>
      </div>
    </div>
  )
}
