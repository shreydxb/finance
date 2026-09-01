import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonth } from '../format'

function RowFlags({ row }) {
  const flags = []
  if (row.needsReview) flags.push({ key: 'review', tone: 'review', label: 'Needs review' })
  if (row.isTransfer) {
    flags.push({
      key: 'transfer',
      tone: 'transfer',
      label: row.transferDirection ? `Transfer ${row.transferDirection}` : 'Transfer',
    })
  }
  if (row.classification === 'savings_movement') flags.push({ key: 'savings', tone: 'transfer', label: 'Savings movement' })
  if (row.isSplit) flags.push({ key: 'split', tone: 'transfer', label: 'Category split' })
  if (row.quality !== 'complete') flags.push({ key: 'quality', tone: 'review', label: row.quality })
  if (!flags.length) return null

  return (
    <span className="v6-row-flags">
      {flags.map((flag) => <span key={flag.key} className="v6-flag" data-tone={flag.tone}>{flag.label}</span>)}
    </span>
  )
}

/**
 * The desktop Date / Description / Category / Owner / Account / Amount table.
 *
 * A real `table` rather than the prototype's grid of divs, so row and column
 * relationships survive for assistive technology. Owner and Account hide below
 * the prototype's breakpoint, and every field they carry stays available in
 * the row's detail drawer — the information is never simply dropped.
 *
 * Every state a row can be in is text as well as tone: "Needs review",
 * "Transfer out", "provisional". None of them is a colour on its own.
 */
export default function ActivityList({ model, onOpenRow }) {
  const { rows, list, filters, loadedCount, visibleCount, period, gaps } = model
  const searchGap = gaps.search

  if (list.status !== 'available') {
    return (
      <>
        <div className="v6-unavailable" role="note" style={{ marginTop: '20px' }}>
          <p className="v6-unavailable-label">
            {list.status === 'empty' ? 'No entries in this period.'
              : list.status === 'filtered-empty' ? 'No entries match these filters.'
                : 'Activity is not available.'}
          </p>
          <p className="v6-unavailable-detail">{list.reason}</p>
        </div>
        <div id="v6-activity-search-gap" style={{ marginTop: '14px' }}>
          <UnavailableRegion slot={searchGap} inline />
        </div>
      </>
    )
  }

  return (
    <>
      <div className="v6-activity-scroll" role="region" aria-label="Activity transactions" tabIndex={0}>
        <table className="v6-activity-table">
          <caption className="v6-visually-hidden">
            Canonical ledger entries for {period.label}. Amounts are the canonical AED amount recorded for each entry.
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Description</th>
              <th scope="col">Category</th>
              <th scope="col" className="v6-col-owner">Owner</th>
              <th scope="col" className="v6-col-account">Account</th>
              <th scope="col" className="v6-col-amount">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="v6-col-date">{formatDayMonth(row.date)}</td>
                <th scope="row" style={{ fontWeight: 400 }}>
                  <button type="button" className="v6-row-open" onClick={(event) => onOpenRow(row.id, event)}>
                    {row.description ?? 'No description recorded'}
                  </button>
                  <RowFlags row={row} />
                </th>
                <td>{row.categoryLabel}</td>
                <td className="v6-col-owner">{row.ownerLabel}</td>
                <td className="v6-col-account">
                  {isAvailable(row.account)
                    ? row.account.value
                    : <span className="v6-tone-muted">{slotReason(row.account)}</span>}
                </td>
                <td className="v6-col-amount">
                  <FigureSlot slot={row.amount} format={(value) => formatAed(value, { precise: true })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="v6-list-footer">
        <span>
          Showing {visibleCount} of {loadedCount} canonical {loadedCount === 1 ? 'entry' : 'entries'} read for {period.label}
          {filters.search || filters.category || filters.owner || filters.needsReview ? ' · filters applied' : ''}
        </span>
      </p>
      <div id="v6-activity-search-gap" style={{ marginTop: '10px' }}>
        <UnavailableRegion slot={searchGap} inline />
      </div>
    </>
  )
}
