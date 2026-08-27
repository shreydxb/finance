import { useEffect, useState } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory, GROUPS } from '../lib/categories'
import { listAccounts, updateAccount } from '../lib/accounts'
import { listRecurring } from '../lib/recurring'
import { listBudgets } from '../lib/budgets'
import { listTransactions } from '../lib/transactions'
import { getSetting, saveTelegramSettings, upsertSetting } from '../lib/settings'
import {
  describeConfiguration,
  payableAccounts,
  validateTelegramSettings,
} from '../lib/telegramSettings'
import { computeFireTarget, monthlyRecurringTotal, trailingMonthsRange, budgetVsActual, yearsToFire } from '../lib/fire'
import { participatingNetWorth } from '../lib/forecast'
import { formatMoney } from '../lib/money'
import { supabase } from '../lib/supabaseClient'
import CategoryForm from '../components/CategoryForm'
import { usePrefs } from '../lib/PrefsContext'
import { ErrorState, LoadingState } from '../design-system'

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// How far back the FIRE card's budget-vs-actual comparison looks. Kept
// separate from fire_expense's own derivation (which a household member
// verifies by hand each time it's recomputed) so this stays a lightweight,
// always-current comparison rather than another number someone has to
// remember to update.
const BUDGET_TRAILING_MONTHS = 6

const BUCKETS = [
  { value: '', label: 'Unassigned' },
  { value: 'joint', label: 'Joint' },
  { value: 'emergency_house', label: 'Emergency + House' },
  { value: 'shrey_personal', label: 'Shrey Personal' },
  { value: 'wife_personal', label: 'Tarika Personal' },
]

