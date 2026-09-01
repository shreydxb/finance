import AppLink from '../../shell/AppLink'
import { FigureSlot } from '../primitives/Slot'
import { isAvailable, slotContract, slotReason } from '../primitives/slotState'
import { formatAed } from '../format'

function MetricSlot({ label, slot }) {
  return (
    <div className="v6-hero-metric">
      <p>{label}</p>
      <span className="v6-hero-metric-value">
        <FigureSlot slot={slot} format={(value) => formatAed(value)} />
      </span>
    </div>
  )
}

function StripItem({ label, slot }) {
  return (
    <li>
      {label}{' '}
      {isAvailable(slot)
        ? <strong><FigureSlot slot={slot} format={(value) => formatAed(value)} /></strong>
        : <span className="v6-tone-muted">Not available</span>}
    </li>
  )
}

/**
 * The dominant household figure and its compact summary strip.
 *
 * Net worth, assets, liabilities and investments come from
 * `canonical_balance_sheet` and `canonical_investment_metrics`. Change,
 * 12-month change, runway, equity share and daily investment movement have no
 * approved contract and say so rather than showing a number.
 */
export default function HouseholdSummary({ summary, navigate }) {
  return (
    <section className="v6-hero-section v6-enter" aria-labelledby="v6-net-worth-heading">
      <div className="v6-hero-row">
        <div className="v6-hero-main">
          <h2 id="v6-net-worth-heading" className="v6-kicker-text">Net worth</h2>
          <p className="v6-hero-value">
            <FigureSlot
              slot={summary.netWorth}
              prefix="AED"
              format={(value) => formatAed(value)}
              label={isAvailable(summary.netWorth) ? `Net worth, ${formatAed(summary.netWorth.value)} dirhams` : undefined}
            />
          </p>
          <div className="v6-hero-annotations">
            <span className="v6-tone-muted">This period: not available</span>
            <span className="v6-divider" aria-hidden="true">|</span>
            <span className="v6-tone-muted">12-month: not available</span>
            <span className="v6-divider" aria-hidden="true">|</span>
            <span className="v6-tone-muted">{summary.scopeNote}</span>
          </div>
        </div>
        <div className="v6-hero-side">
          <MetricSlot label="Change this period" slot={summary.changeThisPeriod} />
          <MetricSlot label="Runway" slot={summary.runway} />
          <AppLink href="/wealth/net-worth" navigate={navigate} className="v6-outline-link">
            History <span aria-hidden="true">→</span>
          </AppLink>
        </div>
      </div>
      <ul className="v6-strip">
        <StripItem label="Assets" slot={summary.assets} />
        <StripItem label="Liabilities" slot={summary.liabilities} />
        <StripItem label="Equity share" slot={summary.equityShare} />
        <StripItem label="Investments" slot={summary.investments} />
        <StripItem label="Investments today" slot={summary.investmentDayChange} />
      </ul>
      {/* The hero and strip stay scannable; the reason each missing figure is
          missing — and the contract that would supply it — is stated once
          here rather than crammed into every slot. */}
      <ul className="v6-strip-notes">
        {[
          ['Change this period', summary.changeThisPeriod],
          ['12-month change', summary.twelveMonthChange],
          ['Runway', summary.runway],
          ['Equity share', summary.equityShare],
          ['Investments today', summary.investmentDayChange],
          ['Assets and liabilities', summary.assets],
        ]
          .filter(([, slot]) => !isAvailable(slot))
          .map(([label, slot]) => (
            <li key={label}>
              {label}: {slotReason(slot)}
              {slotContract(slot) ? ` (${slotContract(slot)})` : ''}
            </li>
          ))}
      </ul>
    </section>
  )
}
