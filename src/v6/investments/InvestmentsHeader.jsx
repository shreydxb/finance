import { pluralise } from '../format'

/**
 * The prototype's Wealth → Investments page header.
 *
 * The prototype's meta line pairs the portfolio with a day movement and a
 * refreshed-just-now claim. Only the counts survive here: they count canonical
 * rows and distinct canonical currency codes, which are structural facts. The
 * movement is withheld under SHR-176 and the freshness claim under SHR-172, in
 * their own regions, rather than being softened into a vaguer sentence.
 */
export default function InvestmentsHeader({ summary }) {
  const counts = summary.holdingCount === null
    ? 'Reading the canonical investment set'
    : `${pluralise(summary.holdingCount, 'holding')} · ${pluralise(summary.currencyCount, 'currency', 'currencies')}`

  return (
    <header className="v6-page-header v6-enter">
      <div>
        <p className="v6-kicker-text">Wealth</p>
        <h1 id="page-title" tabIndex={-1} className="v6-page-title">Investments</h1>
        <p className="v6-section-note v6-wealth-header-note">
          {counts} · current canonical valuation · whole household, each holding counted once
        </p>
      </div>
      <span className="v6-wealth-read-only" aria-label="Read-only screen">Read only</span>
    </header>
  )
}
