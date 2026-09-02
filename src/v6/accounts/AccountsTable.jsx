import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatNativeFigure, formatTimestamp } from '../format'

/**
 * The prototype's Account / Type / Owner / Native / AED / Updated table.
 *
 * One table with one header, exactly as the prototype has it, with each
 * canonical type group introduced by a full-width heading row inside its own
 * `tbody`. A real table rather than the prototype's grid of divs, so the
 * row-to-column relationship and the group a row belongs to both survive for
 * assistive technology.
 *
 * Three things this table deliberately does not do:
 *
 *  - it does not fill the AED column from the Native column. They are separate
 *    published facts, and a row that has one and not the other says so;
 *  - it does not print the legacy owner label. The model discards it, so the
 *    Owner column states the missing contract instead;
 *  - it does not judge the Valued column. The exact valuation timestamp and
 *    the contract's own freshness category are shown; no threshold turns
 *    either into "today", "recent" or "stale".
 *
 * Liabilities keep the canonical positive magnitude and are marked "Liability"
 * in text, so the asset/liability distinction never rests on a minus sign or
 * on colour.
 */

function QualityFlags({ row }) {
  const flags = []
  if (row.quality !== 'complete') flags.push({ key: 'quality', tone: 'review', label: row.quality })
  if (!isAvailable(row.aed)) flags.push({ key: 'aed', tone: 'review', label: 'No AED value' })
  if (!flags.length) return null
  return (
    <span className="v6-row-flags">
      {flags.map((flag) => <span key={flag.key} className="v6-flag" data-tone={flag.tone}>{flag.label}</span>)}
    </span>
  )
}

function AccountRow({ row, onOpenRow }) {
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 400 }}>
        <button type="button" className="v6-row-open" onClick={() => onOpenRow?.(row.id)}>
          {row.name}
        </button>
        <QualityFlags row={row} />
      </th>
      <td className="v6-col-type">
        {row.type}
        {row.isLiability ? <span className="v6-accounts-side">Liability</span> : null}
      </td>
      <td className="v6-col-owner"><span className="v6-tone-muted">Not available</span></td>
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
      <td className="v6-col-valued">
        <span className="v6-accounts-valued">{formatTimestamp(row.valuationAsOf) ?? 'Not recorded'}</span>
        <span className="v6-accounts-method">{row.valuationMethod}</span>
      </td>
    </tr>
  )
}

export default function AccountsTable({ positions, grouping, gaps, onOpenRow }) {
  if (positions.status !== 'available') {
    return (
      <section className="v6-section" aria-label="Account positions">
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">
            {positions.status === 'empty' ? 'No accounts to show.' : 'Account positions are not available.'}
          </p>
          <p className="v6-unavailable-detail">{positions.reason}</p>
        </div>
      </section>
    )
  }

  const unpricedRows = positions.rows.filter((row) => !isAvailable(row.aed))
  const hasInvestment = positions.sections.some((section) => section.key === 'investment')

  return (
    <section className="v6-section-lg v6-accounts-positions v6-enter" aria-labelledby="v6-accounts-positions-title">
      <div className="v6-section-head">
        <h2 id="v6-accounts-positions-title" className="v6-kicker-text">Accounts {grouping.label.toLowerCase()}</h2>
        <p className="v6-section-note">Current canonical valuation per account · liabilities shown as positive magnitudes</p>
      </div>

      <div className="v6-accounts-scroll" role="region" aria-label="Household accounts" tabIndex={0}>
        <table className="v6-accounts-table">
          <caption className="v6-visually-hidden">
            Household accounts grouped by canonical type. Native and AED values are separate canonical facts
            published per account; neither is converted from the other. Liability balances are positive magnitudes.
          </caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="v6-col-type">Type</th>
              <th scope="col" className="v6-col-owner">Owner</th>
              <th scope="col" className="v6-col-native">Native</th>
              <th scope="col" className="v6-col-amount">AED</th>
              <th scope="col" className="v6-col-valued">Valued</th>
            </tr>
          </thead>
          {positions.sections.map((section) => (
            <tbody key={section.key}>
              <tr className="v6-accounts-group-row">
                <th colSpan={6} scope="rowgroup">
                  {section.label}
                  <span className="v6-accounts-group-side">· {section.sideLabel}</span>
                  <span className="v6-accounts-group-count">
                    {section.count} {section.count === 1 ? 'account' : 'accounts'}
                  </span>
                </th>
              </tr>
              {section.rows.map((row) => <AccountRow key={row.id} row={row} onOpenRow={onOpenRow} />)}
            </tbody>
          ))}
        </table>
      </div>

      {unpricedRows.length > 0 ? (
        <ul className="v6-accounts-row-notes">
          {unpricedRows.map((row) => (
            <li key={row.id}><strong>{row.name}</strong> — {slotReason(row.aed)}</li>
          ))}
        </ul>
      ) : null}

      {/* Stated beside the columns and groupings they qualify, not only in the
          drawer: the Owner header is where a reader is most likely to assume
          the app knows who owns what, and a group heading is where a subtotal
          is most likely to be expected. */}
      <div className="v6-accounts-ownership-gap">
        <UnavailableRegion slot={gaps.ownership} inline />
        <UnavailableRegion slot={gaps.groupTotals} inline />
        {hasInvestment ? <UnavailableRegion slot={gaps.performance} inline /> : null}
      </div>
    </section>
  )
}
