import { useCallback } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { resolveHoldingDetail } from './data/investmentsModel'
import { useInvestmentsData } from './data/useInvestmentsData'
import InvestmentsHeader from './investments/InvestmentsHeader'
import InvestmentsControls from './investments/InvestmentsControls'
import InvestmentsSummary from './investments/InvestmentsSummary'
import InvestmentsAllocation from './investments/InvestmentsAllocation'
import InvestmentsTable from './investments/InvestmentsTable'
import InvestmentsQuality from './investments/InvestmentsQuality'
import HoldingDrawer from './investments/HoldingDrawer'
import './v6.css'

const LOADING_SUMMARY = Object.freeze({ holdingCount: null, currencyCount: null, currencies: Object.freeze([]) })

/**
 * Wealth → Investments.
 *
 * Composed fresh from the frozen Command Center prototype inside the SHR-155
 * V6 boundary. Nothing here comes from `src/screens/Investments.jsx`; the
 * shared pieces are non-visual infrastructure only — routing and deep links,
 * the detail shell's focus behaviour, and the canonical read contracts.
 *
 * Read-only by design for this slice (SHR-202). Every write the prototype
 * exposes — refresh prices, add a holding, edit a quantity or a price, record
 * a trade — is rendered as a named unsupported capability rather than wired to
 * a legacy mutation path, and opening the screen performs two selects and no
 * write at all: no snapshot, no valuation stamp, no price fetch.
 *
 * The screen is whole-household truth and every holding is counted exactly
 * once. It carries no scope selector, because a personal view requires
 * economic-party semantics no contract publishes; the composition is written
 * for any number of parties rather than assuming two.
 */
export default function InvestmentsScreen({
  detailId,
  onOpenDetail,
  onCloseDetail,
  reads = canonicalReads,
}) {
  const { model, loading, refreshing } = useInvestmentsData({ reads })

  const handleOpenRow = useCallback((id) => {
    onOpenDetail?.('investment', id)
  }, [onOpenDetail])

  const detail = resolveHoldingDetail(model, detailId)

  return (
    <div className="v6-surface" data-testid="v6-investments" data-read-only="true">
      <InvestmentsHeader summary={model?.summary ?? LOADING_SUMMARY} />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading the canonical investment set and current portfolio metrics.'
          : refreshing ? 'Updating the canonical investment set and current portfolio metrics.'
            : `Showing ${model.summary.holdingCount ?? 0} whole-household holdings.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Investments loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical investment contracts…</p>
            <p className="v6-unavailable-detail">
              Portfolio metrics and holding positions are read separately. Nothing is estimated, converted,
              multiplied out, reconstructed from the ledger or written while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <InvestmentsSummary totals={model.totals} gaps={model.gaps} />
          <InvestmentsControls totals={model.totals} capabilities={model.capabilities} gaps={model.gaps} />
          <InvestmentsAllocation gaps={model.gaps} />
          <InvestmentsTable positions={model.positions} gaps={model.gaps} onOpenRow={handleOpenRow} />
          <InvestmentsQuality totals={model.totals} gaps={model.gaps} />
          {detail.status !== 'none' ? (
            <HoldingDrawer detail={detail} model={model} onClose={() => onCloseDetail?.()} />
          ) : null}
        </>
      )}
    </div>
  )
}
