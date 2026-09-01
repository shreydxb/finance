import { UnavailableRegion } from '../primitives/Slot'
import { WEEKDAY_LABELS } from '../data/activityModel'

/**
 * The month grid, Monday first.
 *
 * The prototype prints a money figure and a bill marker in each cell. Neither
 * is available: no contract publishes a per-day total, and adding the rows up
 * here would create a household figure nothing stands behind. Each cell
 * therefore reports how many canonical entries fall on that day — a
 * cardinality of rows the contract returned — and both missing capabilities
 * are named beneath the grid rather than approximated inside it.
 */
export default function ActivityCalendar({ model }) {
  const { calendar, period, visibleCount } = model

  return (
    <section className="v6-calendar" aria-label={`Activity calendar for ${period.label}`}>
      <div className="v6-calendar-head" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="v6-calendar-grid" role="list">
        {calendar.weeks.flat().map((cell) => (
          <div
            key={cell.key}
            className="v6-calendar-cell"
            data-outside={cell.inMonth ? 'false' : 'true'}
            role="listitem"
          >
            {cell.inMonth ? (
              <>
                <span className="v6-calendar-day">{cell.day}</span>
                <span className="v6-calendar-count">
                  {cell.count === 0 ? '—' : `${cell.count} ${cell.count === 1 ? 'entry' : 'entries'}`}
                  <span className="v6-visually-hidden">
                    {` on ${cell.day} ${period.label}`}
                  </span>
                </span>
                {cell.needsReview > 0 ? (
                  <span className="v6-calendar-review">{cell.needsReview} needs review</span>
                ) : null}
              </>
            ) : null}
          </div>
        ))}
      </div>

      <p className="v6-list-footer">
        <span>
          {visibleCount} canonical {visibleCount === 1 ? 'entry' : 'entries'} placed by date. Counts follow the active
          search and filters.
        </span>
      </p>

      <div style={{ marginTop: '14px' }}>
        <UnavailableRegion slot={calendar.dailyTotals} inline />
      </div>
      <div style={{ marginTop: '14px' }}>
        <UnavailableRegion slot={calendar.bills} inline />
      </div>
    </section>
  )
}
