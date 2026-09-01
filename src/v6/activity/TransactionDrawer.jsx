import DetailShell from '../../shell/RouteDetailShell'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonthYear } from '../format'

function Field({ label, children }) {
  return (
    <div className="v6-drawer-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function SlotField({ label, slot }) {
  return (
    <Field label={label}>
      {isAvailable(slot) ? slot.value : <span className="v6-tone-muted">{slotReason(slot)}</span>}
    </Field>
  )
}

/**
 * The transaction detail drawer.
 *
 * Read-only. The prototype's drawer edits amount, category, owner and offers a
 * delete; none of those writes can be proven safe against the current
 * canonical contracts, so each is rendered as a named unsupported capability
 * rather than wired to a legacy path or silently dropped.
 *
 * Focus trapping, background inertness, Escape and focus return to the
 * invoking row all come from the shared `DetailShell` built in SHR-152 —
 * proven interaction infrastructure, not legacy presentation.
 */
export default function TransactionDrawer({ detail, model, onClose }) {
  const { capabilities, gaps, period } = model
  const row = detail.status === 'found' ? detail.row : null

  return (
    <DetailShell
      backLabel="Activity"
      title={row ? (row.description ?? 'Transaction') : 'Entry outside this period'}
      onRequestClose={onClose}
    >
      {row ? (
        <div className="v6-surface">
          <p className="v6-kicker-text">
            {row.classificationLabel} · {formatDayMonthYear(row.date)}
          </p>

          <p className="v6-drawer-amount">
            <FigureSlot
              slot={row.amount}
              prefix="AED"
              format={(value) => formatAed(value, { precise: true })}
            />
          </p>
          {!isAvailable(row.amount) ? (
            <p className="v6-unavailable-detail">{slotReason(row.amount)}</p>
          ) : (
            <p className="v6-unavailable-detail">
              Canonical AED amount recorded for this entry. Native currency: {row.currency}.
            </p>
          )}

          <dl className="v6-drawer-fields">
            <Field label="Date">{formatDayMonthYear(row.date)}</Field>
            <Field label="Category">{row.categoryLabel}</Field>
            <Field label="Recorded owner label">{row.ownerLabel}</Field>
            <SlotField label="Account" slot={row.account} />
            <Field label="Classification">{row.classificationLabel}</Field>
            <Field label="Quality">{row.quality}</Field>
            <Field label="Review state">{row.needsReview ? 'Needs review' : 'Not flagged for review'}</Field>
            {row.isTransfer ? (
              <Field label="Transfer direction">{row.transferDirection ?? 'Not recorded'}</Field>
            ) : null}
            {row.isSplit ? <Field label="Group">Category split</Field> : null}
          </dl>

          <p className="v6-unavailable-detail" style={{ marginTop: '18px' }}>
            Classification reason recorded by the canonical ledger:{' '}
            <span className="v6-tone-muted">{row.classificationReason}</span>
          </p>

          <div className="v6-drawer-actions">
            <button type="button" className="v6-unsupported-action" disabled>Edit</button>
            <button type="button" className="v6-unsupported-action" disabled>Split by category</button>
            <button type="button" className="v6-unsupported-action" disabled>Mark reviewed</button>
            <button type="button" className="v6-unsupported-action" disabled>Delete</button>
          </div>

          <div style={{ display: 'grid', gap: '14px', marginTop: '18px' }}>
            <UnavailableRegion slot={capabilities.edit} inline />
            <UnavailableRegion slot={capabilities.split} inline />
            <UnavailableRegion slot={capabilities.review} inline />
            <UnavailableRegion slot={capabilities.delete} inline />
            {row.isTransfer ? <UnavailableRegion slot={gaps.transferPairing} inline /> : null}
            <UnavailableRegion slot={gaps.refundLinkage} inline />
            <UnavailableRegion slot={gaps.provenance} inline />
            <UnavailableRegion slot={gaps.attribution} inline />
            <UnavailableRegion slot={gaps.categoryIdentity} inline />
            <UnavailableRegion slot={gaps.description} inline />
          </div>
        </div>
      ) : (
        // Deliberately not DetailShell's generic "record unavailable": that
        // would present a real transaction as nonexistent when all that
        // happened is that a different month was loaded.
        <div className="v6-surface">
          <UnavailableRegion slot={detail.slot} />
          <p className="v6-unavailable-detail" style={{ marginTop: '14px' }}>
            Activity has loaded {period.label}. Move to the month this entry belongs to and open it from the list.
          </p>
        </div>
      )}
    </DetailShell>
  )
}
