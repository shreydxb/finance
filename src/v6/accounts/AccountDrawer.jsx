import DetailShell from '../../shell/RouteDetailShell'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatNativeFigure, formatTimestamp } from '../format'

/**
 * The account detail drill-in.
 *
 * Read-only. The prototype's drawer edits the name, type, currency, balance
 * and owner, and toggles whether the account counts toward net worth. None of
 * those writes can be proven safe against the current contracts — a valuation
 * write changes wealth truth permanently and flows into every published
 * balance sheet and snapshot — so each is rendered as a named unsupported
 * capability rather than wired to a legacy writer or quietly removed.
 *
 * Nothing in here is reconstructed. There is no balance history, no valuation
 * history, no contribution total and no return figure, because no contract
 * publishes them and the ledger is not read on this screen at all.
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

export default function AccountDrawer({ detail, model, onClose }) {
  const { capabilities, gaps } = model
  const row = detail.status === 'found' ? detail.row : null

  return (
    <DetailShell
      backLabel="Accounts"
      title={row ? row.name : 'Account unavailable'}
      onRequestClose={onClose}
    >
      {row ? (
        <div className="v6-surface">
          <p className="v6-kicker-text">{row.type} · {row.sideLabel} · {row.currency}</p>

          <p className="v6-drawer-amount">
            <FigureSlot slot={row.aed} prefix="AED" format={(value) => formatAed(value, { precise: true })} />
          </p>
          <p className="v6-unavailable-detail">
            {isAvailable(row.aed)
              ? 'Canonical AED valuation published for this account. It is stated as published, not converted here.'
              : slotReason(row.aed)}
          </p>

          <dl className="v6-drawer-fields">
            <Field label={`Native value (${row.currency})`}>
              {isAvailable(row.native)
                ? `${row.currency} ${formatNativeFigure(row.native.value)}`
                : <span className="v6-tone-muted">{slotReason(row.native)}</span>}
            </Field>
            <Field label="Balance sheet side">{row.sideLabel}</Field>
            <Field label="Type">{row.type}</Field>
            <Field label="Valuation method">{row.valuationMethod}</Field>
            <Field label="Valued as of">{formatTimestamp(row.valuationAsOf) ?? 'Not recorded'}</Field>
            <Field label="Valuation timestamp basis">{row.freshnessEvidence ?? 'Not published'}</Field>
            <Field label="Quality">{row.quality}</Field>
            <Field label="Published FX rate to AED">
              {row.fxRate === null
                ? <span className="v6-tone-muted">No published rate for {row.currency}</span>
                : row.fxRate}
            </Field>
            <Field label="FX timestamp">{formatTimestamp(row.fxUpdatedAt) ?? 'Not recorded'}</Field>
            <Field label="Owner">
              <span className="v6-tone-muted">Not available</span>
            </Field>
          </dl>

          <p className="v6-unavailable-detail v6-accounts-drawer-note">
            The native and AED figures above are two facts the canonical contract publishes for this account.
            The FX rate is the evidence it recorded, not a conversion performed here.
          </p>

          <div className="v6-drawer-actions">
            <button type="button" className="v6-unsupported-action" disabled>Edit account</button>
            <button type="button" className="v6-unsupported-action" disabled>Update valuation</button>
            <button type="button" className="v6-unsupported-action" disabled>Change owner</button>
            <button type="button" className="v6-unsupported-action" disabled>Counts toward net worth</button>
            <button type="button" className="v6-unsupported-action" disabled>Archive</button>
          </div>

          <div className="v6-accounts-drawer-gaps">
            <UnavailableRegion slot={capabilities.edit} inline />
            <UnavailableRegion slot={capabilities.changeOwner} inline />
            <UnavailableRegion slot={capabilities.countTowardNetWorth} inline />
            <UnavailableRegion slot={gaps.history} inline />
            <UnavailableRegion slot={gaps.provenance} inline />
            <UnavailableRegion slot={gaps.performance} inline />
            <UnavailableRegion slot={gaps.ownership} inline />
          </div>
        </div>
      ) : (
        <div className="v6-surface">
          <UnavailableRegion slot={detail.slot} />
          <p className="v6-unavailable-detail v6-accounts-drawer-note">
            Return to Accounts and open a record from the list.
          </p>
        </div>
      )}
    </DetailShell>
  )
}
