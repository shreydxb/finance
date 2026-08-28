import { useEffect, useState } from 'react'
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  listAllContributions,
  createContributionWithTransfer,
  projectedCompletionDate,
  projectedFDCompletion,
} from '../lib/goals'
import { listAccounts } from '../lib/accounts'
import { usePrefs } from '../lib/PrefsContext'
import { toAED } from '../lib/money'
import GoalForm from '../components/GoalForm'
import ContributionForm from '../components/ContributionForm'
import { useRealtimeRefresh } from '../lib/useRealtime'
import { REALTIME_TABLES } from '../lib/realtime'
import { ErrorState, LoadingState } from '../design-system'
import DetailShell from '../shell/RouteDetailShell'

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

/**
 * Goals — what you're saving toward (Emergency Fund, house downpayment,
 * vacation). Debt payoff moved to its own screen: a car loan isn't a goal in
 * the way a vacation fund is, it's an obligation you're working down, and
 * mixing the two under one "Goals" label was confusing what this screen was
 * even for. See Debts.jsx for that half.
 */
export default function Goals({ detailId, onOpenDetail, onCloseDetail }) {
  const { fmt, fxRates } = usePrefs()
  const [goals, setGoals] = useState([])
  const [contributions, setContributions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingGoal, setEditingGoal] = useState(null) // goal, or 'new'
  const [detailGoalId, setDetailGoalId] = useState(null)
  const [addingContribution, setAddingContribution] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [g, c, a] = await Promise.all([listGoals(), listAllContributions(), listAccounts()])
      setGoals(g.filter((x) => x.kind === 'save_up'))
      setContributions(c)
      setAccounts(a)
    } catch {
      setError('Could not load goals. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Another client — the Telegram bot, or the other person's phone — writing to
  // these tables now refreshes this screen (INT-01).
  useRealtimeRefresh(REALTIME_TABLES.goals, refresh)

  useEffect(() => {
    if (!detailId) {
      setDetailGoalId(null)
      setEditingGoal((current) => current && current !== 'new' ? null : current)
      return
    }
    setEditingGoal((current) => current && current !== 'new' && current.id !== detailId ? null : current)
    if (goals.some((goal) => goal.id === detailId)) setDetailGoalId(detailId)
    else if (!loading) setDetailGoalId(null)
  }, [goals, detailId, loading])

  function openGoal(id) {
    if (onOpenDetail?.('goal', id)) return
    setDetailGoalId(id)
  }

  function closeGoal(options) {
    if (detailId) {
      if (onCloseDetail?.(options)) {
        setDetailGoalId(null)
        setEditingGoal(null)
      }
      return
    }
    setDetailGoalId(null)
  }

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
    closeGoal({ force: true })
    await refresh()
  }

  async function handleAddContribution({ fromAccountId, ...values }) {
    const goal = goals.find((g) => g.id === detailGoalId)
    // One call, one database transaction. The contribution and its Transfer
    // transaction used to be written separately, so a failure between them
    // left Goals and Transactions disagreeing about the same event (DATA-02).
    // The transaction exists so a contribution is auditable in Transactions
    // and Budget, not only inside this screen; accounts.value is still never
    // touched, since balances come from statements.
    await createContributionWithTransfer({
      goalId: detailGoalId,
      amount: values.amount,
      date: values.date,
      note: values.note,
      fromAccountId: fromAccountId ?? null,
      goalName: goal?.name ?? null,
    })
    setAddingContribution(false)
    await refresh()
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const assetAccounts = accounts.filter((a) => !a.is_liability)
  const spendableAccounts = accounts.filter((a) => !a.is_liability && a.type === 'cash')

  const savedByGoal = new Map()
  for (const c of contributions) {
    savedByGoal.set(c.goal_id, (savedByGoal.get(c.goal_id) || 0) + Number(c.amount))
  }
  // A goal linked to an account (typically a Fixed Deposit) tracks that
  // account's real balance directly instead of summing logged contributions —
  // same pattern Debts already uses for a linked liability account.
  // Goal targets are held in AED, so a linked account's balance is converted
  // before it is compared against one. Every goal happens to be linked to an
  // AED account today, but 41 of the household's 46 accounts are not AED — the
  // first goal linked to one of those would otherwise compare, say, a rupee
  // balance against a dirham target and report wild progress.
  function savedFor(goal) {
    const linked = accountById.get(goal.linked_account_id)
    if (!linked) return savedByGoal.get(goal.id) || 0
    return toAED(Number(linked.value) || 0, linked.currency, fxRates)
  }

  const detailGoal = goals.find((g) => g.id === (detailId ?? detailGoalId)) ?? null

  if (loading) {
    return detailId ? (
      <DetailShell backLabel="Goals" title="Goal" loading onRequestClose={() => closeGoal()} />
    ) : <div className="px-6 py-10"><LoadingState label="Loading…" /></div>
  }

  return (
    <div>
      <span className="sr-only">Goals</span>
      <div className="mb-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setEditingGoal('new')}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + Add goal
        </button>
      </div>

      {error && (
        <div className="mb-4"><ErrorState title={error} /></div>
      )}

      {goals.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          No goals yet — Emergency Fund, a house downpayment, a vacation, anything you're saving toward.
        </p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <SaveUpCard key={g.id} goal={g} saved={savedFor(g)} onClick={() => openGoal(g.id)} fmt={fmt} />
          ))}
        </div>
      )}

      {editingGoal && !detailId && (
        <GoalForm
          goal={editingGoal === 'new' ? null : editingGoal}
          fixedKind="save_up"
          liabilityAccounts={[]}
          assetAccounts={assetAccounts}
          onSave={handleSaveGoal}
          onCancel={() => setEditingGoal(null)}
          onDelete={handleDeleteGoal}
        />
      )}

      {detailGoal && !editingGoal && !detailId && (
        <GoalDetail
          fmt={fmt}
          goal={detailGoal}
          saved={savedFor(detailGoal)}
          linkedAccount={accountById.get(detailGoal.linked_account_id)}
          contributions={contributions.filter((c) => c.goal_id === detailGoal.id)}
          onEdit={() => setEditingGoal(detailGoal)}
          onClose={() => closeGoal()}
          onAddContribution={() => setAddingContribution(true)}
        />
      )}

      {detailId && (
        <DetailShell
          backLabel="Goals"
          title={editingGoal ? `Edit ${detailGoal?.name ?? 'goal'}` : detailGoal ? `${detailGoal.icon ?? ''} ${detailGoal.name}`.trim() : 'Goal'}
          error={error}
          unavailable={!error && !detailGoal}
          onRequestClose={() => closeGoal()}
        >
          {editingGoal && detailGoal ? (
            <GoalForm
              embedded
              goal={editingGoal}
              fixedKind="save_up"
              liabilityAccounts={[]}
              assetAccounts={assetAccounts}
              onSave={handleSaveGoal}
              onCancel={() => setEditingGoal(null)}
              onDelete={handleDeleteGoal}
            />
          ) : detailGoal ? (
            <GoalDetail
              embedded
              fmt={fmt}
              goal={detailGoal}
              saved={savedFor(detailGoal)}
              linkedAccount={accountById.get(detailGoal.linked_account_id)}
              contributions={contributions.filter((c) => c.goal_id === detailGoal.id)}
              onEdit={() => setEditingGoal(detailGoal)}
              onClose={() => closeGoal()}
              onAddContribution={() => setAddingContribution(true)}
            />
          ) : null}
        </DetailShell>
      )}

      {addingContribution && (
        <ContributionForm
          accounts={spendableAccounts}
          onSave={handleAddContribution}
          onCancel={() => setAddingContribution(false)}
        />
      )}
    </div>
  )
}

