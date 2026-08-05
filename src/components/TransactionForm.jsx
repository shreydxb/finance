import { useState } from 'react'
import { OWNERS } from '../lib/accounts'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function sumSplits(lines) {
  return lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
}

export default function TransactionForm({ transaction, accounts, categories, onSave, onCancel, onDelete }) {
  const isEdit = Boolean(transaction)
  const isSplitEdit = isEdit && transaction.splitGroup

  const [date, setDate] = useState(transaction?.date ?? today())
  const [amount, setAmount] = useState(transaction && !isSplitEdit ? String(transaction.amount) : '')
  const [currency, setCurrency] = useState(transaction?.currency ?? 'AED')
  const [accountId, setAccountId] = useState(transaction?.account_id ?? accounts[0]?.id ?? '')
  const [category, setCategory] = useState(transaction && !isSplitEdit ? transaction.category : categories[0]?.name ?? '')
  const [owner, setOwner] = useState(transaction?.owner ?? OWNERS[0])
  const [note, setNote] = useState(transaction?.note ?? '')
  const [tagsInput, setTagsInput] = useState(transaction?.tags?.join(', ') ?? '')
  const [split, setSplit] = useState(Boolean(isSplitEdit))
  const [splitLines, setSplitLines] = useState(
    isSplitEdit
      ? transaction.splitGroup.map((t) => ({ category: t.category, amount: String(t.amount) }))
      : [
          { category: categories[0]?.name ?? '', amount: '' },
          { category: categories[1]?.name ?? categories[0]?.name ?? '', amount: '' },
        ]
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const splitTotal = sumSplits(splitLines)

  function updateSplitLine(index, patch) {
    setSplitLines((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addSplitLine() {
    setSplitLines((lines) => [...lines, { category: categories[0]?.name ?? '', amount: '' }])
  }

  function removeSplitLine(index) {
    setSplitLines((lines) => lines.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!accountId) {
      setError('Choose an account.')
      return
    }
    if (!owner) {
      setError('Owner is required.')
      return
    }
    if (!split && (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0)) {
      setError('Enter a valid amount.')
      return
    }
    if (split) {
      const invalidLine = splitLines.some((l) => !l.category || !l.amount || Number(l.amount) <= 0)
      if (invalidLine) {
        setError('Every split line needs a category and an amount greater than 0.')
        return
      }
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const baseFields = { date, currency, account_id: accountId, owner, note: note.trim() || null, tags }

    setSubmitting(true)
    try {
      if (split) {
        await onSave({
          split: true,
          baseFields,
          splitLines: splitLines.map((l) => ({ category: l.category, amount: Number(l.amount) })),
        })
      } else {
        await onSave({ split: false, fields: { ...baseFields, amount: Number(amount), category } })
      }
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-stone-900">{isEdit ? 'Edit transaction' : 'Add transaction'}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="date" className="mb-1 block text-sm font-medium text-stone-700">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="owner" className="mb-1 block text-sm font-medium text-stone-700">
                Owner
              </label>
              <select
                id="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
              >
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            {!split && (
              <div>
                <label htmlFor="amount" className="mb-1 block text-sm font-medium text-stone-700">
                  Amount
                </label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
            )}
            <div className={split ? 'col-span-2' : ''}>
              <label htmlFor="currency" className="mb-1 block text-sm font-medium text-stone-700">
                Currency
              </label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={split ? 'w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none' : 'w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none'}
              >
                {['AED', 'USD', 'INR'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="account" className="mb-1 block text-sm font-medium text-stone-700">
              Account
            </label>
            <select
              id="account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {!split ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="category" className="block text-sm font-medium text-stone-700">
                  Category
                </label>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (amount) setSplitLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, amount } : l)))
                      setSplit(true)
                    }}
                    className="text-xs font-medium text-stone-500 underline hover:text-stone-700"
                  >
                    Split across categories
                  </button>
                )}
              </div>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-sm font-medium text-stone-700">Split</span>
                <button
                  type="button"
                  onClick={() => {
                    setAmount(String(splitTotal || ''))
                    setCategory(splitLines[0]?.category ?? categories[0]?.name ?? '')
                    setSplit(false)
                  }}
                  className="text-xs font-medium text-stone-500 underline hover:text-stone-700"
                >
                  Use one category
                </button>
              </div>
              <div className="space-y-2">
                {splitLines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={line.category}
                      onChange={(e) => updateSplitLine(i, { category: e.target.value })}
                      className="flex-1 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={line.amount}
                      onChange={(e) => updateSplitLine(i, { amount: e.target.value })}
                      className="w-24 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
                      placeholder="0.00"
                    />
                    {splitLines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeSplitLine(i)}
                        className="px-1 text-stone-400 hover:text-red-600"
                        aria-label="Remove split line"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addSplitLine} className="mt-2 text-xs font-medium text-stone-500 underline hover:text-stone-700">
                + Add category
              </button>
              <p className="mt-2 text-xs font-medium text-stone-700">
                Total: {splitTotal.toFixed(2)} {currency}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium text-stone-700">
              Note
            </label>
            <input
              id="note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
              placeholder="optional"
            />
          </div>

          <div>
            <label htmlFor="tags" className="mb-1 block text-sm font-medium text-stone-700">
              Tags
            </label>
            <input
              id="tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
              placeholder="comma, separated, optional"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
