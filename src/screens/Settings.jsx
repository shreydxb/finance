import { useEffect, useState } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory, GROUPS } from '../lib/categories'
import { listAccounts, updateAccount } from '../lib/accounts'
import { getSetting, upsertSetting } from '../lib/settings'
import { supabase } from '../lib/supabaseClient'
import CategoryForm from '../components/CategoryForm'

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

const BUCKETS = [
  { value: '', label: 'Unassigned' },
  { value: 'joint', label: 'Joint' },
  { value: 'emergency_house', label: 'Emergency + House' },
  { value: 'shrey_personal', label: 'Shrey Personal' },
  { value: 'wife_personal', label: 'Tarika Personal' },
]

export default function Settings() {
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
      await loadFx()
    } catch {
      setFxError('Could not refresh FX rates. Try again.')
    } finally {
      setRefreshingFx(false)
    }
  }

  async function refresh() {
    setError('')
    try {
      const [cats, accts, splitSetting] = await Promise.all([
        listCategories(),
        listAccounts(),
        getSetting('income_split'),
        loadFx(),
      ])
      setCategories(cats)
      setAccounts(accts)
      if (splitSetting) {
        setSplit(splitSetting)
        setSplitDraft({
          shrey: String(Math.round(splitSetting.shrey * 100)),
          tarika: String(Math.round(splitSetting.tarika * 100)),
        })
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

  async function handleBucketChange(accountId, bucket) {
    await updateAccount(accountId, { bucket: bucket || null })
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
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

const PERSON_KEYS = ['tg_id_1', 'tg_id_2']

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

    const invalidId = people.some((p) => p.telegramUserId !== '' && !/^\d+$/.test(p.telegramUserId.trim()))
    if (invalidId) {
      setError('A Telegram user id is a plain number — send /id to the bot to get yours.')
      return
    }
    const percent = Number(threshold)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError('Confidence threshold must be between 0 and 100.')
      return
    }

    setSaving(true)
    try {
      await Promise.all([
        ...PERSON_KEYS.map((key, i) =>
          upsertSetting(key, {
            person: people[i].person.trim() || null,
            telegram_user_id: people[i].telegramUserId.trim() ? Number(people[i].telegramUserId.trim()) : null,
          })
        ),
        upsertSetting('ai_confidence_threshold', percent / 100),
        upsertSetting('tg_default_account_id', defaultAccountId || null),
      ])
      setStatus('Saved.')
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const configured = people.filter((p) => p.telegramUserId.trim()).length

  return (
    <div className="mb-6 rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
      <h2 className="mb-1 text-lg font-semibold text-ink-900">Telegram intake</h2>
      <p className="mb-4 text-sm text-ink-500">
        Who the bot accepts spends from. Send <code className="rounded bg-ink-100 px-1">/id</code> to the bot in your
        group to get each number. {configured < 2 && 'Until both are filled in, the bot ignores everything.'}
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
              {accounts.map((a) => (
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