function SaveUpCard({ goal, saved, onClick, fmt }) {
  const pct = goal.target_amount > 0 ? (saved / goal.target_amount) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border border-ink-200 bg-surface p-4 text-left shadow-card hover:bg-ink-50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink-900">
          {goal.icon} {goal.name}
        </span>
        <span className="tnum text-sm text-ink-500">
          {fmt(saved)} / {fmt(goal.target_amount)}
        </span>
      </div>
      <ProgressBar pct={pct} />
    </button>
  )
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="tnum mt-0.5 text-sm font-semibold text-ink-900">{value}</p>
    </div>
  )
}

function GoalDetail({ goal, saved, linkedAccount, contributions, onEdit, onClose, onAddContribution, fmt, embedded = false }) {
  const pct = goal.target_amount > 0 ? (saved / goal.target_amount) * 100 : 0
  const remaining = Math.max(0, goal.target_amount - saved)
  const isFD = linkedAccount?.type === 'fixed_deposit' && linkedAccount?.interest_rate
  const fdProjection = isFD
    ? projectedFDCompletion(saved, goal.target_amount, linkedAccount.interest_rate, Number(goal.monthly_plan) || 0)
    : null
  const projected = isFD ? fdProjection?.date ?? null : projectedCompletionDate(remaining, goal.monthly_plan)

  const content = (
    <>
        {!embedded && <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">
            {goal.icon} {goal.name}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>}

        {linkedAccount && (
          <p className="text-xs text-ink-400">
            Funded by {linkedAccount.name}
            {isFD ? ` · ${linkedAccount.interest_rate}% p.a.` : ''} — balance tracks that account, not the log below.
          </p>
        )}

        <div className="my-4">
          <ProgressBar pct={pct} />
          <div className="mt-2 flex justify-between text-sm text-ink-600">
            <span className="tnum">{fmt(saved)} saved</span>
            <span className="tnum">{fmt(goal.target_amount)} target</span>
          </div>
          {projected && (
            <p className="mt-1 text-xs text-ink-400">
              {isFD ? 'Projected (interest + plan)' : 'Projected done'}: {formatDate(projected)}
              {isFD && fdProjection ? ` (~${fdProjection.months} mo)` : ''}
            </p>
          )}
          {isFD && !fdProjection && (
            <p className="mt-1 text-xs text-ink-400">
              Add a monthly plan or a higher rate — at {linkedAccount.interest_rate}% alone this won't reach target.
            </p>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <StatTile label="Total saved" value={fmt(saved)} />
          {/* Total spent / Available to spend read $0 / full target until "link spend to goal" (Phase 2) exists — honest, not broken. */}
          <StatTile label="Total spent" value={fmt(0)} />
          <StatTile label="Left to save" value={fmt(remaining)} />
          <StatTile label="Available to spend" value={fmt(goal.target_amount)} />
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onAddContribution}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            + Log contribution
          </button>
        </div>

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
                  <span className="tnum font-medium text-ink-900">{fmt(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
