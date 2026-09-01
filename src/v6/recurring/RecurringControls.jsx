import { UnavailableRegion } from '../primitives/Slot'
import { RECURRING_TYPE_OPTIONS, RECURRING_VIEW_OPTIONS } from '../data/recurringPeriods'

/**
 * The prototype's Bills / Expected income split and its List / Calendar view,
 * plus its "+ Bill" and "+ Income" affordances.
 *
 * The prototype places Bills and Expected income side by side in two columns.
 * Both are the same missing plan contract, and a two-column layout of two
 * identical unavailable states reads as a rendering fault rather than as an
 * answer — so the two become a real mode switch. It is not a visual
 * simplification: `type=bills|income` is already the approved route contract
 * for this screen, it is what makes the mobile hierarchy work at 320px, and it
 * survives a reload.
 *
 * Both write affordances are rendered, disabled, naming SHR-171. Hiding them
 * would misrepresent the product as not having recurring commitments; wiring
 * them to `src/lib/recurring.js` would create plan rows the plan contract
 * could not later version.
 */
export default function RecurringControls({ model, onTypeChange, onViewChange }) {
  const { type, view, period, capabilities } = model
  const addLabel = type === 'income' ? 'Income' : 'Bill'
  const addName = type === 'income' ? 'Add an expected income' : 'Add a bill'
  const note = period.daysRemaining !== null
    ? `${period.label} · ${period.daysRemaining} ${period.daysRemaining === 1 ? 'day' : 'days'} left`
    : `${period.label} · complete month`

  return (
    <section aria-label="Recurring type, view and actions">
      <div className="v6-controls">
        <div className="v6-segmented" role="group" aria-label="Recurring type">
          {RECURRING_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === type}
              aria-label={option.title}
              onClick={() => onTypeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="v6-segmented" role="group" aria-label="Recurring view">
          {RECURRING_VIEW_OPTIONS.map((option) => (
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
            aria-label={addName}
            aria-describedby="v6-recurring-add-gap"
          >
            <span aria-hidden="true">+</span> {addLabel}
          </button>
        </div>
      </div>

      <div id="v6-recurring-add-gap" style={{ marginTop: '12px' }}>
        <UnavailableRegion slot={capabilities.add} inline />
      </div>
    </section>
  )
}
