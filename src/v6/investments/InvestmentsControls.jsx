import { UnavailableRegion } from '../primitives/Slot'
import { formatTimestamp } from '../format'

/**
 * The prototype's asset-class filter row, its price/FX meta line, and the
 * "Refresh prices" and "+ Holding" buttons.
 *
 * Every control is rendered and disabled rather than removed. Hiding them
 * would misrepresent the product as not having the idea; wiring them would
 * either group holdings by a class no contract publishes, or write wealth
 * truth through a path no approved contract governs. Disabled states are
 * announced through `aria-disabled` and `aria-describedby`, and each reason is
 * visible text — never a dimmed border or colour alone.
 *
 * The meta line states exact published timestamps only. The prototype's
 * "Prices just now / FX 6 days old" is a freshness verdict, and it is withheld
 * under its own region rather than recomputed here from a clock.
 */
export default function InvestmentsControls({ totals, capabilities, gaps }) {
  const classNoteId = 'v6-investments-asset-class-gap'
  const maintenanceNoteId = 'v6-investments-maintenance-gap'
  const newest = formatTimestamp(totals.newestValuationAt)
  const oldest = formatTimestamp(totals.oldestValuationAt)
  const fx = formatTimestamp(totals.fxUpdatedAt)

  return (
    <section className="v6-section v6-investments-controls v6-enter" aria-labelledby="v6-investments-controls-title">
      <div className="v6-section-head">
        <h2 id="v6-investments-controls-title" className="v6-kicker-text">Portfolio view</h2>
        <p className="v6-section-note v6-investments-meta">
          Valuations {oldest && newest ? `between ${oldest} and ${newest}` : 'not yet read'}
          {' · '}FX rates published {fx ?? 'at a time not recorded'}
        </p>
      </div>

      <div className="v6-segmented v6-investments-segmented" role="group" aria-label="Asset class filter">
        {['All holdings', 'Global', 'UAE', 'India', 'Crypto'].map((label, index) => (
          <button
            key={label}
            type="button"
            aria-disabled="true"
            aria-describedby={classNoteId}
            data-unsupported="true"
            aria-pressed={index === 0 ? undefined : undefined}
          >
            {label}
            <span className="v6-investments-segment-state"> · not available</span>
          </button>
        ))}
      </div>

      <div className="v6-investments-actions">
        <button type="button" className="v6-unsupported-action" disabled aria-describedby={maintenanceNoteId}>
          Refresh prices
        </button>
        <button type="button" className="v6-unsupported-action" disabled aria-describedby={maintenanceNoteId}>
          + Holding
        </button>
      </div>

      <div id={classNoteId} className="v6-investments-gap-stack">
        <UnavailableRegion slot={gaps.assetClass} inline />
      </div>
      <div id={maintenanceNoteId} className="v6-investments-gap-stack">
        <UnavailableRegion slot={capabilities.refreshPrices} inline />
        <UnavailableRegion slot={gaps.scope} inline />
      </div>
    </section>
  )
}
