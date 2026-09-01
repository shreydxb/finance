import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'
import { formatTimestamp } from '../format'

const QUALITY_COPY = {
  complete: { label: 'Complete', detail: 'Every required canonical input is present.' },
  provisional: { label: 'Provisional', detail: 'Figures may change once flagged entries are reviewed.' },
  incomplete: { label: 'Incomplete', detail: 'Affected canonical totals are withheld rather than estimated.' },
}

function QualityCard({ title, status, extra, fallbackLabel = 'Not read', fallbackDetail = 'This contract did not answer, so no quality claim is made.' }) {
  const copy = status ? QUALITY_COPY[status] : null
  return (
    <div className="v6-quality-card">
      <p className="v6-kicker-text">{title}</p>
      <p className="v6-quality-status">
        <span className="v6-quality-dot" data-status={status ?? 'unknown'} aria-hidden="true" />
        {copy ? copy.label : fallbackLabel}
      </p>
      <p className="v6-quality-detail">
        {copy ? copy.detail : fallbackDetail}
        {extra ? <><br />{extra}</> : null}
      </p>
    </div>
  )
}

/**
 * Quality and freshness.
 *
 * Every claim here is evidence a canonical contract returned: its own
 * `quality_status`, the FX timestamp it was computed against, and the account
 * valuation timestamps behind the balance sheet. Sync/integration health is a
 * named gap — deployment and configuration are not evidence that an
 * integration is working.
 */
export default function QualitySection({ quality }) {
  const fxTimestamp = formatTimestamp(quality.fxUpdatedAt)
  const oldest = formatTimestamp(quality.oldestAccountValuation)
  const newest = formatTimestamp(quality.newestAccountValuation)

  return (
    <Section className="v6-section-lg" kicker="Data quality and freshness">
      <div className="v6-quality-grid">
        <QualityCard
          title="This period"
          status={quality.period}
          extra={fxTimestamp ? `FX basis ${quality.fxBasis ?? 'unknown'}, updated ${fxTimestamp}.` : 'No FX timestamp was reported.'}
        />
        <QualityCard title="Balance sheet" status={quality.balance} />
        <QualityCard
          title="Investments"
          status={quality.investments}
          extra="Current positions only. No historical performance is claimed."
        />
        <QualityCard
          title="Account valuations"
          status={null}
          fallbackLabel={oldest ? 'Timestamped' : 'Not read'}
          fallbackDetail={oldest && newest
            ? `Valuation timestamps recorded on the canonical account view, between ${oldest} and ${newest}.`
            : 'No account valuation timestamps were read.'}
        />
      </div>
      <div style={{ marginTop: '16px' }}>
        <UnavailableRegion slot={quality.integrationStatus} inline />
      </div>
    </Section>
  )
}
