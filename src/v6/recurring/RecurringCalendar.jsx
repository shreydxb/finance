import { UnavailableRegion } from '../primitives/Slot'
import { WEEKDAY_LABELS } from '../data/recurringModel'

/**
 * The month grid, Monday first.
 *
 * The prototype places a marker on each day a bill lands or income arrives.
 * Every one of those markers is an *expected* event projected from a
 * commitment's cadence, and no commitment is published — so the grid renders
 * the household's real calendar month and puts nothing on it.
 *
 * Posted entries are deliberately not plotted here either. A posted entry
 * sitting in a day cell of a *recurring* calendar reads as "the expected event
 * landed on this day", which is exactly the plan-to-posted conversion this
 * screen must not perform, and no contract publishes a per-day total to draw
 * anyway. Posted daily activity lives on Money → Activity, where a day cell
 * means what it says.
 */
export default function RecurringCalendar({ model }) {
  const { calendar, period, type } = model
  const label = type === 'income' ? 'expected income' : 'bills and EMIs'

  return (
    <section className="v6-calendar" aria-label={`Recurring calendar for ${period.label}`}>
      <div className="v6-calendar-head" aria-hidden="true">
        {WEEKDAY_LABELS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="v6-calendar-grid" role="list">
        {calendar.weeks.flat().map((cell) => (
          <div
            key={cell.key}
            className="v6-calendar-cell"
            data-outside={cell.inMonth ? 'false' : 'true'}
            data-today={cell.isToday ? 'true' : 'false'}
            role="listitem"
          >
            {cell.inMonth ? (
              <>
                <span className="v6-calendar-day">
                  {cell.day}
                  {cell.isToday ? <span className="v6-visually-hidden"> (today)</span> : null}
                </span>
                <span className="v6-calendar-count">
                  <span aria-hidden="true">—</span>
                  <span className="v6-visually-hidden">
                    {`No ${label} are published for ${cell.day} ${period.label}`}
                  </span>
                </span>
              </>
            ) : null}
          </div>
        ))}
      </div>

      <p className="v6-list-footer">
        <span>
          {period.label} as the household’s own calendar. No event is placed on a day: an expected recurring event
          needs a published commitment, and a posted entry is not one.
        </span>
      </p>

      <div style={{ marginTop: '14px' }}>
        <UnavailableRegion slot={calendar.expected} inline />
      </div>
    </section>
  )
}
