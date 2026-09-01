import { UnavailableRegion } from '../primitives/Slot'
import { BUDGET_VIEW_OPTIONS } from '../data/budgetPeriods'

/**
 * The prototype's Month / Year switch, its period note and its "+ Set a
 * budget" affordance.
 *
 * The switch is real: both views are built. The note is a calendar fact, not a
 * plan claim — "3 days left" rather than the prototype's plan-relative
 * commentary. "Set a budget" is rendered, disabled, naming SHR-166: hiding it
 * would misrepresent the product as not having budgets at all, and wiring it
 * to the legacy budget writer would create plan rows the versioned plan
 * contract could not later interpret.
 */
export default function BudgetControls({ model, onViewChange }) {
  const { view, period, capabilities } = model
  const note = view === 'year'
    ? `${period.label} · twelve canonical monthly reads`
    : period.daysRemaining !== null
      ? `${period.label} · ${period.daysRemaining} ${period.daysRemaining === 1 ? 'day' : 'days'} left`
      : `${period.label} · complete month`

  return (
    <section aria-label="Budget period and actions">
      <div className="v6-controls">
        <div className="v6-segmented" role="group" aria-label="Budget view">
          {BUDGET_VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === view}
              onClick={() => onViewChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="v6-controls-trailing">
          <span className="v6-tone-muted" style={{ fontSize: '11.5px' }}>{note}</span>
          <button
            type="button"
            className="v6-unsupported-action"
            disabled
            aria-describedby="v6-budget-set-gap"
          >
            <span aria-hidden="true">+</span> Set a budget
          </button>
        </div>
      </div>

      <div id="v6-budget-set-gap" style={{ marginTop: '12px' }}>
        <UnavailableRegion slot={capabilities.setBudget} inline />
      </div>
    </section>
  )
}
