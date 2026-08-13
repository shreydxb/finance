import { useEffect, useState } from 'react'
import { listGoals, createGoal, updateGoal, deleteGoal } from '../lib/goals'
import { listAccounts } from '../lib/accounts'
import { usePrefs } from '../lib/PrefsContext'
import { toAED } from '../lib/money'
import GoalForm from '../components/GoalForm'

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ProgressBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
      <div
        className="h-full origin-left rounded-full bg-gradient-to-r from-neg-500 to-amber-500"
        style={{ width: `${clamped}%`, animation: 'grow .8s cubic-bezier(.16,1,.3,1) both' }}
      />
    </div>
  )
}

/**
 * Debts — loans, EMIs, and credit-card balances you're paying off. Split out
 * of Goals: a car loan isn't something you're saving toward, it's a liability
 * you're working down, and the two don't share a mental model (target amount
 * to reach vs. balance to zero out) even though they used the same `goals`
 * table row shape. Still the same `pay_down` rows under the hood — no schema
 * change, just a dedicated screen.
 */
export default function Debts() {
  const { fmt, fxRates } = usePrefs()
  const [debts, setDebts] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // debt, or 'new'
  const [detailId, setDetailId] = useState(null)

  async function refresh() {
    setError('')
    try {
      const [g, a] = await Promise.all([listGoals(), listAccounts()])
      setDebts(g.filter((x) => x.kind === 'pay_down'))
      setAccounts(a)
    } catch {
      setError('Could not load debts. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSave(values) {
    if (editing && editing !== 'new') await updateGoal(editing.id, values)
    else await createGoal(values)
    setEditing(null)
    await refresh()
  }

  async function handleDelete() {
    await deleteGoal(editing.id)
    setEditing(null)
    setDetailId(null)
    await refresh()
  }

  const liabilityAccounts = accounts.filter((a) => a.is_liability)
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const detail = debts.find((d) => d.id === detailId) ?? null

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  // Linked balances are converted before being summed: adding a USD card
  // balance to an AED loan balance and labelling the result AED overstates the
  // debt by whatever the exchange rate is.
  const totalPrincipal = debts.reduce((sum, d) => {
    const account = accountById.get(d.linked_account_id)
    if (account) return sum + toAED(Number(account.value) || 0, account.currency, fxRates)
    if (d.starting_balance != null) return sum + Number(d.starting_balance)
    return sum
  }, 0)
  const totalMonthly = debts.reduce((sum, d) => sum + (Number(d.monthly_plan) || 0), 0)
  const targetDates = debts.map((d) => d.target_date).filter(Boolean)
  const debtFreeDate = targetDates.length > 0 ? targetDates.reduce((a, b) => (a > b ? a : b)) : null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Debts</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + Add debt
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      {debts.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          No debts tracked yet — loans, EMIs, and credit-card balances you're paying down.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card">
              <p className="text-xs text-ink-500">Total Principal</p>
              <p className="tnum mt-1 text-lg font-semibold text-ink-900">{fmt(totalPrincipal)}</p>
            </div>
            <div className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card">
              <p className="text-xs text-ink-500">Monthly Payments</p>
              <p className="tnum mt-1 text-lg font-semibold text-ink-900">{fmt(totalMonthly)}</p>
            </div>
            <div className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card">
              <p className="text-xs text-ink-500">Debt Free Date</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">
                {debtFreeDate ? formatDate(new Date(`${debtFreeDate}T00:00:00`)) : '—'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {debts.map((d) => (
              <DebtCard key={d.id} debt={d} account={accountById.get(d.linked_account_id)} onClick={() => setDetailId(d.id)} fmt={fmt} fxRates={fxRates} />
            ))}
          </div>
        </>
      )}

      {editing && (
        <GoalForm
          goal={editing === 'new' ? null : editing}
          fixedKind="pay_down"
          liabilityAccounts={liabilityAccounts}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}

      {detail && !editing && (
        <DebtDetail
          debt={detail}
          account={accountById.get(detail.linked_account_id)}
          onEdit={() => setEditing(detail)}
          onClose={() => setDetailId(null)}
          fmt={fmt}
          fxRates={fxRates}
        />
      )}
    </div>
  )
}

function DebtCard({ debt, account, onClick, fmt, fxRates }) {
  const starting = Number(debt.starting_balance) || 0
  // starting_balance is AED; a linked balance must be converted before it is
  // compared against it or handed to fmt, which assumes AED.
  const current = account ? toAED(Number(account.value) || 0, account.currency, fxRates) : starting
  const paidOff = Math.max(0, starting - current)
  const pct = starting > 0 ? (paidOff / starting) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border border-ink-200 bg-surface p-4 text-left shadow-card hover:bg-ink-50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink-900">
          {debt.icon} {debt.name}
        </span>
        <span className="tnum text-sm text-ink-500">
          {fmt(current)} left of {fmt(starting)}
        </span>
      </div>
      <ProgressBar pct={pct} />
      {!account && <p className="mt-1 text-xs text-neg-500">Linked account not found — it may have been deleted.</p>}
    </button>
  )
}

function DebtDetail({ debt, account, onEdit, onClose, fmt, fxRates }) {
  const starting = Number(debt.starting_balance) || 0
  const current = account ? toAED(Number(account.value) || 0, account.currency, fxRates) : starting
  const pct = starting > 0 ? ((starting - current) / starting) * 100 : 0

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">
            {debt.icon} {debt.name}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>

        <div className="my-4">
          <ProgressBar pct={pct} />
          <div className="mt-2 flex justify-between text-sm text-ink-600">
            <span className="tnum">{fmt(current)} left</span>
            <span className="tnum">{fmt(starting)} starting</span>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Monthly payment</p>
            <p className="tnum mt-0.5 text-sm font-semibold text-ink-900">{fmt(Number(debt.monthly_plan) || 0)}</p>
          </div>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Target payoff</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-900">
              {debt.target_date ? formatDate(new Date(`${debt.target_date}T00:00:00`)) : '—'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
        >
          Edit
        </button>

        {!account && (
          <p className="mt-3 text-sm text-neg-500">
            This debt's linked account no longer exists — the value shown falls back to the starting balance.
          </p>
        )}
      </div>
    </div>
  )
}
