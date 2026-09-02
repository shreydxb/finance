import { UnavailableRegion } from '../primitives/Slot'

/**
 * The prototype's allocation cards — one per asset class, each with a share, a
 * bar and a note.
 *
 * The whole region is a named gap. Two separate facts are missing, and both
 * are needed before a single card could be drawn honestly: no contract
 * classifies a holding into an asset class, and none publishes an allocation
 * share for one.
 *
 * The share is the more dangerous of the two, because it looks derivable. Each
 * position's AED value is published and so is the portfolio total, so a
 * division would produce a plausible percentage — computed in the browser,
 * over a numerator and denominator whose quality rules differ, silently
 * excluding every holding the contract withheld a value for, and summing to
 * something other than 100% without saying so. A bar drawn from a canonically
 * published share would be acceptable geometry. A bar drawn from a share this
 * screen invented would be a financial claim wearing a chart's clothes.
 */
export default function InvestmentsAllocation({ gaps }) {
  return (
    <section className="v6-section-lg v6-investments-allocation v6-enter" aria-labelledby="v6-investments-allocation-title">
      <div className="v6-section-head">
        <div>
          <h2 id="v6-investments-allocation-title" className="v6-kicker-text">Allocation</h2>
          <p className="v6-section-note">How the portfolio is split across asset classes</p>
        </div>
      </div>

      <div className="v6-investments-allocation-gaps">
        <UnavailableRegion slot={gaps.allocation} />
        <UnavailableRegion slot={gaps.assetClass} />
        <UnavailableRegion slot={gaps.brokerageCash} />
      </div>
    </section>
  )
}
