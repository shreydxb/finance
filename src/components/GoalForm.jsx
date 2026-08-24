import { useState } from 'react'
import ProtectedForm from './ProtectedForm'

/**
 * `fixedKind` locks the form to one kind with no toggle shown — used now that
 * Goals (save_up) and Debts (pay_down) are separate screens, so which kind
 * you're creating is implied by which screen you're on, not a choice inside
 * the form.
 */
export default function GoalForm({ goal, fixedKind, liabilityAccounts, assetAccounts = [], onSave, onCancel, onDelete }) {
  const isEdit = Boolean(goal)
  const [kind, setKind] = useState(goal?.kind ?? fixedKind ?? 'save_up')
  const [name, setName] = useState(goal?.name ?? '')
  const [icon, setIcon] = useState(goal?.icon ?? '')
  const [targetAmount, setTargetAmount] = useState(goal ? String(goal.target_amount) : '')
  const [monthlyPlan, setMonthlyPlan] = useState(goal?.monthly_plan != null ? String(goal.monthly_plan) : '')
  const [priority, setPriority] = useState(goal?.priority != null ? String(goal.priority) : '')
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [linkedAccountId, setLinkedAccountId] = useState(
    goal?.linked_account_id ?? (fixedKind === 'pay_down' ? liabilityAccounts[0]?.id ?? '' : '')
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }

    if (kind === 'save_up') {
      if (!targetAmount || Number.isNaN(Number(targetAmount)) || Number(targetAmount) <= 0) {
        setError('Enter a valid target amount.')
        return
      }
    } else {
      if (!linkedAccountId) {
        setError('Pick the liability account this goal pays off.')
        return
      }
    }

    setSubmitting(true)
    try {
      if (kind === 'save_up') {
        await onSave({
          kind,
          name: name.trim(),
          icon: icon.trim() || null,
          target_amount: Number(targetAmount),
          monthly_plan: monthlyPlan ? Number(monthlyPlan) : null,
          priority: priority ? Number(priority) : null,
          target_date: targetDate || null,
          linked_account_id: linkedAccountId || null,
        })
      } else {
        const account = liabilityAccounts.find((a) => a.id === linkedAccountId)
        await onSave({
          kind,
          name: name.trim(),
          icon: icon.trim() || null,
          target_amount: goal?.target_amount ?? account?.value ?? 0,
          monthly_plan: monthlyPlan ? Number(monthlyPlan) : null,
          priority: priority ? Number(priority) : null,
          linked_account_id: linkedAccountId,
          starting_balance: goal?.starting_balance ?? account?.value ?? 0,
        })
      }
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
          {isEdit ? `Edit ${kind === 'save_up' ? 'goal' : 'debt'}` : fixedKind === 'pay_down' ? 'Add debt' : 'Add goal'}
        </h2>
        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && !fixedKind && (
            <div>
              <span className="mb-1 block text-sm font-medium text-ink-700">Type</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind('save_up')}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    kind === 'save_up' ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  Save up
                </button>
                <button
                  type="button"
                  onClick={() => setKind('pay_down')}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    kind === 'pay_down' ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  Pay down
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label htmlFor="g-name" className="mb-1 block text-sm font-medium text-ink-700">
                Name
              </label>
              <input
                id="g-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="e.g. Emergency Fund"
              />
            </div>
            <div>
              <label htmlFor="g-icon" className="mb-1 block text-sm font-medium text-ink-700">
                Icon
              </label>
              <input
                id="g-icon"
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-center text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="🎯"
              />
            </div>
          </div>

          {kind === 'save_up' ? (
            <>
              <div>
                <label htmlFor="g-target" className="mb-1 block text-sm font-medium text-ink-700">
                  Target amount (AED)
                </label>
                <input
                  id="g-target"
                  type="number"
                  step="0.01"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="g-target-date" className="mb-1 block text-sm font-medium text-ink-700">
                  Target date (optional)
                </label>
                <input
                  id="g-target-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                />
              </div>
              {assetAccounts.length > 0 && (
                <div>
                  <label htmlFor="g-linked" className="mb-1 block text-sm font-medium text-ink-700">
                    Funded by an account (optional)
                  </label>
                  <select
                    id="g-linked"
                    value={linkedAccountId}
                    onChange={(e) => setLinkedAccountId(e.target.value)}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  >
                    <option value="">— none, track by logged contributions —</option>
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency} {Number(a.value).toLocaleString()})
                        {a.type === 'fixed_deposit' && a.interest_rate ? ` · ${a.interest_rate}%` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-400">
                    E.g. a Fixed Deposit — progress tracks that account's balance directly instead of summing contributions,
                    and if it carries an interest rate, the goal shows a projected time-to-target.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div>
              <label htmlFor="g-account" className="mb-1 block text-sm font-medium text-ink-700">
                Liability account
              </label>
              {isEdit ? (
                <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-600">
                  {liabilityAccounts.find((a) => a.id === linkedAccountId)?.name ?? 'Linked account'} (can't change after creation)
                </p>
              ) : liabilityAccounts.length === 0 ? (
                <p className="text-sm text-ink-500">No liability accounts yet — add one in Accounts first.</p>
              ) : (
                <select
                  id="g-account"
                  value={linkedAccountId}
                  onChange={(e) => setLinkedAccountId(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                >
                  {liabilityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency} {Number(a.value).toLocaleString()})
                    </option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-ink-400">Progress tracks that account's balance going down, starting from its value now.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="g-monthly" className="mb-1 block text-sm font-medium text-ink-700">
                Monthly plan (optional)
              </label>
              <input
                id="g-monthly"
                type="number"
                step="0.01"
                value={monthlyPlan}
                onChange={(e) => setMonthlyPlan(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="g-priority" className="mb-1 block text-sm font-medium text-ink-700">
                Priority (optional)
              </label>
              <input
                id="g-priority"
                type="number"
                min="1"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                placeholder="1"
              />
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
