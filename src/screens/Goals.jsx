import { useEffect, useState } from 'react'
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  listAllContributions,
  createContribution,
  projectedCompletionDate,
} from '../lib/goals'
import { listAccounts } from '../lib/accounts'
import GoalForm from '../components/GoalForm'
import ContributionForm from '../components/ContributionForm'

function formatAED(n) {
  return `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ProgressBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
      <div
        className="h-full origin-left rounded-full bg-gradient-to-r from-brand-500 to-brand-700"
        style={{ width: `${clamped}%`, animation: 'grow .8s cubic-bezier(.16,1,.3,1) both' }}
      />
    </div>
  )
}

export default function Goals() {
  const [tab, setTab] = useState('save_up')
  const [goals, setGoals] = useState([])
  const [accounts, setAccounts] = useState([])
  const [contributions, setContributions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingGoal, setEditingGoal] = useState(null) // goal, or 'new'
  const [detailGoalId, setDetailGoalId] = useState(null)
  const [addingContribution, setAddingContribution] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [g, a, c] = await Promise.all([listGoals(), listAccounts(), listAllContributions()])
      setGoals(g)
      setAccounts(a)
      setContributions(c)
    } catch {
      setError('Could not load goals. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSaveGoal(values) {
    if (editingGoal && editingGoal !== 'new') {
      await updateGoal(editingGoal.id, values)
    } else {
      await createGoal(values)
    }
    setEditingGoal(null)
    await refresh()
  }

  async function handleDeleteGoal() {
    await deleteGoal(editingGoal.id)
    setEditingGoal(null)
    setDetailGoalId(null)
    await refresh()
  }

  async function handleAddContribution(values) {
    await createContribution({ goal_id: detailGoalId, ...values })
    setAddingContribution(false)
    await refresh()
  }

  const liabilityAccounts = accounts.filter((a) => a.is_liability)
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const savedByGoal = new Map()
  for (const c of contributions) {
    savedByGoal.set(c.goal_id, (savedByGoal.get(c.goal_id) || 0) + Number(c.amount))
  }

  const saveUpGoals = goals.filter((g) => g.kind === 'save_up')
  const payDownGoals = goals.filter((g) => g.kind === 'pay_down')
  const detailGoal = goals.find((g) => g.id === detailGoalId) ?? null

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab('save_up')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'save_up' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Save Up
          </button>
          <button
            type="button"
            onClick={() => setTab('pay_down')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${tab === 'pay_down' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Pay Down
          </button>
        </div>
        <button
          type="button"
          onClick={() => setEditingGoal('new')}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
        >
          + Add goal
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      {tab === 'save_up' ? (
        saveUpGoals.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">No save-up goals yet.</p>
        ) : (
          <div className="space-y-3">
            {saveUpGoals.map((g) => (
              <SaveUpCard key={g.id} goal={g} saved={savedByGoal.get(g.id) || 0} onClick={() => setDetailGoalId(g.id)} />
            ))}
          </div>
        )
      ) : (
        <>
          {payDownGoals.length > 0 && <PayDownSummary goals={payDownGoals} accountById={accountById} />}
          {payDownGoals.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-500">No pay-down goals yet.</p>
          ) : (
            <div className="space-y-3">
              {payDownGoals.map((g) => (
                <PayDownCard key={g.id} goal={g} account={accountById.get(g.linked_account_id)} onClick={() => setDetailGoalId(g.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {editingGoal && (
        <GoalForm
          goal={editingGoal === 'new' ? null : editingGoal}
          liabilityAccounts={liabilityAccounts}
          onSave={handleSaveGoal}
          onCancel={() => setEditingGoal(null)}
          onDelete={handleDeleteGoal}
        />
      )}

      {detailGoal && !editingGoal && (
        <GoalDetail
          goal={detailGoal}
          account={accountById.get(detailGoal.linked_account_id)}
          contributions={contributions.filter((c) => c.goal_id === detailGoal.id)}
          onEdit={() => setEditingGoal(detailGoal)}
          onClose={() => setDetailGoalId(null)}
          onAddContribution={() => setAddingContribution(true)}
        />
      )}

      {addingContribution && (
        <ContributionForm onSave={handleAddContribution} onCancel={() => setAddingContribution(false)} />
      )}
    </div>
  )
}

function SaveUpCard({ goal, saved, onClick }) {
  const pct = goal.target_amount > 0 ? (saved / goal.target_amount) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border border-ink-200 bg-white shadow-card p-4 text-left hover:bg-ink-50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink-900">
          {goal.icon} {goal.name}
        </span>
        <span className="text-sm text-ink-500">
          {formatAED(saved)} / {formatAED(goal.target_amount)}
        </span>
      </div>
      <ProgressBar pct={pct} />
    </button>
  )
}

function PayDownCard({ goal, account, onClick }) {
  const starting = Number(goal.starting_balance) || 0
  const current = account ? Number(account.value) : starting
  const paidOff = Math.max(0, starting - current)
  const pct = starting > 0 ? (paidOff / starting) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border border-ink-200 bg-white shadow-card p-4 text-left hover:bg-ink-50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink-900">
          {goal.icon} {goal.name}
        </span>
        <span className="text-sm text-ink-500">
          {formatAED(current)} left of {formatAED(starting)}
        </span>
      </div>
      <ProgressBar pct={pct} />
      {!account && <p className="mt-1 text-xs text-neg-500">Linked account not found — it may have been deleted.</p>}
    </button>
  )
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-900">{value}</p>
    </div>
  )
}

function PayDownSummary({ goals, accountById }) {
  const currentDebtPrincipal = goals.reduce((sum, g) => {
    const account = accountById.get(g.linked_account_id)
    if (account) return sum + Number(account.value)
    if (g.starting_balance != null) return sum + Number(g.starting_balance)
    return sum
  }, 0)

  const targetDates = goals.map((g) => g.target_date).filter(Boolean)
  const debtFreeDate = targetDates.length > 0 ? targetDates.reduce((a, b) => (a > b ? a : b)) : null

  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-4">
        <p className="text-xs text-ink-500">Current Debt Principal</p>
        <p className="mt-1 text-lg font-semibold text-ink-900">{formatAED(currentDebtPrincipal)}</p>
      </div>
      <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-4">
        <p className="text-xs text-ink-500">Debt Free Date</p>
        <p className="mt-1 text-lg font-semibold text-ink-900">
          {debtFreeDate ? formatDate(new Date(`${debtFreeDate}T00:00:00`)) : '—'}
        </p>
      </div>
    </div>
  )
}

function GoalDetail({ goal, account, contributions, onEdit, onClose, onAddContribution }) {
  const isSaveUp = goal.kind === 'save_up'
  const saved = isSaveUp ? contributions.reduce((sum, c) => sum + Number(c.amount), 0) : 0
  const pct = isSaveUp
    ? goal.target_amount > 0
      ? (saved / goal.target_amount) * 100
      : 0
    : (() => {
        const starting = Number(goal.starting_balance) || 0
        const current = account ? Number(account.value) : starting
        return starting > 0 ? ((starting - current) / starting) * 100 : 0
      })()
  const remaining = isSaveUp ? Math.max(0, goal.target_amount - saved) : 0
  const projected = isSaveUp ? projectedCompletionDate(remaining, goal.monthly_plan) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">
            {goal.icon} {goal.name}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>

        <div className="my-4">
          <ProgressBar pct={pct} />
          <div className="mt-2 flex justify-between text-sm text-ink-600">
            {isSaveUp ? (
              <>
                <span>{formatAED(saved)} saved</span>
                <span>{formatAED(goal.target_amount)} target</span>
              </>
            ) : (
              <>
                <span>{formatAED(account ? Number(account.value) : 0)} left</span>
                <span>{formatAED(goal.starting_balance)} starting</span>
              </>
            )}
          </div>
          {isSaveUp && projected && <p className="mt-1 text-xs text-ink-400">Projected done: {formatDate(projected)}</p>}
        </div>

        {isSaveUp && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <StatTile label="Total saved" value={formatAED(saved)} />
            {/* Total spent / Available to spend read $0 / full target until "link spend to goal" (Phase 2) exists — honest, not broken. */}
            <StatTile label="Total spent" value={formatAED(0)} />
            <StatTile label="Left to save" value={formatAED(remaining)} />
            <StatTile label="Available to spend" value={formatAED(goal.target_amount)} />
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Edit
          </button>
          {isSaveUp && (
            <button
              type="button"
              onClick={onAddContribution}
              className="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800"
            >
              + Log contribution
            </button>
          )}
        </div>

        {isSaveUp && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Contributions</h3>
            {contributions.length === 0 ? (
              <p className="text-sm text-ink-500">No contributions logged yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200">
                {contributions.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-ink-600">
                      {formatDate(new Date(`${c.date}T00:00:00`))}
                      {c.note ? ` · ${c.note}` : ''}
                    </span>
                    <span className="font-medium text-ink-900">{formatAED(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isSaveUp && !account && (
          <p className="text-sm text-neg-500">
            This goal's linked account no longer exists — the value shown falls back to the starting balance.
          </p>
        )}
      </div>
    </div>
  )
}
