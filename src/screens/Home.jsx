import { useEffect, useState } from 'react'
import { countNeedsReview, listTransactions } from '../lib/transactions'
import { listIncome } from '../lib/income'
import { listBudgets } from '../lib/budgets'
import { listRecurring, nextDueDate, daysUntil } from '../lib/recurring'
import { listGoals, listAllContributions } from '../lib/goals'
import { listAccounts } from '../lib/accounts'
import { getSetting, toAED } from '../lib/settings'
import { currentYearMonth, monthLabel, monthRange } from '../lib/period'
import NetWorthHero from '../components/NetWorthHero'

const DUE_SOON_DAYS = 14
const RECENT_LIMIT = 5
const TOP_GOALS = 3

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `AED ${sign}${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

function formatDay(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "today" / "tomorrow" / "in 6 days" reads better than a date for a bill. */
function formatDueIn(days) {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export default function Home({ onNavigate }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const { year, month } = currentYearMonth()
    const { from, to } = monthRange(year, month)

    async function load() {
      try {
        const [accounts, monthTxns, recent, income, budgets, recurring, goals, contributions, fxRates, reviewCount] =
          await Promise.all([
            listAccounts(),
            listTransactions({ dateFrom: from, dateTo: to }),
            listTransactions({}),
            listIncome({ dateFrom: from, dateTo: to }),
            listBudgets(),
            listRecurring(),
            listGoals(),
            listAllContributions(),
            getSetting('fx_rates'),
            countNeedsReview(),
          ])
        if (cancelled) return
        setData({
          accounts,
          monthTxns,
          recent: recent.slice(0, RECENT_LIMIT),
          income,
          budgets,
          recurring,
          goals,
          contributions,
          fxRates: fxRates || { AED: 1 },
          reviewCount,
          label: monthLabel(year, month),
        })
      } catch {
        if (!cancelled) setError('Could not load your dashboard. Check your connection and try again.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      </div>
    )
  }

  if (!data) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading…</div>
  }

  const { fxRates } = data
  const spent = data.monthTxns.reduce((sum, t) => sum + toAED(Number(t.amount) || 0, t.currency, fxRates), 0)
  const earned = data.income.reduce((sum, i) => sum + toAED(Number(i.amount) || 0, i.currency, fxRates), 0)
  // Same definition as Cash Flow, so the two screens can never disagree.
  const savingsRate = earned > 0 ? ((earned - spent) / earned) * 100 : null
  const budgeted = data.budgets.reduce((sum, b) => sum + (Number(b.monthly_limit) || 0), 0)

  const dueSoon = data.recurring
    .filter((r) => r.kind !== 'income')
    .map((r) => {
      const due = nextDueDate(r)
      return due ? { entry: r, due, days: daysUntil(due) } : null
    })
    .filter((d) => d && d.days <= DUE_SOON_DAYS)
    .sort((a, b) => a.days - b.days)

  const savedByGoal = new Map()
  for (const c of data.contributions) {
    savedByGoal.set(c.goal_id, (savedByGoal.get(c.goal_id) || 0) + Number(c.amount))
  }
  const accountById = new Map(data.accounts.map((a) => [a.id, a]))
  const topGoals = data.goals.slice(0, TOP_GOALS)

  const isEmpty = data.accounts.length === 0 && data.recent.length === 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <NetWorthHero accounts={data.accounts} fxRates={fxRates} />

      {isEmpty && (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
          <p className="mb-1 font-medium text-stone-900">Nothing here yet</p>
          <p>
            Add an account to see your net worth, then log spends from the Transactions tab or straight from Telegram.
          </p>
          <button
            type="button"
            onClick={() => onNavigate?.('Accounts')}
            className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Add an account
          </button>
        </div>
      )}

      {data.reviewCount > 0 && (
        <button
          type="button"
          onClick={() => onNavigate?.('Transactions')}
          className="mt-6 flex w-full items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100"
        >
          <span>
            {data.reviewCount} {data.reviewCount === 1 ? 'transaction needs' : 'transactions need'} a review
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      <Section title={data.label} action="Cash Flow" onAction={() => onNavigate?.('Cash Flow')}>
        <div className="grid grid-cols-3 divide-x divide-stone-200 rounded-xl border border-stone-200 bg-white">
          <Stat label="Spent" value={formatAED(spent)} />
          <Stat
            label="Budget"
            value={budgeted > 0 ? formatAED(budgeted) : '—'}
            hint={budgeted > 0 ? `${formatAED(Math.max(0, budgeted - spent))} left` : 'not set'}
          />
          <Stat
            label="Savings rate"
            value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
            hint={earned > 0 ? `of ${formatAED(earned)}` : 'no income logged'}
            tone={savingsRate !== null && savingsRate < 0 ? 'bad' : 'plain'}
          />
        </div>
      </Section>

      <Section title="Due soon" action="Recurring" onAction={() => onNavigate?.('Recurring')}>
        {dueSoon.length === 0 ? (
          <Empty>Nothing due in the next {DUE_SOON_DAYS} days.</Empty>
        ) : (
          <Rows>
            {dueSoon.map(({ entry, days }) => (
              <Row
                key={entry.id}
                left={entry.name}
                sub={`${entry.kind === 'emi' ? 'EMI' : 'Bill'}${entry.autopay ? ' · autopay' : ''}`}
                right={formatAED(entry.amount)}
                rightSub={formatDueIn(days)}
                urgent={days <= 3}
              />
            ))}
          </Rows>
        )}
      </Section>

      <Section title="Recent" action="Transactions" onAction={() => onNavigate?.('Transactions')}>
        {data.recent.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          <Rows>
            {data.recent.map((t) => (
              <Row
                key={t.id}
                left={t.category || 'Uncategorised'}
                sub={[t.owner, t.note].filter(Boolean).join(' · ')}
                right={`${t.currency} ${Number(t.amount).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`}
                rightSub={formatDay(t.date)}
                badge={t.needs_review ? 'Needs review' : null}
              />
            ))}
          </Rows>
        )}
      </Section>

      <Section title="Goals" action="Goals" onAction={() => onNavigate?.('Goals')}>
        {topGoals.length === 0 ? (
          <Empty>No goals yet.</Empty>
        ) : (
          <div className="space-y-2">
            {topGoals.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                saved={savedByGoal.get(g.id) || 0}
                account={accountById.get(g.linked_account_id)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, action, onAction, children }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
        {action && (
          <button type="button" onClick={onAction} className="text-xs font-medium text-stone-500 underline hover:text-stone-700">
            {action} →
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, hint, tone = 'plain' }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone === 'bad' ? 'text-red-600' : 'text-stone-900'}`}>{value}</p>
      {hint && <p className="text-xs text-stone-400">{hint}</p>}
    </div>
  )
}

