import { FigureSlot } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonthYear } from '../format'

function SummaryFigure({ label, slot }) {
  return (
    <span>
      {label}{' '}
      {isAvailable(slot)
        ? <strong style={{ fontWeight: 400 }}><FigureSlot slot={slot} format={(value) => formatAed(value)} /></strong>
        : <span className="v6-tone-muted">{slotReason(slot)}</span>}
    </span>
  )
}

/**
 * Activity header: kicker, sentence-style serif title, and the month the
 * screen is reviewing with its navigation.
 *
 * The summary line carries counts and the period's canonical totals. Counts
 * are cardinalities of the rows the contract returned; the money comes from
 * `canonical_period_metrics`, not from adding the visible rows together.
 */
export default function ActivityHeader({ model, onStepMonth }) {
  const { period, summary, loadedCount } = model

  return (
    <div className="v6-enter">
      <div className="v6-page-header">
        <div>
          <p className="v6-kicker-text">Money · Activity</p>
          <h1 id="page-title" tabIndex={-1} className="v6-page-title">
            Everything recorded in {period.label}.
          </h1>
          <p className="v6-section-note" style={{ marginTop: '7px' }}>
            {formatDayMonthYear(period.from)} – {formatDayMonthYear(period.to)}
          </p>
        </div>

        <div className="v6-period-nav" role="group" aria-label="Activity month">
          <button type="button" aria-label="Previous month" onClick={() => onStepMonth(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <span className="v6-period-label" aria-live="polite">{period.label}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={period.isCurrentMonth}
            onClick={() => onStepMonth(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <p className="v6-summary-line">
        <span>{loadedCount} canonical {loadedCount === 1 ? 'entry' : 'entries'}</span>
        <SummaryFigure label="Consumption spend" slot={summary.spend} />
        <SummaryFigure label="Posted income" slot={summary.income} />
        {summary.quality ? <span>Period quality: {summary.quality}</span> : null}
      </p>
    </div>
  )
}
