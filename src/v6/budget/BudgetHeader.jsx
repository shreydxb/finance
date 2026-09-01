import { FigureSlot } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonthYear } from '../format'

/**
 * Budget header: kicker, sentence-style serif title, and the period the screen
 * is showing with its navigation.
 *
 * The summary line carries the one canonical money figure Budget can state —
 * the period's consumption spend from `canonical_period_metrics`. It is
 * labelled as spend, never as "spent of budget": the second half of that
 * sentence is the plan, and no contract publishes it.
 */
export default function BudgetHeader({ model, onStep }) {
  const { period, summary, view } = model
  const isYear = view === 'year'

  return (
    <div className="v6-enter">
      <div className="v6-page-header">
        <div>
          <p className="v6-kicker-text">Money · Budget</p>
          <h1 id="page-title" tabIndex={-1} className="v6-page-title">
            {isYear
              ? `Category spending across ${period.label}.`
              : `Category spending in ${period.label}.`}
          </h1>
          <p className="v6-section-note" style={{ marginTop: '7px' }}>
            {formatDayMonthYear(period.from)} – {formatDayMonthYear(period.to)}
            {!isYear && period.daysRemaining !== null
              ? ` · ${period.daysRemaining} ${period.daysRemaining === 1 ? 'day' : 'days'} left in the month`
              : ''}
          </p>
        </div>

        <div className="v6-period-nav" role="group" aria-label={isYear ? 'Budget year' : 'Budget month'}>
          <button type="button" aria-label={isYear ? 'Previous year' : 'Previous month'} onClick={() => onStep(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <span className="v6-period-label" aria-live="polite">{period.label}</span>
          <button
            type="button"
            aria-label={isYear ? 'Next year' : 'Next month'}
            disabled={isYear ? period.isCurrentYear : period.isCurrentMonth}
            onClick={() => onStep(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      {!isYear ? (
        <p className="v6-summary-line">
          <span>
            Consumption spend{' '}
            {isAvailable(summary.actual)
              ? <FigureSlot slot={summary.actual} format={(value) => formatAed(value)} />
              : <span className="v6-tone-muted">{slotReason(summary.actual)}</span>}
          </span>
          {summary.quality ? <span>Period quality: {summary.quality}</span> : null}
          {summary.needsReviewCount ? <span>{summary.needsReviewCount} flagged for review</span> : null}
        </p>
      ) : null}
    </div>
  )
}
