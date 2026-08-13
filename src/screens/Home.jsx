import { useEffect, useState } from 'react'
import { countNeedsReview, listTransactions } from '../lib/transactions'
import { listIncome } from '../lib/income'
import { listBudgets } from '../lib/budgets'
import { listRecurring, nextDueDate, daysUntil } from '../lib/recurring'
import { listGoals, listAllContributions } from '../lib/goals'
import { listAccounts } from '../lib/accounts'
import { getSetting } from '../lib/settings'
import { toAED } from '../lib/money'
import { currentYearMonth, monthLabel, monthRange } from '../lib/period'
import { usePrefs } from '../lib/PrefsContext'
import { totalAED } from '../lib/reports'
import NetWorthHero from '../components/NetWorthHero'

const DUE_SOON_DAYS = 14
const RECENT_LIMIT = 5
const TOP_GOALS = 3

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
  const { fmt } = usePrefs()
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
        <p role="alert" className="rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      </div>
    )
  }

  if (!data) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  const { fxRates } = data
  // Same function Cash Flow uses (excludes Transfer-category rows — a fund
  // transfer between the household's own accounts isn't a spend), so the two
  // screens can never disagree.
  const spent = totalAED(data.monthTxns, fxRates)
  const earned = data.income.reduce((sum, i) => sum + toAED(Number(i.amount) || 0, i.currency, fxRates), 0)
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
  // This widget is "what you're saving toward" — debts have their own Home
  // tile via... nowhere yet, but at minimum they shouldn't masquerade as goals.
  const topGoals = data.goals.filter((g) => g.kind === 'save_up').slice(0, TOP_GOALS)

  const investmentAccounts = data.accounts.filter((a) => a.type === 'investment')
  const investmentsTotal = investmentAccounts.reduce(
    (sum, a) => sum + toAED(Number(a.value) || 0, a.currency, fxRates),
    0
  )
  const investmentCount = investmentAccounts.length

  const isEmpty = data.accounts.length === 0 && data.recent.length === 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Desktop-first dashboard: hero + month stats span the top, then the
          three feeds sit side by side instead of stacking into a long phone
          column. Collapses to one column under lg. */}
      <div className="stagger">
        <NetWorthHero accounts={data.accounts} fxRates={fxRates} />

        {isEmpty && (
          <div className="mt-6 rounded-2xl border border-ink-200 bg-surface p-5 text-sm text-ink-600 shadow-card">
            <p className="mb-1 font-medium text-ink-900">Nothing here yet</p>
            <p>Add an account to see your net worth, then log spends from the Transactions tab or straight from Telegram.</p>
            <button type="button" onClick={() => onNavigate?.('Accounts')}
              className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700">
              Add an account
            </button>
          </div>
        )}

        {data.reviewCount > 0 && (
          <button type="button" onClick={() => onNavigate?.('Transactions')}
            className="mt-6 flex w-full items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 transition-colors hover:bg-amber-100">
            <span>{data.reviewCount} {data.reviewCount === 1 ? 'transaction needs' : 'transactions need'} a review</span>
            <span aria-hidden="true">→</span>
          </button>
        )}

        <Section title={data.label} action="Reports" onAction={() => onNavigate?.('Reports')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Spent" value={fmt(spent)} />
            <StatCard label="Budget" value={budgeted > 0 ? fmt(budgeted) : '—'}
              hint={budgeted > 0 ? `${fmt(Math.max(0, budgeted - spent))} left` : 'not set'} />
            <StatCard label="Savings rate" value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
              hint={earned > 0 ? `of ${fmt(earned)}` : 'no income logged'}
              tone={savingsRate !== null && savingsRate < 0 ? 'bad' : 'plain'} />
            <StatCard label="Investments" value={fmt(investmentsTotal)} hint={`${investmentCount} holdings`} />
          </div>
        </Section>

        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <Section title="Due soon" action="Recurring" onAction={() => onNavigate?.('Recurring')} inGrid>
            {dueSoon.length === 0 ? (
              <Empty>Nothing due in the next {DUE_SOON_DAYS} days.</Empty>
            ) : (
              <Rows>
                {dueSoon.slice(0, 6).map(({ entry, days }) => (
                  <Row key={entry.id} left={entry.name}
                    sub={`${entry.kind === 'emi' ? 'EMI' : 'Bill'}${entry.autopay ? ' · autopay' : ''}`}
                    right={fmt(toAED(Number(entry.amount) || 0, entry.currency, fxRates))}
                    rightSub={formatDueIn(days)} urgent={days <= 3}
                    onClick={() => onNavigate?.('Recurring', { openRecurringId: entry.id })} />
                ))}
              </Rows>
            )}
          </Section>

          <Section title="Recent" action="Transactions" onAction={() => onNavigate?.('Transactions')} inGrid>
            {data.recent.length === 0 ? (
              <Empty>No transactions yet.</Empty>
            ) : (
              <Rows>
                {data.recent.map((t) => (
                  <Row key={t.id} left={t.category || 'Uncategorised'}
                    sub={[t.owner, t.note].filter(Boolean).join(' · ')}
                    right={fmt(toAED(Number(t.amount) || 0, t.currency, fxRates))}
                    rightSub={formatDay(t.date)}
                    badge={t.needs_review ? 'Needs review' : null}
                    onClick={() => onNavigate?.('Transactions', { openTransactionId: t.id })} />
                ))}
              </Rows>
            )}
          </Section>

          <Section title="Goals" action="Goals" onAction={() => onNavigate?.('Goals')} inGrid>
            {topGoals.length === 0 ? (
              <Empty>No goals yet.</Empty>
            ) : (
              <div className="space-y-2">
                {topGoals.map((g) => (
                  <GoalRow key={g.id} goal={g} saved={savedByGoal.get(g.id) || 0}
                    account={accountById.get(g.linked_account_id)} fmt={fmt}
                    onClick={() => onNavigate?.('Goals', { openGoalId: g.id })} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, action, onAction, children, inGrid }) {
  return (
    <section className={inGrid ? '' : 'mt-6'}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">{title}</h2>
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="group text-xs font-medium text-ink-500 transition-colors hover:text-brand-600"
          >
            {action}{' '}
            <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function StatCard({ label, value, hint, tone = 'plain' }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`tnum mt-1 text-lg font-semibold tracking-tight ${tone === 'bad' ? 'text-neg-600' : 'text-ink-900'}`}>
        {value}
      </p>
      {hint && <p className="tnum mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  )
}

function Rows({ children }) {
  return <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">{children}</div>
}

function Row({ left, sub, right, rightSub, urgent, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink-900">{left}</span>
          {badge && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
              {badge}
            </span>
          )}
        </span>
        {sub && <span className="block truncate text-xs text-ink-400">{sub}</span>}
      </span>
      <span className="shrink-0 pl-2 text-right">
        <span className="tnum block font-medium text-ink-700">{right}</span>
        {rightSub && <span className={`block text-xs ${urgent ? 'text-neg-600' : 'text-ink-400'}`}>{rightSub}</span>}
      </span>
    </button>
  )
}

function Empty({ children }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-surface shadow-card px-4 py-5 text-center text-sm text-ink-500">
      {children}
    </div>
  )
}

function GoalRow({ goal, saved, account, fmt, onClick }) {
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
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border border-ink-200 bg-surface p-4 text-left shadow-card hover:bg-ink-50"
    >
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-ink-900">
          {goal.icon} {goal.name}
        </span>
        <span className="tnum text-xs text-ink-500">
          {isSaveUp ? `${fmt(saved)} / ${fmt(goal.target_amount)}` : `${fmt(current)} left of ${fmt(starting)}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full origin-left rounded-full bg-gradient-to-r from-brand-500 to-brand-700"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, animation: 'grow .8s cubic-bezier(.16,1,.3,1) both' }}
        />
      </div>
    </button>
  )
}
