import { useRef, useState } from 'react'
import { OWNERS } from '../lib/accounts'
import { matchRule } from '../lib/categoryRules'
import { todayLocal } from '../lib/dates'
import { newManualRequestKey } from '../lib/transactions'
import { Button, Checkbox, ConfirmDialog, Field, Input, Select } from '../design-system'
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
  embedded = false,
  onSave,
  onCancel,
  onDelete,
  onCreateRule,
  allowSplit = true,
  requestKey,
}) {
  const isEdit = Boolean(transaction)
  const isSplitEdit = isEdit && transaction.splitGroup
  const expenseCategories = categories.filter((item) => item.name !== 'Transfer')

  const [date, setDate] = useState(transaction?.date ?? today())
  const [amount, setAmount] = useState(transaction && !isSplitEdit ? String(transaction.amount) : '')
  const [currency, setCurrency] = useState(transaction?.currency ?? prefill?.currency ?? 'AED')
  const [accountId, setAccountId] = useState(transaction?.account_id ?? prefill?.account_id ?? accounts[0]?.id ?? '')
  const initialNote = transaction?.note ?? ''
  const initialRuleMatch = !isEdit ? matchRule(rules, initialNote) : null
  const [category, setCategory] = useState(
    transaction && !isSplitEdit ? transaction.category : initialRuleMatch?.category ?? expenseCategories[0]?.name ?? ''
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
          { category: expenseCategories[0]?.name ?? '', amount: '' },
          { category: expenseCategories[1]?.name ?? expenseCategories[0]?.name ?? '', amount: '' },
        ]
  )
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const manualRequestKey = useRef(requestKey ?? newManualRequestKey())

  const splitTotal = sumSplits(splitLines)

  function updateSplitLine(index, patch) {
    setSplitLines((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addSplitLine() {
    setSplitLines((lines) => [...lines, { category: expenseCategories[0]?.name ?? '', amount: '' }])
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
    setFieldErrors({})

    const nextErrors = {}
    if (!date) nextErrors.date = 'Choose a transaction date.'
    else if (date > today()) nextErrors.date = 'Transaction date cannot be after today in Dubai.'
    if (!accountId) nextErrors.account = 'Choose an account.'
    if (!owner) nextErrors.owner = 'Choose an owner.'
    if (!split && (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount))) {
      nextErrors.amount = 'Enter a positive amount with no more than two decimal places.'
    }
    if (!split && !category) nextErrors.category = 'Choose a category.'
    if (split) {
      const invalidLine = splitLines.some((l) =>
        !l.category || !l.amount || !Number.isFinite(Number(l.amount)) || Number(l.amount) <= 0 || !/^\d+(\.\d{1,2})?$/.test(l.amount)
      )
      if (invalidLine) {
        nextErrors.split = 'Every split line needs a live category and a positive amount with no more than two decimal places.'
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
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
          requestKey: isEdit ? null : manualRequestKey.current,
          rule: saveAsRule && onCreateRule && note.trim() ? { pattern: note.trim(), category } : null,
        })
      }
    } catch (saveError) {
      if (saveError?.field && saveError.field !== 'general') setFieldErrors({ [saveError.field]: saveError.message })
      else setError(saveError?.field === 'general' ? saveError.message : 'Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteConfirmed() {
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      setDeleteOpen(false)
    } catch {
      setError('Could not delete this transaction. It has not been removed.')
    } finally {
      setDeleting(false)
    }
  }

  const content = (
    <>
        {!embedded && <h2 className="mb-4 text-lg font-semibold text-ink-900">{isEdit ? 'Edit transaction' : 'Add transaction'}</h2>}

        <ProtectedForm noValidate onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="date" label="Date" required error={fieldErrors.date}>
              <Input
                id="date"
                type="date"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field id="owner" label="Owner" required error={fieldErrors.owner}>
              <Select
                id="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
            {!split && (
              <Field id="amount" label="Amount" required error={fieldErrors.amount}>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            )}
            <Field id="currency" label="Currency" required error={fieldErrors.currency} className={split ? 'col-span-2 max-w-32' : ''}>
              <Select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {['AED', 'USD', 'INR'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field id="account" label="Account" required error={fieldErrors.account}>
            <Select
              id="account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>

          {!split ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="category" className="block text-sm font-medium text-ink-700">
                  Category
                </label>
                {allowSplit && expenseCategories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (amount) setSplitLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, amount } : l)))
                      setSplit(true)
                    }}
                    className="min-h-11 text-xs font-medium text-ink-500 underline hover:text-ink-700"
                  >
                    Split across categories
                  </button>
                )}
              </div>
              <Select
                id="category"
                value={category}
                onChange={(e) => {
                  setCategoryTouched(true)
                  setCategory(e.target.value)
                }}
                aria-invalid={Boolean(fieldErrors.category) || undefined}
                aria-describedby={fieldErrors.category ? 'category-error' : undefined}
              >
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </Select>
              {fieldErrors.category && <p id="category-error" role="alert" className="mt-1 text-sm text-neg-600">{fieldErrors.category}</p>}
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
                    setCategory(splitLines[0]?.category ?? expenseCategories[0]?.name ?? '')
                    setSplit(false)
                  }}
                  className="min-h-11 text-xs font-medium text-ink-500 underline hover:text-ink-700"
                >
                  Use one category
                </button>
              </div>
              <div className="space-y-2">
                {splitLines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                    <select
                      value={line.category}
                      onChange={(e) => updateSplitLine(i, { category: e.target.value })}
                      className="min-h-11 min-w-0 rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                    >
                      {expenseCategories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      inputMode="decimal"
                      value={line.amount}
                      onChange={(e) => updateSplitLine(i, { amount: e.target.value })}
                      className="min-h-11 w-full rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                      placeholder="0.00"
                    />
                    {splitLines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeSplitLine(i)}
                        className="min-h-11 min-w-11 px-1 text-ink-400 hover:text-neg-600"
                        aria-label="Remove split line"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {fieldErrors.split && <p role="alert" className="mt-2 text-sm text-neg-600">{fieldErrors.split}</p>}
              <button type="button" onClick={addSplitLine} className="mt-2 min-h-11 text-xs font-medium text-ink-500 underline hover:text-ink-700">
                + Add category
              </button>
              <p className="mt-2 text-xs font-medium text-ink-700">
                Total: {splitTotal.toFixed(2)} {currency}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium text-ink-700">
              Merchant / payee or note
            </label>
            <input
              id="note"
              type="text"
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="optional"
            />
          </div>

          {!isEdit && !split && note.trim() && category && onCreateRule && (
            <Checkbox
              checked={saveAsRule}
              onChange={(e) => setSaveAsRule(e.target.checked)}
              label={`Always categorize notes containing “${note.trim()}” as ${category}`}
            />
          )}

          {!isEdit && !split && (
            <div className="space-y-1 text-xs text-ink-500">
              {!allowSplit && (
                <p>New split entry is temporarily unavailable while transaction safety is being hardened. Save one category for now.</p>
              )}
              <p>Refunds and reimbursements are temporarily unsupported here. Do not record them as income.</p>
            </div>
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
              className="min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              placeholder="comma, separated, optional"
            />
          </div>

          {!split && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="assignedTo" className="mb-1 block text-sm font-medium text-ink-700">
                  Ask partner to review
                </label>
                <select
                  id="assignedTo"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
                  className="min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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

          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 bg-surface px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2">
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
                onClick={() => setDeleteOpen(true)}
                intent="danger"
              >
                Delete
              </Button>
            )}
          </div>
        </ProtectedForm>
        {isEdit && (
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            pending={deleting}
            title="Delete this transaction?"
            description="It will be removed from current totals, and you can undo immediately from Activity."
            confirmLabel="Delete transaction"
            onConfirm={handleDeleteConfirmed}
          />
        )}
    </>
  )

  if (embedded) return content

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[100dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 shadow-xl sm:max-h-[90vh] sm:rounded-2xl sm:p-6">
        {content}
      </div>
    </div>
  )
}
