import { FigureSlot, SlotNote, UnavailableRegion } from '../primitives/Slot'
import { formatAed, formatTimestamp } from '../format'

function QualityStatus({ status }) {
  if (!status) return null
  return (
    <span className="v6-wealth-status">
      <span className="v6-quality-dot" data-status={status} aria-hidden="true" />
      Current quality: {status}
    </span>
  )
}

export default function CurrentNetWorth({ current }) {
  return (
    <section className="v6-wealth-hero v6-enter" aria-labelledby="current-net-worth-title">
      <div className="v6-wealth-hero-main">
        <p id="current-net-worth-title" className="v6-kicker-text">Current net worth</p>
        <FigureSlot slot={current.netWorth} prefix="AED" format={formatAed} className="v6-wealth-hero-value" />
        <QualityStatus status={current.quality} />
        <SlotNote slot={current.netWorth} />
        <div className="v6-wealth-change-position">
          <UnavailableRegion slot={current.change} inline />
        </div>
      </div>

      <div className="v6-wealth-composition-position" aria-label="Wealth composition">
        <p className="v6-kicker-text">Composition</p>
        <UnavailableRegion slot={current.composition} />
      </div>

      <ul className="v6-wealth-totals" aria-label="Current canonical balance sheet totals">
        <li>
          <span>Assets</span>
          <FigureSlot slot={current.assets} prefix="AED" format={formatAed} />
          <SlotNote slot={current.assets} />
        </li>
        <li>
          <span>Liabilities</span>
          <FigureSlot slot={current.liabilities} prefix="AED" format={formatAed} tone="negative" />
          <SlotNote slot={current.liabilities} />
        </li>
        <li>
          <span>Scope</span>
          <strong>Whole household</strong>
          <span className="v6-kpi-hint">canonical_balance_sheet scope: household</span>
        </li>
        <li>
          <span>FX evidence</span>
          <strong>{formatTimestamp(current.fxUpdatedAt) ?? 'Not recorded'}</strong>
          <span className="v6-kpi-hint">Exact contract timestamp; no stale threshold inferred</span>
        </li>
      </ul>

      <div className="v6-wealth-scope-position" aria-label="Household and person wealth scope">
        <p className="v6-kicker-text">Household and person positions</p>
        <UnavailableRegion slot={current.scope} />
      </div>
    </section>
  )
}
