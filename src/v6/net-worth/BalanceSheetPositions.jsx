import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { formatAed, formatTimestamp } from '../format'

function PositionList({ title, rows, total, liability = false }) {
  return (
    <section aria-labelledby={`${title.toLowerCase()}-positions-title`}>
      <div className="v6-section-head">
        <h2 id={`${title.toLowerCase()}-positions-title`} className="v6-kicker-text">{title}</h2>
        <span className="v6-section-note">Canonical current positions</span>
      </div>
      {rows.length === 0 ? (
        <p className="v6-wealth-empty">No canonical {title.toLowerCase()} positions are recorded.</p>
      ) : (
        <ul className="v6-wealth-position-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <span className="v6-list-primary">{row.name}</span>
                <span className="v6-list-meta">
                  {row.type} · {row.currency} · {row.valuationMethod}
                  {row.valuationAsOf ? <> · valued {formatTimestamp(row.valuationAsOf)}</> : null}
                </span>
                <span className="v6-wealth-row-quality">Quality: {row.quality}</span>
              </div>
              <FigureSlot slot={row.value} prefix="AED" format={formatAed} tone={liability ? 'negative' : undefined} className="v6-list-value" />
            </li>
          ))}
        </ul>
      )}
      <div className="v6-wealth-total">
        <span>Total {title.toLowerCase()}</span>
        <FigureSlot slot={total} prefix="AED" format={formatAed} tone={liability ? 'negative' : undefined} />
      </div>
    </section>
  )
}

export default function BalanceSheetPositions({ accounts, current, provenance }) {
  if (accounts.status !== 'available' && accounts.status !== 'empty') {
    return (
      <section className="v6-section" aria-label="Current asset and liability positions">
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">Current positions are not available.</p>
          <p className="v6-unavailable-detail">{accounts.reason}</p>
        </div>
      </section>
    )
  }
  return (
    <div className="v6-g2 v6-wealth-positions v6-enter">
      <PositionList title="Assets" rows={accounts.assets} total={current.assets} />
      <div>
        <PositionList title="Liabilities" rows={accounts.liabilities} total={current.liabilities} liability />
        <section className="v6-wealth-monthly-change" aria-labelledby="monthly-change-title">
          <h2 id="monthly-change-title" className="v6-kicker-text">Monthly change</h2>
          <UnavailableRegion slot={current.change} />
        </section>
        <section className="v6-wealth-provenance-position" aria-labelledby="valuation-provenance-title">
          <h2 id="valuation-provenance-title" className="v6-kicker-text">Valuation provenance</h2>
          <UnavailableRegion slot={provenance} />
        </section>
      </div>
    </div>
  )
}
