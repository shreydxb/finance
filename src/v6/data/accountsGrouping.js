/**
 * The Accounts grouping vocabulary (SHR-180).
 *
 * The frozen prototype offers two segments, "By type" and "By owner". Only one
 * of them has canonical truth behind it:
 *
 *  - `type`  groups on `v_canonical_accounts_aed.type`, the account's recorded
 *            financial classification. It is read, never derived — no account
 *            name, note or amount is inspected to decide what an account is.
 *  - `owner` would group on an economic ownership fact. None is published, so
 *            the segment stays visible and disabled and grouping resolves to
 *            `type`. See `accountsGaps.js#ownerGrouping`.
 *
 * `supported: false` is part of the vocabulary rather than a filter, so the
 * control can render the position the prototype has instead of hiding it.
 */
export const ACCOUNTS_GROUP_OPTIONS = Object.freeze([
  Object.freeze({ value: 'type', label: 'By type', supported: true }),
  Object.freeze({ value: 'owner', label: 'By owner', supported: false, gap: 'ownerGrouping' }),
])

export const DEFAULT_ACCOUNTS_GROUP = 'type'

export function isAccountsGroup(value) {
  return ACCOUNTS_GROUP_OPTIONS.some((option) => option.value === value)
}

export function isSupportedAccountsGroup(value) {
  return ACCOUNTS_GROUP_OPTIONS.some((option) => option.value === value && option.supported)
}

/**
 * Resolves the requested grouping to one the screen can honour.
 *
 * A deep link asking for an unsupported grouping is not an error and is not
 * silently rewritten either: the resolved grouping is the supported default,
 * and `requested` records what was asked for so the screen can say why it is
 * not showing it.
 */
export function resolveAccountsGrouping(requested) {
  const asked = isAccountsGroup(requested) ? requested : DEFAULT_ACCOUNTS_GROUP
  const key = isSupportedAccountsGroup(asked) ? asked : DEFAULT_ACCOUNTS_GROUP
  return Object.freeze({
    key,
    requested: asked,
    honoured: key === asked,
    options: ACCOUNTS_GROUP_OPTIONS,
    label: ACCOUNTS_GROUP_OPTIONS.find((option) => option.value === key).label,
  })
}
