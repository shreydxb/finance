import { pluralise } from '../format'

/**
 * The prototype's Wealth → Accounts page header.
 *
 * The prototype's meta line reads "10 accounts · 3 currencies · all valued
 * today". The first two are counts of canonical rows and of the distinct
 * currency codes on them, so they are stated. The third is a freshness verdict
 * no contract publishes; it is withheld here and named under Quality and
 * freshness rather than softened into a vaguer claim.
 */
export default function AccountsHeader({ summary }) {
  const counts = summary.accountCount === null
    ? 'Reading the canonical account set'
    : `${pluralise(summary.accountCount, 'account')} · ${pluralise(summary.currencyCount, 'currency', 'currencies')}`

  return (
    <header className="v6-page-header v6-enter">
      <div>
        <p className="v6-kicker-text">Wealth</p>
        <h1 id="page-title" tabIndex={-1} className="v6-page-title">Accounts</h1>
        <p className="v6-section-note v6-wealth-header-note">
          {counts} · current canonical valuation · whole household, each account counted once
        </p>
      </div>
      <span className="v6-wealth-read-only" aria-label="Read-only screen">Read only</span>
    </header>
  )
}
