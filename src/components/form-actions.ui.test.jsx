import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { NavigationSafetyProvider } from '../lib/NavigationSafety'
import AccountForm from './AccountForm'
import BudgetLimitForm from './BudgetLimitForm'
import CategoryForm from './CategoryForm'
import ContributionForm from './ContributionForm'
import ForecastEventForm from './ForecastEventForm'
import ForecastSetup from './ForecastSetup'
import GoalForm from './GoalForm'
import IncomeForm from './IncomeForm'
import RecurringForm from './RecurringForm'
import TransactionForm from './TransactionForm'

const account = {
  id: 'account-1',
  name: 'Cash account',
  owner: 'Shrey',
  is_liability: false,
  type: 'cash',
  currency: 'AED',
  value: 100,
  ticker: null,
  quantity: null,
  avg_cost: null,
  interest_rate: null,
  credit_limit: null,
  statement_day: null,
  due_day: null,
}

const category = { id: 'category-1', name: 'Groceries', group: 'Needs', icon: null }
const budget = { id: 'budget-1', group: 'Flexible', monthly_limit: 500 }
const event = {
  id: 'event-1',
  kind: 'custom',
  target_date: '2027-01-15',
  params: { label: 'Move house' },
}
const goal = {
  id: 'goal-1',
  kind: 'save_up',
  name: 'Emergency fund',
  icon: null,
  target_amount: 1000,
  monthly_plan: 100,
  priority: 1,
  target_date: '2027-01-01',
  linked_account_id: 'account-1',
}
const income = {
  id: 'income-1',
  person: 'Shrey',
  source: 'Salary',
  kind: 'salary',
  amount: 10000,
  currency: 'AED',
  date: '2026-08-27',
}
const recurring = {
  id: 'recurring-1',
  name: 'Rent',
  kind: 'expense',
  amount: 5000,
  currency: 'AED',
  owner: 'Shrey',
  day_of_month: 1,
  months: [],
  linked_account_id: null,
  autopay: false,
  end_date: null,
}
const transaction = {
  id: 'transaction-1',
  date: '2026-08-27',
  amount: 50,
  currency: 'AED',
  account_id: 'account-1',
  category: 'Groceries',
  owner: 'Shrey',
  note: 'Lunch',
  tags: ['meal'],
  assigned_to: null,
  goal_id: null,
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function callbacks(onSave = vi.fn().mockResolvedValue(undefined)) {
  return {
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    onSave,
  }
}

function renderForm(Component, props) {
  return render(
    <NavigationSafetyProvider>
      <Component {...props} />
    </NavigationSafetyProvider>,
  )
}

function footer() {
  return screen.getByRole('button', { name: /^Save$/ }).closest('.flex.items-center.gap-2.pt-2')
}

const cases = [
  {
    name: 'AccountForm',
    Component: AccountForm,
    createProps: (cb) => ({ ...cb }),
    saveProps: (cb) => ({ ...cb, account }),
    expectedPayload: {
      name: 'Cash account', owner: 'Shrey', type: 'cash', is_liability: false, currency: 'AED', value: 100,
      ticker: null, quantity: null, avg_cost: null, interest_rate: null, credit_limit: null,
      statement_day: null, due_day: null,
    },
    deleteArgs: ['account-1'],
  },
  {
    name: 'BudgetLimitForm',
    Component: BudgetLimitForm,
    createProps: (cb) => ({ ...cb, category }),
    saveProps: (cb) => ({ ...cb, category, budget }),
    expectedPayload: { id: 'budget-1', category_id: 'category-1', monthly_limit: 500, group: 'Flexible' },
  },
  {
    name: 'CategoryForm',
    Component: CategoryForm,
    createProps: (cb) => ({ ...cb }),
    saveProps: (cb) => ({ ...cb, category }),
    expectedPayload: { name: 'Groceries', group: 'Needs', icon: null },
    expectedError: 'Could not save. Try again — category names must be unique.',
    deleteArgs: ['category-1'],
  },
  {
    name: 'ContributionForm',
    Component: ContributionForm,
    createProps: (cb) => ({ ...cb, accounts: [] }),
    saveProps: (cb) => ({ ...cb, accounts: [] }),
    prepare: async (user) => user.type(screen.getByLabelText('Amount (AED)'), '25'),
    expectedPayload: expect.objectContaining({ amount: 25, note: null, fromAccountId: null }),
  },
  {
    name: 'ForecastEventForm',
    Component: ForecastEventForm,
    createProps: (cb) => ({ ...cb }),
    saveProps: (cb) => ({ ...cb, event }),
    expectedPayload: { kind: 'custom', target_date: '2027-01-15', params: { label: 'Move house' } },
    deleteEvent: true,
  },
  {
    name: 'ForecastSetup',
    Component: ForecastSetup,
    createProps: (cb) => ({ ...cb, accounts: [account], defaultMonthlyIncome: 10000, defaultMonthlyExpenses: 5000 }),
    saveProps: (cb) => ({
      ...cb,
      accounts: [account],
      defaultMonthlyIncome: 10000,
      defaultMonthlyExpenses: 5000,
      initial: {
        birthday: '1990-01-01',
        growthRatePct: 6,
        retirementAge: 55,
        retirementIncome: 5000,
        monthlyIncomeOverride: 10000,
        monthlyExpenseOverride: 5000,
        participatingAccountIds: ['account-1'],
      },
    }),
    expectedPayload: {
      birthday: '1990-01-01', growthRatePct: 6, retirementAge: 55, retirementIncome: 5000,
      monthlyIncomeOverride: 10000, monthlyExpenseOverride: 5000, participatingAccountIds: ['account-1'],
    },
  },
  {
    name: 'GoalForm',
    Component: GoalForm,
    createProps: (cb) => ({ ...cb, fixedKind: 'save_up', liabilityAccounts: [], assetAccounts: [account] }),
    saveProps: (cb) => ({ ...cb, goal, fixedKind: 'save_up', liabilityAccounts: [], assetAccounts: [account] }),
    expectedPayload: {
      kind: 'save_up', name: 'Emergency fund', icon: null, target_amount: 1000, monthly_plan: 100,
      priority: 1, target_date: '2027-01-01', linked_account_id: 'account-1',
    },
    deleteEvent: true,
  },
  {
    name: 'IncomeForm',
    Component: IncomeForm,
    createProps: (cb) => ({ ...cb }),
    saveProps: (cb) => ({ ...cb, income }),
    expectedPayload: {
      person: 'Shrey', source: 'Salary', kind: 'salary', amount: 10000, currency: 'AED', date: '2026-08-27',
    },
    deleteEvent: true,
  },
  {
    name: 'RecurringForm',
    Component: RecurringForm,
    createProps: (cb) => ({ ...cb, accounts: [] }),
    saveProps: (cb) => ({ ...cb, entry: recurring, accounts: [] }),
    expectedPayload: {
      name: 'Rent', kind: 'expense', amount: 5000, currency: 'AED', owner: 'Shrey', day_of_month: 1,
      months: [], linked_account_id: null, autopay: false, end_date: null,
    },
    deleteEvent: true,
  },
  {
    name: 'TransactionForm',
    Component: TransactionForm,
    createProps: (cb) => ({ ...cb, accounts: [account], categories: [category], goals: [], rules: [] }),
    saveProps: (cb) => ({ ...cb, transaction, accounts: [account], categories: [category], goals: [], rules: [] }),
    expectedPayload: {
      split: false,
      fields: {
        date: '2026-08-27', currency: 'AED', account_id: 'account-1', owner: 'Shrey', note: 'Lunch',
        tags: ['meal'], amount: 50, category: 'Groceries', assigned_to: null, goal_id: null,
      },
    },
    deleteEvent: true,
  },
]

describe.each(cases)('$name action footer', ({
  Component,
  createProps,
  saveProps,
  prepare,
  expectedPayload,
  expectedError = 'Could not save. Try again.',
  deleteArgs,
  deleteEvent,
}) => {
  it('keeps the exact action order, types, conditional Delete visibility, and Cancel behavior', async () => {
    const user = userEvent.setup()
    const cb = callbacks()
    renderForm(Component, saveProps(cb))

    const actions = within(footer()).getAllByRole('button')
    expect(actions.map((button) => button.textContent)).toEqual(deleteArgs || deleteEvent ? ['Save', 'Cancel', 'Delete'] : ['Save', 'Cancel'])
    expect(actions.filter((button) => button.type === 'submit')).toHaveLength(1)
    expect(actions[0]).toHaveAttribute('type', 'submit')
    expect(actions[1]).toHaveAttribute('type', 'button')
    if (deleteArgs || deleteEvent) expect(actions[2]).toHaveAttribute('type', 'button')
    expect(await axe(footer())).toHaveNoViolations()

    actions[1].focus()
    await user.keyboard('{Enter}')
    expect(cb.onCancel).toHaveBeenCalledTimes(1)
    expect(cb.onSave).not.toHaveBeenCalled()
    expect(cb.onDelete).not.toHaveBeenCalled()
  })

  it('submits once, preserves the payload and exact pending label, and blocks double-submit', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    const cb = callbacks(vi.fn(() => pending.promise))
    renderForm(Component, saveProps(cb))
    await prepare?.(user)

    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(cb.onSave).toHaveBeenCalledTimes(1))
    expect(cb.onSave).toHaveBeenCalledWith(expectedPayload)
    const saving = screen.getByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(saving)
    expect(cb.onSave).toHaveBeenCalledTimes(1)

    pending.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
  })

  it('keeps Delete conditional and invokes only the existing callback signature', async () => {
    const createCallbacks = callbacks()
    const createRender = renderForm(Component, createProps(createCallbacks))
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    createRender.unmount()

    if (!deleteArgs && !deleteEvent) return

    const user = userEvent.setup()
    const editCallbacks = callbacks()
    renderForm(Component, saveProps(editCallbacks))
    const remove = screen.getByRole('button', { name: 'Delete' })
    remove.focus()
    await user.keyboard(' ')
    expect(editCallbacks.onDelete).toHaveBeenCalledTimes(1)
    if (deleteEvent) {
      expect(editCallbacks.onDelete.mock.calls[0]).toHaveLength(1)
      expect(editCallbacks.onDelete.mock.calls[0][0]).toMatchObject({ type: 'click' })
    } else {
      expect(editCallbacks.onDelete).toHaveBeenCalledWith(...deleteArgs)
    }
    expect(editCallbacks.onSave).not.toHaveBeenCalled()
    expect(editCallbacks.onCancel).not.toHaveBeenCalled()
  })

  it('preserves the rejected-save error and finally restores the Save control', async () => {
    const user = userEvent.setup()
    const cb = callbacks(vi.fn().mockRejectedValue(new Error('save failed')))
    renderForm(Component, saveProps(cb))
    await prepare?.(user)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(expectedError)).toBeInTheDocument()
    expect(cb.onSave).toHaveBeenCalledTimes(1)
    expect(cb.onSave).toHaveBeenCalledWith(expectedPayload)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
  })
})
