import { UnavailableRegion } from '../primitives/Slot'
import { formatTimestamp } from '../format'

/**
 * Quality, valuation evidence and the freshness positions the prototype fills
 * with a claim ("all valued today", "FX 6 days old") that no contract
 * publishes.
 *
 * What is stated here is only what a contract already returns: the balance
 * sheet's own quality status and counters, its exact FX timestamp, and the
 * declared FX basis. What is withheld is the interpretation — whether any of
 * that is current enough — because turning a timestamp into a verdict is a
 * policy, and this screen does not own one.
 */
export default function AccountsQuality({ totals, gaps }) {
  return (
    <section className="v6-section-lg v6-enter" aria-labelledby="v6-accounts-quality-title">
      <div className="v6-section-head">
        <div>
          <h2 id="v6-accounts-quality-title" className="v6-kicker-text">Quality and freshness</h2>
          <p className="v6-section-note">Evidence published by the canonical contracts; not an alert, score or anomaly claim</p>
        </div>
      </div>

      <div className="v6-quality-grid">
        <article className="v6-quality-card">
          <p className="v6-kicker-text">Account valuation quality</p>
          <p className="v6-quality-status">
            <span className="v6-quality-dot" data-status={totals.quality ?? 'incomplete'} aria-hidden="true" />
            {totals.quality ?? 'Unavailable'}
          </p>
          <p className="v6-quality-detail">
            {totals.incompleteAccountCount ?? '—'} incomplete · {totals.provisionalAccountCount ?? '—'} provisional
            {' · '}{totals.missingFxCount ?? '—'} missing FX
          </p>
          <p className="v6-quality-detail">
            Source: canonical_balance_sheet. Provisional is a quality fact, not an error, and an incomplete
            account keeps its AED position empty rather than being estimated.
          </p>
        </article>

        <article className="v6-quality-card">
          <p className="v6-kicker-text">FX evidence</p>
          <p className="v6-quality-status">{totals.fxBasis === 'current_rate_aed' ? 'Current rate' : totals.fxBasis ?? 'Unavailable'}</p>
          <p className="v6-quality-detail">FX timestamp: {formatTimestamp(totals.fxUpdatedAt) ?? 'not recorded'}</p>
          <p className="v6-quality-detail">
            Each row’s AED value is published by the canonical contract using this basis. No rate is applied in
            the browser, and no native balance is converted here.
          </p>
        </article>

        <UnavailableRegion slot={gaps.freshness} />
        <UnavailableRegion slot={gaps.provenance} />
      </div>
    </section>
  )
}
