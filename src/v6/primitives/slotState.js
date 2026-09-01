/**
 * Reading a canonical value slot.
 *
 * Kept out of the component file so the presentation module exports only
 * components (and so these predicates stay usable from pure tests).
 */

export function isAvailable(slot) {
  return slot?.status === 'available'
}

export function slotReason(slot) {
  if (!slot || slot.status === 'available') return null
  if (slot.gap) return slot.gap.reason
  return slot.reason ?? 'Not available.'
}

export function slotDetail(slot) {
  if (!slot || slot.status === 'available') return null
  return slot.gap?.detail ?? null
}

export function slotContract(slot) {
  return slot?.gap?.contract ?? null
}
