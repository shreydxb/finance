import { useEffect, useState } from 'react'
import {
  createAccount,
  updateAccount,
  deleteAccount,
  ASSET_TYPES,
  LIABILITY_TYPES,
  typeLabel,
  typeIcon,
} from '../lib/accounts'
import { toAED } from '../lib/settings'
import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import { listTransactions, createTransaction, updateTransaction } from '../lib/transactions'
import { listCategories } from '../lib/categories'
import AccountForm from '../components/AccountForm'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'
import NetWorthHero from '../components/NetWorthHero'
import NetWorthBreakdown from '../components/NetWorthBreakdown'

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}AED ${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

function formatValue(value, currency) {
  return `${currency} ${Number(value).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`
}

export default function Accounts() {
  const { accounts, fxRates, loading, error, refresh } = useAccountsAndFx()
  const [editing, setEditing] = useState(null) // account being edited, or 'new'
  const [groupBy, setGroupBy] = useState('type')
  const [viewingAccount, setViewingAccount] = useState(null) // account whose detail view is open

  const assetGroups = groupByType(accounts.filter((a) => !a.is_liability), ASSET_TYPES, fxRates)
  const liabilityGroups = groupByType(accounts.filter((a) => a.is_liability), LIABILITY_TYPES, fxRates)

  async function handleSave(values) {
    if (editing && editing !== 'new') {
      await updateAccount(editing.id, values)
    } else {
      await createAccount(values)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id) {
    await deleteAccount(id)
    setEditing(null)
    setViewingAccount(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading accounts…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <NetWorthHero accounts={accounts} fxRates={fxRates} />
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mb-6">
        <NetWorthBreakdown accounts={accounts} fxRates={fxRates} groupBy={groupBy} onGroupByChange={setGroupBy} />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Accounts</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
        >
          + Add account
        </button>
      </div>

      <AccountGroupList title="Assets" groups={assetGroups} onSelect={setViewingAccount} />
      <AccountGroupList title="Liabilities" groups={liabilityGroups} onSelect={setViewingAccount} />

      {accounts.length === 0 && (
        <p className="py-10 text-center text-sm text-stone-500">
          No accounts yet. Add your first one — manual entry only, no bank connection needed.
        </p>
      )}

      {viewingAccount && !editing && (
        <AccountDetail
          account={viewingAccount}
          onClose={() => setViewingAccount(null)}
          onEdit={() => setEditing(viewingAccount)}
        />
      )}

      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

function AccountDetail({ account, onClose, onEdit }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingTxn, setAddingTxn] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [txns, cats] = await Promise.all([
        listTransactions({ accountId: account.id }),
        listCategories(),
      ])
      setTransactions(txns)
      setCategories(cats)
    } catch {
      setError('Could not load this account’s transactions. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id])

  async function handleCategoryChange(id, category) {
    await updateTransaction(id, { category: category || null })
    await refresh()
  }

  async function handleAddTxn(result) {
    if (result.split) return // splits aren't offered from this pre-filled form
    await createTransaction(result.fields)
    setAddingTxn(false)
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              {typeIcon(account.type)} {account.name}
            </h2>
            <p className="text-xs text-stone-400">
              {typeLabel(account.type)} · {account.owner}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-stone-400 hover:text-stone-600">
            Close
          </button>
        </div>

        <p className="my-3 text-2xl font-semibold text-stone-900">{formatValue(account.value, account.currency)}</p>

        <div className="mb-5 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Edit account
          </button>
          <button
            type="button"
            onClick={() => setAddingTxn(true)}
            className="flex-1 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            + Add transaction
          </button>
        </div>

        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Transactions</h3>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-stone-500">Loading…</p>
        ) : (
          <TransactionList
            transactions={transactions}
            accountName={() => account.name}
            flat
            onEntryClick={() => {}}
            categories={categories}
            onCategoryChange={handleCategoryChange}
            emptyMessage="No transactions logged against this account yet."
          />
        )}

        {addingTxn && (
          <TransactionForm
            prefill={{ account_id: account.id, currency: account.currency, owner: account.owner }}
            accounts={[account]}
            categories={categories}
            onSave={handleAddTxn}
            onCancel={() => setAddingTxn(false)}
          />
        )}
      </div>
    </div>
  )
}

function groupByType(accounts, typeDefs, fxRates) {
  return typeDefs
    .map((t) => {
      const items = accounts.filter((a) => a.type === t.value)
      const subtotalAED = items.reduce((sum, a) => sum + toAED(Number(a.value) || 0, a.currency, fxRates), 0)
      return { type: t.value, items, subtotalAED }
    })
    .filter((g) => g.items.length > 0)
}

function AccountGroupList({ title, groups, onSelect }) {
  if (groups.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.type} className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5">
              <span className="text-sm font-medium text-stone-700">
                {typeIcon(g.type)} {typeLabel(g.type)}
              </span>
              <span className="text-sm font-semibold text-stone-900">{formatAED(g.subtotalAED)}</span>
            </div>
            <ul>
              {g.items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(a)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-stone-50"
                  >
                    <span>
                      <span className="font-medium text-stone-900">{a.name}</span>
                      <span className="ml-2 text-stone-400">{a.owner}</span>
                    </span>
                    <span className="text-stone-700">{formatValue(a.value, a.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
