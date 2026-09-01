import { formatDayMonthYear } from '../format'

/**
 * Recurring header: kicker, sentence-style serif title, the period the screen
 * is showing, and its month navigation.
 *
 * The prototype's header line reads "Committed AED 20,860 · 3 without
 * autopay". Both halves are the recurring plan, so the line states the gap
 * instead of a figure. Nothing here totals, counts or characterises a
 * commitment, because no commitment is published.
 */
export default function RecurringHeader({ model, onStep }) {
  const { period, plan } = model

  return (
    <div className="v6-enter">
      <div className="v6-page-header">
        <div>
          <p className="v6-kicker-text">Money · Recurring</p>
          <h1 id="page-title" tabIndex={-1} className="v6-page-title">
            Bills, EMIs and expected income for {period.label}.
          </h1>
          <p className="v6-section-note" style={{ marginTop: '7px' }}>
            {formatDayMonthYear(period.from)} – {formatDayMonthYear(period.to)}
            {period.daysRemaining !== null
              ? ` · ${period.daysRemaining} ${period.daysRemaining === 1 ? 'day' : 'days'} left in the month`
              : ''}
          </p>
        </div>

        <div className="v6-period-nav" role="group" aria-label="Recurring month">
          <button type="button" aria-label="Previous month" onClick={() => onStep(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <span className="v6-period-label" aria-live="polite">{period.label}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={period.isCurrentMonth}
            onClick={() => onStep(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <p className="v6-summary-line">
        <span className="v6-tone-muted">{plan.committedTotal.gap.reason}</span>
        <span className="v6-tone-muted">{plan.autopay.gap.reason}</span>
      </p>
    </div>
  )
}
