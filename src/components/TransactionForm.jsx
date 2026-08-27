import { useState } from 'react'
import { OWNERS } from '../lib/accounts'
import { matchRule } from '../lib/categoryRules'
import { todayLocal } from '../lib/dates'
import { Button } from '../design-system'
import ProtectedForm from './ProtectedForm'

function today() {
  return todayLocal()
}

function sumSplits(lines) {
  return lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
}

export default function TransactionForm({
  transaction,
  prefill,
  accounts,
  categories,
  goals = [],
  rules = [],
  onSave,
  onCancel,
  onDelete,
  onCreateRule,
}) {
  const isEdit = Boolean(transaction)
  const isSplitEdit = isEdit && transaction.splitGroup

  const [date, setDate] = useState(transaction?.date ?? today())
  const [amount, setAmount] = useState(transaction && !isSplitEdit ? String(transaction.amount) : '')
  const [currency, setCurrency] = useState(transaction?.currency ?? prefill?.currency ?? 'AED')
  const [accountId, setAccountId] = useState(transaction?.account_id ?? prefill?.account_id ?? accounts[0]?.id ?? '')
  const initialNote = transaction?.note ?? ''
  const initialRuleMatch = !isEdit ? matchRule(rules, initialNote) : null
  const [category, setCategory] = useState(
    transaction && !isSplitEdit ? transaction.category : initialRuleMatch?.category ?? categories[0]?.name ?? ''
  )
  const [owner, setOwner] = useState(transaction?.owner ?? prefill?.owner ?? OWNERS[0])
  const [note, setNote] = useState(initialNote)
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [appliedRule, setAppliedRule] = useState(initialRuleMatch)
  const [saveAsRule, setSaveAsRule] = useState(false)
  const [tagsInput, setTagsInput] = useState(transaction?.tags?.join(', ') ?? '')
  // Display-only tags (Taskiv #24) — never touch a money total. assignedTo is
  // "can you check this one?" aimed at the other person, independent of the
  // reviewed_at reconciliation flag; goalId is "this was for the New Sofa
  // goal", independent of goal_contributions (see lib/transactions.js).
  const [assignedTo, setAssignedTo] = useState(transaction?.assigned_to ?? '')
  const [linkedGoalId, setLinkedGoalId] = useState(transaction?.goal_id ?? '')
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

  function handleNoteChange(value) {
    setNote(value)
    if (isEdit || split || categoryTouched) return
    const match = matchRule(rules, value)
    setAppliedRule(match)
    if (match) setCategory(match.category)
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
        await onSave({
          split: false,
          fields: { ...baseFields, amount: Number(amount), category, assigned_to: assignedTo || null, goal_id: linkedGoalId || null },
        })
        if (saveAsRule && onCreateRule && note.trim()) {
          await onCreateRule(note.trim(), category)
        }
      }
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-ink-900">{isEdit ? 'Edit transaction' : 'Add transaction'}</h2>

        <ProtectedForm onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="date" className="mb-1 block text-sm font-medium text-ink-700">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
            <div>
              <label htmlFor="owner" className="mb-1 block text-sm font-medium text-ink-700">
                Owner
              </label>
              <select
                id="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
                <label htmlFor="amount" className="mb-1 block text-sm font-medium text-ink-700">
                  Amount
                </label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  placeholder="0.00"
                />
              </div>
            )}
            <div className={split ? 'col-span-2' : ''}>
              <label htmlFor="currency" className="mb-1 block text-sm font-medium text-ink-700">
                Currency
              </label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={split ? 'w-32 rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15' : 'w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15'}
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
            <label htmlFor="account" className="mb-1 block text-sm font-medium text-ink-700">
              Account
            </label>
            <select
              id="account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
                <label htmlFor="category" className="block text-sm font-medium text-ink-700">
                  Category
                </label>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (amount) setSplitLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, amount } : l)))
                      setSplit(true)
                    }}
                    className="text-xs font-medium text-ink-500 underline hover:text-ink-700"
                  >
                    Split across categories
                  </button>
                )}
              </div>
              <select
                id="category"
                value={category}
                onChange={(e) => {
                  setCategoryTouched(true)
                  setCategory(e.target.value)
                }}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
              {!isEdit && appliedRule && (
                <p className="mt-1 text-xs text-ink-500">
                  Auto-applied by rule: “{appliedRule.pattern}” → {appliedRule.category}
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-sm font-medium text-ink-700">Split</span>
                <button
                  type="button"
                  onClick={() => {
                    setAmount(String(splitTotal || ''))
                    setCategory(splitLines[0]?.category ?? categories[0]?.name ?? '')
                    setSplit(false)
                  }}
                  className="text-xs font-medium text-ink-500 underline hover:text-ink-700"
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
                      className="flex-1 rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
                      className="w-24 rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                      placeholder="0.00"
                    />
                    {splitLines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeSplitLine(i)}
                        className="px-1 text-ink-400 hover:text-neg-600"
                        aria-label="Remove split line"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addSplitLine} className="mt-2 text-xs font-medium text-ink-500 underline hover:text-ink-700">
                + Add category
              </button>
              <p className="mt-2 text-xs font-medium text-ink-700">
                Total: {splitTotal.toFixed(2)} {currency}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium text-ink-700">
              Note
            </label>
            <input
              id="note"
              type="text"
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="optional"
            />
          </div>

          {!isEdit && !split && note.trim() && category && onCreateRule && (
            <label className="flex items-start gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={saveAsRule}
                onChange={(e) => setSaveAsRule(e.target.checked)}
                className="mt-0.5"
              />
              Always categorize notes containing “{note.trim()}” as {category}
            </label>
          )}

          <div>
            <label htmlFor="tags" className="mb-1 block text-sm font-medium text-ink-700">
              Tags
            </label>
            <input
              id="tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="comma, separated, optional"
            />
          </div>

          {!split && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="assignedTo" className="mb-1 block text-sm font-medium text-ink-700">
                  Ask partner to review
                </label>
                <select
                  id="assignedTo"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                >
                  <option value="">Not assigned</option>
                  {OWNERS.filter((o) => o !== 'Joint').map((o) => (
                    <option key={o} value={o}>
                      Ask {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="linkedGoal" className="mb-1 block text-sm font-medium text-ink-700">
                  Linked goal
                </label>
                <select
                  id="linkedGoal"
                  value={linkedGoalId}
                  onChange={(e) => setLinkedGoalId(e.target.value)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                >
                  <option value="">No goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.icon ? `${g.icon} ` : ''}{g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-neg-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={submitting}
              loading={submitting}
              className="flex-1"
            >
              {submitting ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              onClick={onCancel}
              intent="secondary"
            >
              Cancel
            </Button>
            {isEdit && (
              <Button
                type="button"
                onClick={onDelete}
                intent="danger"
              >
                Delete
              </Button>
            )}
          </div>
        </ProtectedForm>
      </div>
    </div>
  )
}