function Rows({ children }) {
  return <div className="rounded-xl border border-stone-200 bg-white">{children}</div>
}

function Row({ left, sub, right, rightSub, urgent, badge }) {
  return (
    <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm last:border-b-0">
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-medium text-stone-900">{left}</span>
          {badge && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
              {badge}
            </span>
          )}
        </span>
        {sub && <span className="block truncate text-xs text-stone-400">{sub}</span>}
      </span>
      <span className="shrink-0 pl-2 text-right">
        <span className="block font-medium text-stone-700">{right}</span>
        {rightSub && <span className={`block text-xs ${urgent ? 'text-red-600' : 'text-stone-400'}`}>{rightSub}</span>}
      </span>
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-5 text-center text-sm text-stone-500">
      {children}
    </div>
  )
}

function GoalRow({ goal, saved, account }) {
  // Save-up progress comes from logged contributions; pay-down progress is how
  // far the linked account's balance has fallen from where it started.
  const isSaveUp = goal.kind === 'save_up'
  const starting = Number(goal.starting_balance) || 0
  const current = account ? Number(account.value) : starting
  const pct = isSaveUp
    ? goal.target_amount > 0
      ? (saved / goal.target_amount) * 100
      : 0
    : starting > 0
      ? ((starting - current) / starting) * 100
      : 0

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-stone-900">
          {goal.icon} {goal.name}
        </span>
        <span className="text-stone-500">
          {isSaveUp
            ? `${formatAED(saved)} / ${formatAED(goal.target_amount)}`
            : `${formatAED(current)} left of ${formatAED(starting)}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  )
}
