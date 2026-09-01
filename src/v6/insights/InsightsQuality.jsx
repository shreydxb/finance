import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'
import { pluralise } from '../format'

const QUALITY_COPY = {
  complete: { label: 'Complete', detail: 'Every required canonical input is present.' },
  provisional: { label: 'Provisional', detail: 'Published figures may change when review evidence changes.' },
  incomplete: { label: 'Incomplete', detail: 'Affected canonical totals are withheld rather than estimated.' },
}

function QualityCard({ title, status, statusLabel, detail }) {
  const copy = status ? QUALITY_COPY[status] : null
  return (
    <div className="v6-quality-card">
      <p className="v6-kicker-text">{title}</p>
      <p className="v6-quality-status">
        <span className="v6-quality-dot" data-status={status ?? 'unknown'} aria-hidden="true" />
        {statusLabel ?? copy?.label ?? 'Not read'}
      </p>
      <p className="v6-quality-detail">
        {copy?.detail ?? (statusLabel ? 'No set-level status is published.' : 'This contract did not answer, so no quality claim is made.')}
        {detail ? <><br />{detail}</> : null}
      </p>
    </div>
  )
}

export default function InsightsQuality({ model }) {
  const { summary, categories } = model

  return (
    <Section className="v6-section-lg" kicker="Data quality and completeness">
      <p className="v6-unavailable-detail">
        These are completeness fields returned by canonical contracts. They are not anomalies, attention items, unusual-spend claims or recommendations.
      </p>
      <div className="v6-quality-grid">
        <QualityCard
          title="Selected period"
          status={summary.quality}
          detail={summary.needsReviewCount === null
            ? 'No needs-review counter was read.'
            : `The period contract reports ${pluralise(summary.needsReviewCount, 'needs-review entry', 'needs-review entries')}; this is evidence, not a ranked alert.`}
        />
        <QualityCard
          title="Category actuals"
          status={null}
          statusLabel="No combined status"
          detail={categories.status === 'available'
            ? 'The contract publishes quality per reported category row, shown beside each row. It does not publish one set-level quality status, so none is inferred here.'
            : categories.reason}
        />
        <QualityCard
          title="Currency conversion"
          status={summary.missingFxCount === null ? null : summary.missingFxCount ? 'incomplete' : 'complete'}
          detail={summary.missingFxCount
            ? `${pluralise(summary.missingFxCount, 'entry', 'entries')} have no canonical FX rate${summary.missingFxCurrencies.length ? ` (${summary.missingFxCurrencies.join(', ')})` : ''}. Affected totals are withheld.`
            : 'The selected-period contract reports no missing canonical FX input.'}
        />
      </div>
      <div className="v6-insights-gap"><UnavailableRegion slot={model.gaps.attribution} inline /></div>
    </Section>
  )
}
