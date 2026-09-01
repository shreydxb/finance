import { classes } from '../../design-system/classes'
import { isAvailable, slotContract, slotDetail, slotReason } from './slotState'

/**
 * Presentation for a canonical value slot.
 *
 * A slot is never rendered as a bare dash. `available` prints the canonical
 * figure; `incomplete` and `unavailable` print a short text state — not colour
 * alone — and the accompanying `SlotNote` prints why, naming the contract that
 * would supply it.
 */

const STATE_LABELS = {
  incomplete: 'Incomplete',
  unavailable: 'Not available',
  empty: 'None',
}

export function FigureSlot({ slot, format, className, prefix, tone, label }) {
  if (isAvailable(slot)) {
    const formatted = format ? format(slot.value) : String(slot.value)
    return (
      <span
        className={classes('v6-fig-text', tone === 'positive' && 'v6-tone-positive', tone === 'negative' && 'v6-tone-negative', className)}
        aria-label={label}
      >
        {prefix ? <span className="v6-hero-currency">{prefix} </span> : null}
        {formatted}
      </span>
    )
  }
  return (
    <span className={classes('v6-missing-figure', className)}>
      <span>{STATE_LABELS[slot?.status] ?? STATE_LABELS.unavailable}</span>
    </span>
  )
}

export function SlotNote({ slot, className }) {
  const reason = slotReason(slot)
  if (!reason) return null
  const contract = slotContract(slot)
  return (
    <span className={classes('v6-kpi-hint', className)}>
      {reason}
      {contract ? <><br />{contract}</> : null}
    </span>
  )
}

/**
 * A whole region the screen cannot fill. Deliberately styled as a real piece
 * of the page rather than an error: the gap is the current truthful answer.
 */
export function UnavailableRegion({ slot, inline = false, children }) {
  const reason = slotReason(slot)
  const detail = slotDetail(slot)
  const contract = slotContract(slot)
  return (
    <div className={classes('v6-unavailable', inline && 'v6-unavailable-inline')} role="note">
      <p className="v6-unavailable-label">{reason}</p>
      {detail ? <p className="v6-unavailable-detail">{detail}</p> : null}
      {contract ? <p className="v6-unavailable-gap">Awaiting {contract}</p> : null}
      {children}
    </div>
  )
}
