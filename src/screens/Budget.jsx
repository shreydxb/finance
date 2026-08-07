import { useEffect, useState } from 'react'
import { listBudgets, upsertBudget, BUDGET_GROUPS } from '../lib/budgets'
import { listCategories } from '../lib/categories'
import { listTransactions } from '../lib/transactions'
import { listIncome } from '../lib/income'
import { listGoals, listAllContributions } from '../lib/goals'
import { getSetting, toAED } from '../lib/settings'
import { currentYearMonth, monthRange, monthLabel, shiftMonth } from '../lib/period'
import BudgetLimitForm from '../components/BudgetLimitForm'

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `AED ${sign}${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

export default function Budget() {
  const [ym, setYm] = useState(currentYearMonth())
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState([])
  const [transactions, setTransactions] = useState([])
  const [income, setIncome] = useState([])
  const [goals, setGoals] = useState([])
  const [contributions, setContributions] = useState([])
  const [fxRates, setFxRates] = useState({ AED: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingCategory, setEditingCategory] = useState(null)

  async function refresh() {
    setError('')
    try {
      const { from, to } = monthRange(ym.year, ym.month)
      const [cats, buds, txns, inc, gs, contribs, fx] = await Promise.all([
        listCategories(),
        listBudgets(),
        listTransactions({ dateFrom: from, dateTo: to }),
        listIncome({ dateFrom: from, dateTo: to }),
        listGoals(),
        listAllContributions(),
        getSetting('fx_rates'),
      ])
      setCategories(cats)
      setBudgets(buds)
      setTransactions(txns)
      setIncome(inc)
      setGoals(gs)
      setContributions(contribs.filter((c) => c.date >= from && c.date <= to))
      setFxRates(fx || { AED: 1 })
    } catch {
      setError('Could not load budget. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym.year, ym.month])

  async function handleSaveBudget(values) {
    await upsertBudget(values)
    setEditingCategory(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading…</div>
  }

  const actualByCategory = new Map()
  for (const t of transactions) {
    const key = t.category || 'Uncategorised'
    actualByCategory.set(key, (actualByCategory.get(key) || 0) + toAED(Number(t.amount) || 0, t.currency, fxRates))
  }

  const budgetByCategoryId = new Map(budgets.map((b) => [b.category_id, b]))
  const rows = categories.map((c) => {
    const budget = budgetByCategoryId.get(c.id) ?? null
    const actual = actualByCategory.get(c.name) ?? 0
    const planned = budget?.monthly_limit ?? 0
    return { category: c, budget, actual, planned, remaining: planned - actual }
  })

  const budgeted = rows.filter((r) => r.budget)
  const unbudgeted = rows.filter((r) => !r.budget)

  const contributedByGoal = new Map()
  for (const c of contributions) {
    contributedByGoal.set(c.goal_id, (contributedByGoal.get(c.goal_id) || 0) + Number(c.amount))
  }
  const goalRows = (kind) =>
    goals
      .filter((g) => g.kind === kind)
      .map((g) => {
        const planned = Number(g.monthly_plan) || 0
        const actual = contributedByGoal.get(g.id) || 0
        return { goal: g, planned, actual, remaining: planned - actual }
      })
  const saveUpContribRows = goalRows('save_up')
  const payDownContribRows = goalRows('pay_down')
  const totalContributions = [...saveUpContribRows, ...payDownContribRows].reduce((sum, r) => sum + r.planned, 0)

  const totalBudgeted = budgeted.reduce((sum, r) => sum + r.planned, 0)
  const totalIncome = income.reduce((sum, i) => sum + toAED(Number(i.amount) || 0, i.currency, fxRates), 0)
  const leftToBudget = totalIncome - totalBudgeted - totalContributions

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-xl border border-stone-200 bg-white p-6">
        <p className="text-sm text-stone-500">Left to budget</p>
        <p className="mt-1 text-4xl font-semibold text-stone-900">{formatAED(leftToBudget)}</p>
        <p className="mt-2 text-xs text-stone-400">
          Income logged this month {formatAED(totalIncome)} − budgeted {formatAED(totalBudgeted)} − goal contributions {formatAED(totalContributions)}
        </p>
      </div>

      <div className="mb-6 flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => setYm((cur) => shiftMonth(cur.year, cur.month, -1))}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
        >
          ← Prev
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-900">{monthLabel(ym.year, ym.month)}</span>
          <button
            type="button"
            onClick={() => setYm(currentYearMonth())}
            className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => setYm((cur) => shiftMonth(cur.year, cur.month, 1))}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
        >
          Next →
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {BUDGET_GROUPS.map((group) => {
        const items = budgeted.filter((r) => r.budget.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{group}</h3>
            <div className="rounded-xl border border-stone-200 bg-white">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-stone-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                <span>Category</span>
                <span className="w-20 text-right">Planned</span>
                <span className="w-20 text-right">Actual</span>
                <span className="w-20 text-right">Remaining</span>
              </div>
              {items.map((r) => (
                <button
                  key={r.category.id}
                  type="button"
                  onClick={() => setEditingCategory(r.category)}
                  className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-stone-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-stone-50"
                >
                  <span className="truncate font-medium text-stone-900">
                    {r.category.icon} {r.category.name}
                  </span>
                  <span className="w-20 text-right text-stone-600">{r.planned.toLocaleString('en-AE', { maximumFractionDigits: 0 })}</span>
                  <span className="w-20 text-right text-stone-600">{r.actual.toLocaleString('en-AE', { maximumFractionDigits: 0 })}</span>
                  <span className={`w-20 text-right font-medium ${r.remaining < 0 ? 'text-red-600' : 'text-stone-900'}`}>
                    {r.remaining.toLocaleString('en-AE', { maximumFractionDigits: 0 })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Contributions</h3>
        <ContributionSubsection title="Save up" rows={saveUpContribRows} />
        <ContributionSubsection title="Pay down" rows={payDownContribRows} />
      </div>

      {unbudgeted.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Not yet budgeted</h3>
          <div className="rounded-xl border border-stone-200 bg-white">
            {unbudgeted.map((r) => (
              <button
                key={r.category.id}
                type="button"
                onClick={() => setEditingCategory(r.category)}
                className="flex w-full items-center justify-between border-b border-stone-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-stone-50"
              >
                <span className="font-medium text-stone-900">
                  {r.category.icon} {r.category.name}
                </span>
                <span className="text-xs font-medium text-stone-400 underline">Set a limit</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {editingCategory && (
        <BudgetLimitForm
          category={editingCategory}
          budget={budgetByCategoryId.get(editingCategory.id) ?? null}
          onSave={handleSaveBudget}
          onCancel={() => setEditingCategory(null)}
        />
      )}
    </div>
  )
}

function ContributionSubsection({ title, rows }) {
  return (
    <div className="mb-3 rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-4 py-2 text-xs font-semibold text-stone-500">{title}</div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-500">
          {title === 'Pay down'
            ? 'None of your liability accounts are included in the budget.'
            : 'No save-up goals yet.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-stone-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            <span>Goal</span>
            <span className="w-20 text-right">Planned</span>
            <span className="w-20 text-right">Actual</span>
            <span className="w-20 text-right">Remaining</span>
          </div>
          {rows.map((r) => (
            <div key={r.goal.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-stone-100 px-4 py-3 text-sm last:border-b-0">
              <span className="truncate font-medium text-stone-900">
                {r.goal.icon} {r.goal.name}
              </span>
              <span className="w-20 text-right text-stone-600">{r.planned.toLocaleString('en-AE', { maximumFractionDigits: 0 })}</span>
              <span className="w-20 text-right text-stone-600">{r.actual.toLocaleString('en-AE', { maximumFractionDigits: 0 })}</span>
              <span className={`w-20 text-right font-medium ${r.remaining < 0 ? 'text-red-600' : 'text-stone-900'}`}>
                {r.remaining.toLocaleString('en-AE', { maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
