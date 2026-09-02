import { UnavailableRegion } from '../primitives/Slot'
import { formatTimestamp } from '../format'

/**
 * Valuation, price and FX evidence, and the freshness positions the prototype
 * fills with a claim ("Prices just now", "FX 6 days old") that no contract
 * publishes.
 *
 * What is stated here is only what a contract already returns: the portfolio
 * contract's own quality status and counters, its declared FX basis, and its
 * exact oldest and newest valuation timestamps. What is withheld is the
 * interpretation — whether any of that is current enough — because turning a
 * timestamp into a verdict is a policy, and this screen does not own one.
 *
 * The stale counter is reported carefully. `canonical_investment_metrics`
 * counts positions older than a staleness boundary the caller passes in; this
 * consumer passes none, so the count is zero by construction. Reporting that
 * zero as "nothing is stale" would turn the absence of a policy into a clean
 * bill of health, so it is described as what it is.
 */
export default function InvestmentsQuality({ totals, gaps }) {
  const noPolicy = totals.staleValueCount === 0

  return (
    <section className="v6-section-lg v6-enter" aria-labelledby="v6-investments-quality-title">
      <div className="v6-section-head">
        <div>
          <h2 id="v6-investments-quality-title" className="v6-kicker-text">Valuation quality and evidence</h2>
          <p className="v6-section-note">
            Evidence published by the canonical contracts; not an alert, a score, an anomaly claim or a
            recommendation
          </p>
        </div>
      </div>

      <div className="v6-quality-grid">
        <article className="v6-quality-card">
          <p className="v6-kicker-text">Portfolio valuation quality</p>
          <p className="v6-quality-status">
            <span className="v6-quality-dot" data-status={totals.quality ?? 'incomplete'} aria-hidden="true" />
            {totals.quality ?? 'Unavailable'}
          </p>
          <p className="v6-quality-detail">
            {totals.incompleteValueCount ?? '—'} incomplete value · {totals.incompletePnlCount ?? '—'} incomplete
            cost basis · {totals.provisionalCount ?? '—'} provisional
          </p>
          <p className="v6-quality-detail">
            Source: canonical_investment_metrics. Provisional is a quality fact, not an error or a warning, and an
            incomplete holding keeps its figures empty rather than being estimated.
          </p>
        </article>

        <article className="v6-quality-card">
          <p className="v6-kicker-text">Price evidence</p>
          <p className="v6-quality-status">{totals.manualValueCount ?? '—'} manually valued</p>
          <p className="v6-quality-detail">
            Oldest valuation: {formatTimestamp(totals.oldestValuationAt) ?? 'not recorded'}
          </p>
          <p className="v6-quality-detail">
            Newest valuation: {formatTimestamp(totals.newestValuationAt) ?? 'not recorded'}
          </p>
          <p className="v6-quality-detail">
            A manually valued holding carries no published price. That is a statement about where its number came
            from, not about how old the number is.
          </p>
        </article>

        <article className="v6-quality-card">
          <p className="v6-kicker-text">FX evidence</p>
          <p className="v6-quality-status">
            {totals.fxBasis === 'current_rate_aed' ? 'Current rate' : totals.fxBasis ?? 'Unavailable'}
          </p>
          <p className="v6-quality-detail">FX timestamp: {formatTimestamp(totals.fxUpdatedAt) ?? 'not recorded'}</p>
          <p className="v6-quality-detail">
            {totals.missingFxCount ? `${totals.missingFxCount} holding(s) with no published rate` : 'Every holding has a published rate'}
            {totals.missingFxCurrencies.length ? ` · ${totals.missingFxCurrencies.join(' · ')}` : ''}
          </p>
          <p className="v6-quality-detail">
            Each AED figure on this screen was published by the canonical contract on this basis. No rate is
            applied in the browser, and no native value is converted here.
          </p>
        </article>

        <article className="v6-quality-card">
          <p className="v6-kicker-text">Staleness policy</p>
          <p className="v6-quality-status">{noPolicy ? 'None applied' : `${totals.staleValueCount} past boundary`}</p>
          <p className="v6-quality-detail">
            The canonical contract counts holdings older than a staleness boundary its caller supplies. This
            screen supplies none, so the count is zero by construction — that is the absence of a policy, not a
            finding that every price is current.
          </p>
        </article>

        <UnavailableRegion slot={gaps.freshness} />
        <UnavailableRegion slot={gaps.priceProvenance} />
      </div>
    </section>
  )
}
