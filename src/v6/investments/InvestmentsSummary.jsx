import { FigureSlot, SlotNote, UnavailableRegion } from '../primitives/Slot'
import { isAvailable } from '../primitives/slotState'
import { formatAed } from '../format'

/**
 * The prototype's portfolio hero: a large AED value, a movement beside it, and
 * a performance curve with a range selector.
 *
 * The value, cost basis and unrealized profit are the three monetary facts
 * `canonical_investment_metrics` publishes at household scope. Each is stated
 * exactly as published:
 *
 *  - the portfolio value is the contract's own total, never a sum of the
 *    holdings table below it, so a container and its contents can never both
 *    land in one figure;
 *  - the unrealized profit is the contract's own published figure. It is not
 *    the difference between the value and the cost basis printed beside it,
 *    even though both are present — that subtraction would make this component
 *    a second portfolio accounting engine, arriving at the same number by a
 *    method nobody approved and diverging silently the moment the contract's
 *    quality rules and this component's disagree;
 *  - the percentage the prototype prints next to the movement is withheld. A
 *    return needs a stated denominator, and no contract names one.
 *
 * The movement, the range selector and the curve all belong to SHR-176 and are
 * kept as a real region of the page that says so. An empty frame that explains
 * itself is the honest version of a chart with no trustworthy history behind
 * it; a drawn line would be a fabricated track record.
 */
export default function InvestmentsSummary({ totals, gaps }) {
  return (
    <section className="v6-section-lg v6-investments-hero v6-enter" aria-labelledby="v6-investments-hero-title">
      <div className="v6-section-head">
        <div>
          <h2 id="v6-investments-hero-title" className="v6-kicker-text">Portfolio value</h2>
          <p className="v6-section-note">
            canonical_investment_metrics · whole household · each holding counted once · not a sum of the table below
          </p>
        </div>
      </div>

      <div className="v6-investments-hero-grid">
        <div className="v6-investments-hero-main">
          <p className="v6-wealth-hero-value">
            <FigureSlot slot={totals.value} prefix="AED" format={formatAed} />
          </p>
          <SlotNote slot={totals.value} />
          {isAvailable(totals.value) ? (
            <p className="v6-section-note v6-investments-hero-note">
              Published by the canonical portfolio contract at household scope. Every holding’s AED value was
              computed and reconciled there; none is converted, multiplied out or added up in this screen.
            </p>
          ) : null}

          {/* Each metric is one dt/dd pair and nothing else: the note that
              explains where the figure came from lives inside the <dd>, so the
              definition list stays structurally valid for assistive
              technology rather than carrying loose paragraphs. */}
          <dl className="v6-investments-hero-metrics">
            <div>
              <dt className="v6-kpi-label">Cost basis</dt>
              <dd>
                <span className="v6-kpi-value">
                  <FigureSlot slot={totals.costBasis} prefix="AED" format={formatAed} />
                </span>
                <SlotNote slot={totals.costBasis} />
                {isAvailable(totals.costBasis) ? (
                  <span className="v6-kpi-hint">
                    Published as canonical cost basis. Not reconstructed from transaction history; no lot
                    matching or averaging pass exists on this screen.
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="v6-kpi-label">Unrealized profit</dt>
              <dd>
                <span className="v6-kpi-value">
                  <FigureSlot
                    slot={totals.unrealizedPnl}
                    prefix="AED"
                    format={(value) => formatAed(value, { signed: true })}
                  />
                </span>
                <SlotNote slot={totals.unrealizedPnl} />
                {isAvailable(totals.unrealizedPnl) ? (
                  <span className="v6-kpi-hint">
                    {totals.unrealizedPnl.value >= 0 ? 'A gain' : 'A loss'} published by the canonical contract
                    as an AED amount, stated as it was published rather than subtracted from the figures beside
                    it.
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="v6-investments-hero-gaps">
            <UnavailableRegion slot={gaps.pnlPercent} inline />
            <UnavailableRegion slot={gaps.dayChange} inline />
          </div>
        </div>

        <div className="v6-investments-performance">
          <div className="v6-segmented v6-investments-ranges" role="group" aria-label="Performance range">
            {['1W', '1M', '3M', '6M', '1Y', 'All'].map((label) => (
              <button
                key={label}
                type="button"
                aria-disabled="true"
                aria-describedby="v6-investments-performance-gap"
                data-unsupported="true"
              >
                {label}
              </button>
            ))}
          </div>
          <div
            id="v6-investments-performance-gap"
            className="v6-investments-performance-frame"
            role="img"
            aria-label="Portfolio performance chart, not available. No approved contract publishes portfolio history, so no line is drawn."
          >
            <UnavailableRegion slot={gaps.performanceHistory} />
          </div>
          <div className="v6-investments-hero-gaps">
            <UnavailableRegion slot={gaps.returnMetrics} inline />
          </div>
        </div>
      </div>
    </section>
  )
}
