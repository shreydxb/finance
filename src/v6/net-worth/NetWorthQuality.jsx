import { UnavailableRegion } from '../primitives/Slot'
import { formatTimestamp } from '../format'

export default function NetWorthQuality({ current, freshness }) {
  return (
    <section className="v6-section-lg v6-enter" aria-labelledby="wealth-quality-title">
      <div className="v6-section-head">
        <div>
          <h2 id="wealth-quality-title" className="v6-kicker-text">Quality and freshness</h2>
          <p className="v6-section-note">Evidence from current and historical contracts; not an alert or anomaly score</p>
        </div>
      </div>
      <div className="v6-quality-grid">
        <article className="v6-quality-card">
          <p className="v6-kicker-text">Current balance sheet</p>
          <p className="v6-quality-status">
            <span className="v6-quality-dot" data-status={current.quality ?? 'incomplete'} aria-hidden="true" />
            {current.quality ?? 'Unavailable'}
          </p>
          <p className="v6-quality-detail">
            {current.incompleteAccountCount ?? '—'} incomplete · {current.provisionalAccountCount ?? '—'} provisional · {current.missingFxCount ?? '—'} missing FX
          </p>
          <p className="v6-quality-detail">FX timestamp: {formatTimestamp(current.fxUpdatedAt) ?? 'not recorded'}</p>
          <p className="v6-quality-detail">Source: canonical_balance_sheet. Provisional is a quality fact, not an error.</p>
        </article>
        <article className="v6-quality-card">
          <p className="v6-kicker-text">Historical snapshots</p>
          <p className="v6-quality-status">Complete · Provisional · Legacy · Skipped</p>
          <p className="v6-quality-detail">Each row keeps its published status. Provisional is not promoted to Complete, and a skipped publication carries no monetary point.</p>
        </article>
        <UnavailableRegion slot={freshness} />
      </div>
    </section>
  )
}
