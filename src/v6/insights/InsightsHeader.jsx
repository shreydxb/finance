import { FigureSlot } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonthYear } from '../format'

export default function InsightsHeader({ model, onStep }) {
  const { period, summary } = model

  return (
    <div className="v6-enter">
      <div className="v6-page-header">
        <div>
          <p className="v6-kicker-text">Money · Insights</p>
          <h1 id="page-title" tabIndex={-1} className="v6-page-title">Insights for {period.label}.</h1>
          <p className="v6-section-note" style={{ marginTop: '7px' }}>
            {formatDayMonthYear(period.from)} – {formatDayMonthYear(period.to)} · whole household
          </p>
        </div>

        <div className="v6-period-nav" role="group" aria-label={`Insights ${period.kind}`}>
          <button type="button" aria-label={`Previous ${period.kind}`} onClick={() => onStep(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <span className="v6-period-label" aria-live="polite">{period.label}</span>
          <button
            type="button"
            aria-label={`Next ${period.kind}`}
            disabled={period.isCurrent}
            onClick={() => onStep(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <p className="v6-summary-line">
        <span>
          Consumption spend{' '}
          {isAvailable(summary.spend)
            ? <>AED <FigureSlot slot={summary.spend} format={(value) => formatAed(value)} /></>
            : <span className="v6-tone-muted">{slotReason(summary.spend)}</span>}
        </span>
        <span>
          Posted income{' '}
          {isAvailable(summary.income)
            ? <>AED <FigureSlot slot={summary.income} format={(value) => formatAed(value)} /></>
            : <span className="v6-tone-muted">{slotReason(summary.income)}</span>}
        </span>
        {summary.quality ? <span>Period quality: {summary.quality}</span> : null}
      </p>
    </div>
  )
}