export default function Settings() {
  const { refreshFx } = usePrefs()
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [split, setSplit] = useState({ shrey: 0.69, tarika: 0.31 })
  const [splitDraft, setSplitDraft] = useState({ shrey: '69', tarika: '31' })
  const [savingSplit, setSavingSplit] = useState(false)
  const [splitError, setSplitError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // category, or 'new'
  const [fxRates, setFxRates] = useState(null)
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null)
  const [refreshingFx, setRefreshingFx] = useState(false)
  const [fxError, setFxError] = useState('')
  const [recurring, setRecurring] = useState([])
  const [budgets, setBudgets] = useState([])
  const [trailingTxns, setTrailingTxns] = useState([])
  const [fireSwr, setFireSwr] = useState(0.04)
  const [fireReturn, setFireReturn] = useState(0.07)
  const [fireExpense, setFireExpense] = useState(null)
  const [fireDraft, setFireDraft] = useState('')
  const [savingFire, setSavingFire] = useState(false)
  const [fireError, setFireError] = useState('')

  async function loadFx() {
    const { data } = await supabase.from('settings').select('value, updated_at').eq('key', 'fx_rates').maybeSingle()
    setFxRates(data?.value ?? null)
    setFxUpdatedAt(data?.updated_at ?? null)
  }

  async function handleRefreshFx() {
    setRefreshingFx(true)
    setFxError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('refresh-fx', { method: 'POST' })
      if (fnError || data?.ok === false) throw new Error(data?.error || fnError?.message || 'refresh failed')
      // Both copies, or the app keeps formatting every screen with the rates it
      // read at login while this panel shows the new ones.
      await Promise.all([loadFx(), refreshFx()])
    } catch {
      setFxError('Could not refresh FX rates. Try again.')
    } finally {
      setRefreshingFx(false)
    }
  }

  async function refresh() {
    setError('')
    try {
      const { from, to } = trailingMonthsRange(BUDGET_TRAILING_MONTHS)
      const [cats, accts, recurringRows, budgetRows, txns, splitSetting, swrSetting, returnSetting, expenseSetting] =
        await Promise.all([
          listCategories(),
          listAccounts(),
          listRecurring(),
          listBudgets(),
          listTransactions({ dateFrom: from, dateTo: to }), // trailingMonthsRange's `to` is inclusive
          getSetting('income_split'),
          getSetting('fire_swr'),
          getSetting('fire_return'),
          getSetting('fire_expense'),
          loadFx(),
        ])
      setCategories(cats)
      setAccounts(accts)
      setRecurring(recurringRows)
      setBudgets(budgetRows)
      setTrailingTxns(txns)
      if (splitSetting) {
        setSplit(splitSetting)
        setSplitDraft({
          shrey: String(Math.round(splitSetting.shrey * 100)),
          tarika: String(Math.round(splitSetting.tarika * 100)),
        })
      }
      if (swrSetting != null) setFireSwr(Number(swrSetting))
      if (returnSetting != null) setFireReturn(Number(returnSetting))
      if (expenseSetting != null) {
        setFireExpense(Number(expenseSetting))
        setFireDraft(String(Number(expenseSetting)))
      }
    } catch {
      setError('Could not load settings. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSave(values) {
    if (editing && editing !== 'new') {
      await updateCategory(editing.id, values)
    } else {
      await createCategory(values)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id) {
    await deleteCategory(id)
    setEditing(null)
    await refresh()
  }

  async function handleSaveSplit(e) {
    e.preventDefault()
    setSplitError('')
    const shrey = Number(splitDraft.shrey)
    const tarika = Number(splitDraft.tarika)
    if (Number.isNaN(shrey) || Number.isNaN(tarika) || shrey < 0 || tarika < 0) {
      setSplitError('Enter valid percentages.')
      return
    }
    if (Math.round(shrey + tarika) !== 100) {
      setSplitError('Shrey + Tarika must add up to 100%.')
      return
    }
    setSavingSplit(true)
    try {
      const value = { shrey: shrey / 100, tarika: tarika / 100 }
      await upsertSetting('income_split', value)
      setSplit(value)
    } catch {
      setSplitError('Could not save. Try again.')
    } finally {
      setSavingSplit(false)
    }
  }

  async function handleSaveFire(e) {
    e.preventDefault()
    setFireError('')
    const expense = Number(fireDraft)
    if (!Number.isFinite(expense) || expense <= 0) {
      setFireError('Enter a monthly expense above zero.')
      return
    }
    setSavingFire(true)
    try {
      await upsertSetting('fire_expense', expense)
      setFireExpense(expense)
    } catch {
      setFireError('Could not save. Try again.')
    } finally {
      setSavingFire(false)
    }
  }

  async function handleBucketChange(accountId, bucket) {
    await updateAccount(accountId, { bucket: bucket || null })
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10"><LoadingState label="Loading…" /></div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {error && (
        <div className="mb-4"><ErrorState title={error} /></div>
      )}

      <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink-900">Household split</h2>
        <p className="mb-4 text-sm text-ink-500">
          Target contribution ratio, used by Cash Flow's person breakdown. Currently {Math.round(split.shrey * 100)}/
          {Math.round(split.tarika * 100)}.
        </p>
        <form onSubmit={handleSaveSplit} className="flex items-end gap-3">
          <div>
            <label htmlFor="shrey-split" className="mb-1 block text-xs font-medium text-ink-700">
              Shrey %
            </label>
            <input
              id="shrey-split"
              type="number"
              value={splitDraft.shrey}
              onChange={(e) => setSplitDraft((s) => ({ ...s, shrey: e.target.value }))}
              className="w-20 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>
          <div>
            <label htmlFor="tarika-split" className="mb-1 block text-xs font-medium text-ink-700">
              Tarika %
            </label>
            <input
              id="tarika-split"
              type="number"
              value={splitDraft.tarika}
              onChange={(e) => setSplitDraft((s) => ({ ...s, tarika: e.target.value }))}
              className="w-20 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          </div>
          <button
            type="submit"
            disabled={savingSplit}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {savingSplit ? 'Saving…' : 'Save'}
          </button>
        </form>
        {splitError && (
          <p role="alert" className="mt-2 text-sm text-neg-600">
            {splitError}
          </p>
        )}
      </div>

      <FireCard
        fireExpense={fireExpense}
        fireDraft={fireDraft}
        setFireDraft={setFireDraft}
        fireSwr={fireSwr}
        fireReturn={fireReturn}
        onSave={handleSaveFire}
        saving={savingFire}
        error={fireError}
        accounts={accounts}
        recurring={recurring}
        fxRates={fxRates}
        budgets={budgets}
        trailingTxns={trailingTxns}
        trailingMonths={BUDGET_TRAILING_MONTHS}
      />

      <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink-900">Currency rates</h2>
          <button
            type="button"
            onClick={handleRefreshFx}
            disabled={refreshingFx}
            className="shrink-0 rounded-lg border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 disabled:opacity-50"
          >
            {refreshingFx ? 'Refreshing…' : '↻ Refresh rates'}
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-500">
          Used to convert every figure into the AED/USD/INR toggle in the header. Fetched live, not quoted or guessed.
        </p>
        {fxRates ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-ink-700">
              <span className="font-medium text-ink-900">1 USD</span> = {fxRates.USD?.toFixed(4)} AED
            </span>
            <span className="text-ink-700">
              <span className="font-medium text-ink-900">1 INR</span> = {fxRates.INR?.toFixed(4)} AED
            </span>
          </div>
        ) : (
          <p className="text-sm text-ink-500">No rates yet — tap Refresh rates.</p>
        )}
        {fxUpdatedAt && <p className="mt-2 text-xs text-ink-400">Last updated {formatRelativeTime(fxUpdatedAt)}</p>}
        {fxError && (
          <p role="alert" className="mt-2 text-sm text-neg-600">
            {fxError}
          </p>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink-900">Four-account structure</h2>
        <p className="mb-4 text-sm text-ink-500">
          Label which bucket each account belongs to. Descriptive only — no money moves automatically.
        </p>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-500">No accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-ink-900">{a.name}</span>
                <select
                  value={a.bucket ?? ''}
                  onChange={(e) => handleBucketChange(a.id, e.target.value)}
                  className="rounded-lg border border-ink-300 px-2 py-1.5 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                >
                  {BUCKETS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <TelegramIntake accounts={accounts} />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-900">Categories</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + Add category
        </button>
      </div>

      <div className="space-y-5">
        {GROUPS.map((group) => {
          const items = categories.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">{group}</h3>
              <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setEditing(c)}
                    className="flex w-full items-center gap-2 border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
                  >
                    <span>{c.icon || '❓'}</span>
                    <span className="font-medium text-ink-900">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <CategoryForm
          category={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

/**
 * FIRE target = 12x fire_expense / fire_swr — the small static version
 * (Taskiv #21), not Monarch's Forecasting feature (that's the "Forecast"
 * card on Accounts, built separately for #24 and deliberately not merged
 * with this). fire_expense should come from real trailing spend, not a
 * guess — see CLAUDE.md's money-data rule.
 */
function FireCard({
  fireExpense,
  fireDraft,
  setFireDraft,
  fireSwr,
  fireReturn,
  onSave,
  saving,
  error,
  accounts,
  recurring,
  fxRates,
  budgets,
  trailingTxns,
  trailingMonths,
}) {
  const target = computeFireTarget(fireExpense, fireSwr)
  const netWorth = fxRates ? participatingNetWorth(accounts, fxRates, null) : null
  const monthlyIncome = fxRates ? monthlyRecurringTotal(recurring, 'income', fxRates) : null
  const monthlySavings = fireExpense != null && monthlyIncome != null ? monthlyIncome - fireExpense : null
  const years =
    target != null && netWorth != null && monthlySavings != null
      ? yearsToFire({ startNetWorth: netWorth, fireTarget: target, monthlyNetSavings: monthlySavings, annualReturnPct: fireReturn * 100 })
      : null
  const comparisonRows = fxRates ? budgetVsActual(budgets, trailingTxns, fxRates, trailingMonths) : []

  return (
    <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
      <h2 className="mb-1 text-lg font-semibold text-ink-900">FIRE number</h2>
      <p className="mb-4 text-sm text-ink-500">
        Target = 12 months of expenses ÷ {Math.round(fireSwr * 100)}% safe withdrawal rate.
      </p>

      {target != null && (
        <div className="mb-4 space-y-1">
          <p className="text-2xl font-semibold text-ink-900">{formatMoney(target, 'AED')}</p>
          {years != null && (
            <p className="text-sm text-ink-500">
              ~{years.toFixed(1)} years away at current net worth ({formatMoney(netWorth, 'AED')}) and savings rate (
              {formatMoney(monthlySavings, 'AED')}/mo), growing {Math.round(fireReturn * 100)}%/yr.
            </p>
          )}
          {years == null && monthlySavings != null && monthlySavings <= 0 && (
            <p className="text-sm text-neg-600">Current recurring income doesn&apos;t cover this expense figure — savings rate is zero or negative.</p>
          )}
        </div>
      )}

      <form onSubmit={onSave} className="flex items-end gap-3">
        <div>
          <label htmlFor="fire-expense" className="mb-1 block text-xs font-medium text-ink-700">
            Monthly expense (AED)
          </label>
          <input
            id="fire-expense"
            type="number"
            step="0.01"
            value={fireDraft}
            onChange={(e) => setFireDraft(e.target.value)}
            className="w-40 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-neg-600">
          {error}
        </p>
      )}

      {comparisonRows.length > 0 && (
        <div className="mt-5 border-t border-ink-100 pt-4">
          <h3 className="mb-1 text-sm font-semibold text-ink-900">Budget vs. actual</h3>
          <p className="mb-3 text-xs text-ink-500">
            Trailing {trailingMonths} full months, monthly average. The FIRE number above is built from actual spend, not
            the budget — a category with real spend and no budget row (marked below) is exactly why: a budget with gaps
            would understate this figure.
          </p>
          <div className="overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Budget/mo</th>
                  <th className="px-3 py-2 text-right font-medium">Actual/mo</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.category} className="border-b border-ink-100 last:border-b-0">
                    <td className="px-3 py-1.5 font-medium text-ink-900">
                      {row.category}
                      {!row.hasBudget && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          No budget line
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tnum text-ink-700">
                      {row.hasBudget ? formatMoney(row.budgetMonthly, 'AED') : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tnum text-ink-900">{formatMoney(row.actualMonthly, 'AED')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const PERSON_KEYS = ['tg_id_1', 'tg_id_2']

/** Shape the backend expects for a person slot; both fields or neither. */
function personValue(entry) {
  const name = entry.person.trim()
  const id = entry.telegramUserId.trim()
  return name && id ? { person: name, telegram_user_id: Number(id) } : null
}

/**
 * Configures the telegram-intake Edge Function. The two Telegram user ids are
 * the function's allowlist: until both are filled in it accepts nothing, so
 * this screen is the switch that turns intake on.
 */
function TelegramIntake({ accounts }) {
  const [people, setPeople] = useState(PERSON_KEYS.map(() => ({ person: '', telegramUserId: '' })))
  const [threshold, setThreshold] = useState('85')
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [p1, p2, rawThreshold, rawAccount] = await Promise.all([
          getSetting('tg_id_1'),
          getSetting('tg_id_2'),
          getSetting('ai_confidence_threshold'),
          getSetting('tg_default_account_id'),
        ])
        if (cancelled) return
        setPeople(
          [p1, p2].map((entry) => ({
            person: entry?.person ?? '',
            telegramUserId: entry?.telegram_user_id == null ? '' : String(entry.telegram_user_id),
          }))
        )
        if (rawThreshold != null) setThreshold(String(Math.round(Number(rawThreshold) * 100)))
        if (typeof rawAccount === 'string') setDefaultAccountId(rawAccount)
      } catch {
        if (!cancelled) setError('Could not load Telegram settings.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function updatePerson(index, patch) {
    setPeople((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setStatus('')

    // One set of rules, shared with the backend's own (UI-03). This screen used
    // to accept an id with no name — which the Edge Function silently drops —
    // and report the person as configured.
    const check = validateTelegramSettings({
      people,
      thresholdPercent: threshold,
      defaultAccountId,
      accounts: payable,
    })
    if (!check.ok) {
      setError(check.error)
      return
    }

    setSaving(true)
    try {
      // One transaction, not four concurrent upserts. A partial save left the
      // household believing a configuration was stored while the bot read
      // something else.
      await saveTelegramSettings({
        person1: personValue(people[0]),
        person2: personValue(people[1]),
        threshold: Number(threshold) / 100,
        defaultAccountId: defaultAccountId || null,
      })
      setStatus('Saved.')
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  // Describes what the bot will actually do, rather than asserting it does
  // nothing until both slots are filled — which was untrue with one configured.
  const configuration = describeConfiguration(people)
  // The bot only matches receipts against cash and credit cards; offering
  // anything else meant a silent no-op when chosen.
  const payable = payableAccounts(accounts)

  return (
    <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
      <h2 className="mb-1 text-lg font-semibold text-ink-900">Telegram intake</h2>
      <p className="mb-4 text-sm text-ink-500">
        Who the bot accepts spends from. Send <code className="rounded bg-ink-100 px-1">/id</code> to the bot in your
        group to get each number. {configuration.message}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {people.map((person, i) => (
          <div key={PERSON_KEYS[i]} className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`tg-person-${i}`} className="mb-1 block text-xs font-medium text-ink-700">
                Person {i + 1}
              </label>
              <input
                id={`tg-person-${i}`}
                type="text"
                value={person.person}
                onChange={(e) => updatePerson(i, { person: e.target.value })}
                placeholder="Name"
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
            <div>
              <label htmlFor={`tg-id-${i}`} className="mb-1 block text-xs font-medium text-ink-700">
                Telegram user id
              </label>
              <input
                id={`tg-id-${i}`}
                type="text"
                inputMode="numeric"
                value={person.telegramUserId}
                onChange={(e) => updatePerson(i, { telegramUserId: e.target.value })}
                placeholder="e.g. 123456789"
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tg-threshold" className="mb-1 block text-xs font-medium text-ink-700">
              Auto-log above
            </label>
            <div className="flex items-center gap-2">
              <input
                id="tg-threshold"
                type="number"
                min="0"
                max="100"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-20 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
              <span className="text-sm text-ink-500">% confidence</span>
            </div>
          </div>
          <div>
            <label htmlFor="tg-default-account" className="mb-1 block text-xs font-medium text-ink-700">
              Fallback account
            </label>
            <select
              id="tg-default-account"
              value={defaultAccountId}
              onChange={(e) => setDefaultAccountId(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">Flag for review instead</option>
              {payable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-ink-400">
          Below the threshold — or when the amount, category or account can&apos;t be resolved — the spend is still
          logged, flagged “Needs review”, and the bot asks you to confirm or fix it.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {status && <span className="text-sm text-ink-500">{status}</span>}
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-neg-600">
          {error}
        </p>
      )}
    </div>
  )
}
