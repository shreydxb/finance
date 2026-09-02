import DetailShell from '../../shell/RouteDetailShell'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatNativeFigure, formatTimestamp } from '../format'

/**
 * The holding detail drill-in.
 *
 * Read-only. The prototype's drawer edits the name, quantity, price, category
 * and owner. None of those writes can be proven safe against the current
 * contracts — a quantity or price write changes wealth truth permanently and
 * flows into every published balance sheet, portfolio total and snapshot — so
 * each is rendered as a named unsupported capability rather than wired to a
 * legacy writer or quietly removed.
 *
 * Nothing here is reconstructed. There is no position history, no trade list,
 * no realized return, no holding-level performance and no acquisition price,
 * because no contract publishes them and the ledger is not read on this screen
 * at all. The quantity and price shown are published evidence about how the
 * canonical valuation was reached; they are never multiplied together, and the
 * FX rate beside them is never applied.
 *
 * Focus trapping, background inertness, Escape and focus return to the
 * invoking row come from the shared SHR-152 `DetailShell`.
 */

function Field({ label, children }) {
  return (
    <div className="v6-drawer-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default function HoldingDrawer({ detail, model, onClose }) {
  const { capabilities, gaps } = model
  const row = detail.status === 'found' ? detail.row : null

  return (
    <DetailShell
      backLabel="Investments"
      title={row ? row.name : 'Holding unavailable'}
      onRequestClose={onClose}
    >
      {row ? (
        <div className="v6-surface">
          <p className="v6-kicker-text">
            Investment{row.ticker ? ` · ${row.ticker}` : ''} · {row.currency}
          </p>

          <p className="v6-drawer-amount">
            <FigureSlot slot={row.aed} prefix="AED" format={(value) => formatAed(value, { precise: true })} />
          </p>
          <p className="v6-unavailable-detail">
            {isAvailable(row.aed)
              ? 'Canonical AED valuation published for this holding. It is stated as published, not converted or multiplied out here.'
              : slotReason(row.aed)}
          </p>

          <dl className="v6-drawer-fields">
            <Field label={`Native value (${row.currency})`}>
              {isAvailable(row.native)
                ? `${row.currency} ${formatNativeFigure(row.native.value)}`
                : <span className="v6-tone-muted">{slotReason(row.native)}</span>}
            </Field>
            <Field label="Units held">
              {isAvailable(row.quantity)
                ? formatNativeFigure(row.quantity.value)
                : <span className="v6-tone-muted">{slotReason(row.quantity)}</span>}
            </Field>
            <Field label={`Published price (${row.priceCurrency})`}>
              {isAvailable(row.price)
                ? `${row.priceCurrency} ${formatNativeFigure(row.price.value)}`
                : <span className="v6-tone-muted">{slotReason(row.price)}</span>}
            </Field>
            <Field label="Price written at">{formatTimestamp(row.priceUpdatedAt) ?? 'Not recorded'}</Field>
            <Field label="Recorded price source">
              {row.priceSource ?? <span className="v6-tone-muted">Not recorded — entered by hand</span>}
            </Field>
            <Field label="Cost basis (AED)">
              {isAvailable(row.costBasisAed)
                ? formatAed(row.costBasisAed.value, { precise: true })
                : <span className="v6-tone-muted">{slotReason(row.costBasisAed)}</span>}
            </Field>
            <Field label="Unrealized profit (AED)">
              {isAvailable(row.unrealizedPnlAed) ? (
                <>
                  {formatAed(row.unrealizedPnlAed.value, { precise: true, signed: true })}
                  {' '}
                  <span className="v6-investments-profit-word">
                    {row.unrealizedPnlAed.value < 0 ? 'loss' : 'gain'}
                  </span>
                </>
              ) : (
                <span className="v6-tone-muted">{slotReason(row.unrealizedPnlAed)}</span>
              )}
            </Field>
            <Field label="Valuation method">{row.valuationMethod}</Field>
            <Field label="Valued as of">{formatTimestamp(row.valuationAsOf) ?? 'Not recorded'}</Field>
            <Field label="Valuation timestamp basis">{row.freshnessEvidence ?? 'Not published'}</Field>
            <Field label="Valuation quality">{row.quality}</Field>
            <Field label="Cost basis quality">{row.pnlQuality}</Field>
            <Field label="Published FX rate to AED">
              {row.fxRate === null
                ? <span className="v6-tone-muted">No published rate for {row.currency}</span>
                : row.fxRate}
            </Field>
            <Field label="FX timestamp">{formatTimestamp(row.fxUpdatedAt) ?? 'Not recorded'}</Field>
            <Field label="Owner"><span className="v6-tone-muted">Not available</span></Field>
            <Field label="Weight in portfolio"><span className="v6-tone-muted">Not available</span></Field>
          </dl>

          <p className="v6-unavailable-detail v6-investments-drawer-note">
            Units, price and the FX rate above are the evidence the canonical contract recorded for this
            valuation. They are shown so the published value can be checked against its inputs; the value itself
            was computed by the contract, not from these numbers here.
          </p>

          <div className="v6-drawer-actions">
            <button type="button" className="v6-unsupported-action" disabled>Edit holding</button>
            <button type="button" className="v6-unsupported-action" disabled>Update quantity</button>
            <button type="button" className="v6-unsupported-action" disabled>Update price</button>
            <button type="button" className="v6-unsupported-action" disabled>Record trade</button>
          </div>

          <div className="v6-investments-drawer-gaps">
            <UnavailableRegion slot={capabilities.editHolding} inline />
            <UnavailableRegion slot={gaps.performanceHistory} inline />
            <UnavailableRegion slot={gaps.dayChange} inline />
            <UnavailableRegion slot={gaps.pnlPercent} inline />
            <UnavailableRegion slot={gaps.allocation} inline />
            <UnavailableRegion slot={gaps.ownership} inline />
            <UnavailableRegion slot={gaps.container} inline />
            <UnavailableRegion slot={gaps.priceProvenance} inline />
          </div>
        </div>
      ) : (
        <div className="v6-surface">
          <UnavailableRegion slot={detail.slot} />
          <p className="v6-unavailable-detail v6-investments-drawer-note">
            Return to Investments and open a holding from the list.
          </p>
        </div>
      )}
    </DetailShell>
  )
}
