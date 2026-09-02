import { useCallback } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { resolveAccountDetail } from './data/accountsModel'
import { DEFAULT_ACCOUNTS_GROUP, isSupportedAccountsGroup } from './data/accountsGrouping'
import { useAccountsData } from './data/useAccountsData'
import AccountsHeader from './accounts/AccountsHeader'
import AccountsControls from './accounts/AccountsControls'
import AccountsTable from './accounts/AccountsTable'
import AccountsTotals from './accounts/AccountsTotals'
import AccountsQuality from './accounts/AccountsQuality'
import AccountDrawer from './accounts/AccountDrawer'
import './v6.css'

const LOADING_SUMMARY = Object.freeze({ accountCount: null, currencyCount: null, currencies: Object.freeze([]) })

/**
 * Wealth → Accounts.
 *
 * Composed fresh from the frozen Command Center prototype inside the SHR-155
 * V6 boundary. Nothing here comes from `src/screens/Accounts.jsx`; the shared
 * pieces are non-visual infrastructure only — routing and deep links, the
 * detail shell's focus behaviour, and the canonical read contracts.
 *
 * Read-only by design for this slice (SHR-180). Every write the prototype
 * exposes — add, edit, revalue, change owner, archive — is rendered as a named
 * unsupported capability under SHR-172 rather than wired to a legacy mutation
 * path, and opening the screen performs two selects and no write at all.
 */
export default function AccountsScreen({
  routeQuery,
  onRouteQueryChange,
  detailId,
  onOpenDetail,
  onCloseDetail,
  reads = canonicalReads,
}) {
  const group = routeQuery?.group
  const { model, loading, refreshing } = useAccountsData({ group, reads })

  const handleGroupChange = useCallback((next) => {
    if (!isSupportedAccountsGroup(next)) return
    onRouteQueryChange?.({ group: next === DEFAULT_ACCOUNTS_GROUP ? '' : next })
  }, [onRouteQueryChange])

  const handleOpenRow = useCallback((id) => {
    onOpenDetail?.('account', id)
  }, [onOpenDetail])

  const detail = resolveAccountDetail(model, detailId)

  return (
    <div className="v6-surface" data-testid="v6-accounts" data-read-only="true">
      <AccountsHeader summary={model?.summary ?? LOADING_SUMMARY} />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading the canonical account set and current balance sheet.'
          : refreshing ? 'Updating the canonical account set and current balance sheet.'
            : `Showing ${model.summary.accountCount ?? 0} whole-household accounts grouped ${model.grouping.label.toLowerCase()}.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Accounts loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical account contracts…</p>
            <p className="v6-unavailable-detail">
              Account positions and household totals are read separately. Nothing is estimated, converted,
              reconstructed from the ledger or written while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <AccountsControls
            grouping={model.grouping}
            summary={model.summary}
            gaps={model.gaps}
            onGroupChange={handleGroupChange}
          />
          <AccountsTable
            positions={model.positions}
            grouping={model.grouping}
            gaps={model.gaps}
            onOpenRow={handleOpenRow}
          />
          <AccountsTotals totals={model.totals} gaps={model.gaps} />
          <AccountsQuality totals={model.totals} gaps={model.gaps} />
          {detail.status !== 'none' ? (
            <AccountDrawer detail={detail} model={model} onClose={() => onCloseDetail?.()} />
          ) : null}
        </>
      )}
    </div>
  )
}
