import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { formatAed } from '../format'

/**
 * The prototype's "Net" footer row, plus the assets and liabilities it is made
 * of.
 *
 * Every figure here comes from `canonical_balance_sheet` at household scope,
 * where a shared account is counted exactly once. None of them is a sum of the
 * table above — which is why an account whose AED value the contract withholds
 * can leave these totals withheld too, instead of silently dropping out of a
 * browser-side addition and producing a plausible, quietly-too-low number.
 */
export default function AccountsTotals({ totals, gaps }) {
  return (
    <section className="v6-section-lg v6-accounts-totals-section v6-enter" aria-labelledby="v6-accounts-totals-title">
      <div className="v6-section-head">
        <h2 id="v6-accounts-totals-title" className="v6-kicker-text">Household totals</h2>
        <p className="v6-section-note">
          canonical_balance_sheet · whole household · each account counted once · not a sum of the rows above
        </p>
      </div>

      <ul className="v6-wealth-totals v6-accounts-totals">
        <li>
          <span>Assets</span>
          <FigureSlot slot={totals.assets} prefix="AED" format={formatAed} />
        </li>
        <li>
          <span>Liabilities</span>
          <FigureSlot slot={totals.liabilities} prefix="AED" format={formatAed} tone="negative" />
        </li>
        <li>
          <span>Net</span>
          <FigureSlot slot={totals.net} prefix="AED" format={formatAed} className="v6-accounts-net-figure" />
        </li>
      </ul>

      <div className="v6-accounts-scope-gap">
        <UnavailableRegion slot={gaps.scope} inline />
      </div>
    </section>
  )
}
