import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatNativeFigure, formatTimestamp } from '../format'

/**
 * The prototype's Holding / Owner / Units / Price / Value AED / Change /
 * Weight table.
 *
 * A real table rather than the prototype's grid of divs, so the row-to-column
 * relationship survives for assistive technology, and so quantity, price and
 * value are readable as a row of one holding rather than three loose numbers.
 *
 * Five things this table deliberately does not do:
 *
 *  - it does not multiply Units by Price, and it does not apply the FX rate to
 *    either. All three are published evidence about how the canonical
 *    valuation was reached; the Value AED column is the contract's own
 *    `canonical_value_aed`, arriving finished from Postgres;
 *  - it does not fill Value AED from the native figure. They are separate
 *    published facts, and a holding that has one and not the other says so;
 *  - it does not print the legacy owner label. The model never receives it, so
 *    the Owner column states the missing contract instead;
 *  - it does not compute Weight. A share of the portfolio is an allocation
 *    fact no contract publishes, and the column carries that gap rather than a
 *    division performed here;
 *  - it does not judge the Valued column. The exact valuation timestamp, the
 *    contract's own freshness category and migration 028's recorded price
 *    source are shown; no threshold turns any of them into live, recent or
 *    stale.
 *
 * Gains and losses are never signalled by colour alone: the sign is carried in
 * the formatted figure itself, and a loss is additionally labelled in text.
 */

function QualityFlags({ row }) {
  const flags = []
  if (row.quality !== 'complete') flags.push({ key: 'quality', label: row.quality })
  if (!isAvailable(row.aed)) flags.push({ key: 'aed', label: 'No AED value' })
  if (!isAvailable(row.unrealizedPnlAed)) flags.push({ key: 'pnl', label: 'No cost basis' })
  if (!flags.length) return null
  return (
    <span className="v6-row-flags">
      {flags.map((flag) => <span key={flag.key} className="v6-flag" data-tone="review">{flag.label}</span>)}
    </span>
  )
}

function ProfitCell({ slot }) {
  if (!isAvailable(slot)) return <FigureSlot slot={slot} />
  const negative = slot.value < 0
  return (
    <span className="v6-investments-profit">
      <FigureSlot
        slot={slot}
        format={(value) => formatAed(value, { precise: true, signed: true })}
        tone={negative ? 'negative' : 'positive'}
      />
      <span className="v6-investments-profit-word">{negative ? 'loss' : 'gain'}</span>
    </span>
  )
}

function HoldingRow({ row, onOpenRow }) {
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 400 }}>
        <button type="button" className="v6-row-open" onClick={() => onOpenRow?.(row.id)}>
          {row.name}
        </button>
        {row.ticker ? <span className="v6-investments-ticker">{row.ticker}</span> : null}
        <QualityFlags row={row} />
      </th>
      <td className="v6-col-owner"><span className="v6-tone-muted">Not available</span></td>
      <td className="v6-col-units">
        {isAvailable(row.quantity)
          ? formatNativeFigure(row.quantity.value)
          : <span className="v6-tone-muted">Not recorded</span>}
      </td>
      <td className="v6-col-price">
        {isAvailable(row.price) ? (
          <span className="v6-investments-price">
            <span className="v6-accounts-native-code">{row.priceCurrency}</span>
            {' '}
            {formatNativeFigure(row.price.value)}
          </span>
        ) : (
          <span className="v6-tone-muted">No published price</span>
        )}
      </td>
      <td className="v6-col-native">
        {isAvailable(row.native) ? (
          <span className="v6-accounts-native">
            <span className="v6-accounts-native-code">{row.currency}</span>
            {' '}
            {formatNativeFigure(row.native.value)}
          </span>
        ) : (
          <FigureSlot slot={row.native} />
        )}
      </td>
      <td className="v6-col-amount">
        <FigureSlot slot={row.aed} format={(value) => formatAed(value, { precise: true })} />
      </td>
      <td className="v6-col-profit"><ProfitCell slot={row.unrealizedPnlAed} /></td>
      <td className="v6-col-weight"><span className="v6-tone-muted">Not available</span></td>
      <td className="v6-col-valued">
        <span className="v6-accounts-valued">{formatTimestamp(row.valuationAsOf) ?? 'Not recorded'}</span>
        <span className="v6-accounts-method">{row.valuationMethod}</span>
      </td>
    </tr>
  )
}

export default function InvestmentsTable({ positions, gaps, onOpenRow }) {
  if (positions.status !== 'available') {
    return (
      <section className="v6-section" aria-label="Investment positions">
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">
            {positions.status === 'empty' ? 'No holdings to show.' : 'Investment positions are not available.'}
          </p>
          <p className="v6-unavailable-detail">{positions.reason}</p>
        </div>
      </section>
    )
  }

  const unpricedRows = positions.rows.filter((row) => !isAvailable(row.aed))

  return (
    <section className="v6-section-lg v6-investments-positions v6-enter" aria-labelledby="v6-investments-positions-title">
      <div className="v6-section-head">
        <h2 id="v6-investments-positions-title" className="v6-kicker-text">Holdings</h2>
        <p className="v6-section-note">
          Current canonical valuation per holding · units, price and FX are the published evidence behind each
          value, never multiplied out here
        </p>
      </div>

      <div className="v6-investments-scroll" role="region" aria-label="Household investment holdings" tabIndex={0}>
        <table className="v6-investments-table">
          <caption className="v6-visually-hidden">
            Household investment holdings. Units, price, native value and AED value are separate facts published
            per holding by the canonical contract; none is derived from another in this screen. Unrealized profit
            is the contract’s own published amount, not the difference between the value and cost columns.
            Owner and weight are unavailable and state the contract that would supply them.
          </caption>
          <thead>
            <tr>
              <th scope="col">Holding</th>
              <th scope="col" className="v6-col-owner">Owner</th>
              <th scope="col" className="v6-col-units">Units</th>
              <th scope="col" className="v6-col-price">Price</th>
              <th scope="col" className="v6-col-native">Native value</th>
              <th scope="col" className="v6-col-amount">Value AED</th>
              <th scope="col" className="v6-col-profit">Unrealized</th>
              <th scope="col" className="v6-col-weight">Weight</th>
              <th scope="col" className="v6-col-valued">Valued</th>
            </tr>
          </thead>
          <tbody>
            {positions.rows.map((row) => <HoldingRow key={row.id} row={row} onOpenRow={onOpenRow} />)}
          </tbody>
        </table>
      </div>

      {unpricedRows.length > 0 ? (
        <ul className="v6-accounts-row-notes">
          {unpricedRows.map((row) => (
            <li key={row.id}><strong>{row.name}</strong> — {slotReason(row.aed)}</li>
          ))}
        </ul>
      ) : null}

      {/* Stated beside the columns they qualify, not only in the drawer. The
          Owner header is where a reader is most likely to assume the app knows
          who owns what, and the Weight header is where a percentage is most
          likely to be expected. */}
      <div className="v6-investments-table-gaps">
        <UnavailableRegion slot={gaps.ownership} inline />
        <UnavailableRegion slot={gaps.allocation} inline />
        <UnavailableRegion slot={gaps.dayChange} inline />
        <UnavailableRegion slot={gaps.container} inline />
      </div>
    </section>
  )
}
