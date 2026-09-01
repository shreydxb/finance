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

function EvidenceList({ evidence, read }) {
  return (
    <div style={{ marginTop: '22px' }}>
      <p className="v6-kicker-text">Reported by the canonical read contracts</p>
      <p className="v6-unavailable-detail">
        Counters the read contracts returned, listed verbatim beside the field each came from. This is evidence about
        data completeness, not an attention feed: nothing here is ranked, prioritised, or asserted to need action.
      </p>
      {!read ? (
        <p className="v6-unavailable-detail">No canonical contract responded, so no evidence can be listed.</p>
      ) : evidence.length === 0 ? (
        <p className="v6-unavailable-detail">
          Every canonical read for this period reports complete inputs: no review flags, no missing FX rates, no
          unresolved placeholders.
        </p>
      ) : (
        <ul>
          {evidence.map((item) => (
            <li key={item.id} className="v6-attention-item">
              <span className="v6-attention-kind">{item.kind}</span>
              <span className="v6-attention-body">
                <span className="v6-attention-title">{item.title}</span>
                <span className="v6-attention-meta">
                  {item.meta}
                  <br />
                  <span className="v6-tone-muted">Source: {item.source}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
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
      <EvidenceList evidence={quality.evidence} read={quality.evidenceRead} />
      <div style={{ marginTop: '22px' }}>
        <UnavailableRegion slot={quality.integrationStatus} inline />
      </div>
    </Section>
  )
}
