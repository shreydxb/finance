import PeriodControl from '../primitives/PeriodControl'
import { formatContextDate, formatDayMonthYear } from '../format'

/**
 * Overview header: date/context kicker, sentence-style serif title, and the
 * period control aligned to the trailing edge.
 *
 * The prototype's title ("Three days left in the month.") is a generated
 * narrative. This one states only what the screen actually knows: the scope it
 * is showing and the period it covers.
 */
export default function OverviewHeader({ period, today, periodKey, onPeriodChange, busy }) {
  return (
    <div className="v6-page-header v6-enter">
      <div>
        <p className="v6-kicker-text">{formatContextDate(today) ?? 'Today'}</p>
        <h1 id="page-title" tabIndex={-1} className="v6-page-title">
          Whole household, {period.title.toLowerCase()}.
        </h1>
        <p className="v6-section-note" style={{ marginTop: '7px' }}>
          {formatDayMonthYear(period.from)} – {formatDayMonthYear(period.to)}
          <span className="v6-visually-hidden">. Shared household facts are counted once and are never split between people.</span>
        </p>
      </div>
      <PeriodControl value={periodKey} onChange={onPeriodChange} busy={busy} />
    </div>
  )
}
