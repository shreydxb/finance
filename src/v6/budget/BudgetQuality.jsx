import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'
import { pluralise } from '../format'

const QUALITY_COPY = {
  complete: { label: 'Complete', detail: 'Every required canonical input is present.' },
  provisional: { label: 'Provisional', detail: 'Figures may change once flagged entries are reviewed.' },
  incomplete: { label: 'Incomplete', detail: 'Affected canonical totals are withheld rather than estimated.' },
}

function QualityCard({ title, status, extra }) {
  const copy = status ? QUALITY_COPY[status] : null
  return (
    <div className="v6-quality-card">
      <p className="v6-kicker-text">{title}</p>
      <p className="v6-quality-status">
        <span className="v6-quality-dot" data-status={status ?? 'unknown'} aria-hidden="true" />
        {copy ? copy.label : 'Not read'}
      </p>
      <p className="v6-quality-detail">
        {copy ? copy.detail : 'This contract did not answer, so no quality claim is made.'}
        {extra ? <><br />{extra}</> : null}
      </p>
    </div>
  )
}

/**
 * Budget's data-quality footer.
 *
 * Every claim here is a counter a canonical contract returned about its own
 * completeness, attributed to the field it came from. Nothing is ranked, and
 * nothing is asserted to need action — that is the attention registry's job,
 * not this screen's.
 */
export default function BudgetQuality({ model }) {
  const { summary, categories, gaps } = model
  const rows = categories.status === 'available' ? categories.rows : []
  const provisional = rows.filter((row) => row.quality === 'provisional')
  const incomplete = rows.filter((row) => row.quality === 'incomplete')

  return (
    <Section className="v6-section-lg" kicker="Data quality and completeness">
      <div className="v6-quality-grid">
        <QualityCard
          title="This period"
          status={summary.quality}
          extra={summary.needsReviewCount
            ? `${pluralise(summary.needsReviewCount, 'entry', 'entries')} flagged for review.`
            : 'No entry in this period is flagged for review.'}
        />
        <QualityCard
          title="Category actuals"
          status={categories.status === 'available'
            ? (incomplete.length ? 'incomplete' : provisional.length ? 'provisional' : 'complete')
            : null}
          extra={categories.status === 'available'
            ? `${rows.length} ${rows.length === 1 ? 'label' : 'labels'} reported · ${incomplete.length} incomplete · ${provisional.length} provisional.`
            : categories.reason}
        />
        <QualityCard
          title="Currency conversion"
          status={summary.missingFxCount === null ? null : summary.missingFxCount > 0 ? 'incomplete' : 'complete'}
          extra={summary.missingFxCount
            ? `${pluralise(summary.missingFxCount, 'entry', 'entries')} have no canonical FX rate${summary.missingFxCurrencies.length ? ` (${summary.missingFxCurrencies.join(', ')})` : ''}, so their category actual is withheld rather than converted in the browser.`
            : 'Every entry in this period has a canonical AED amount.'}
        />
      </div>

      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.allocation} inline />
      </div>
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.rollover} inline />
      </div>
    </Section>
  )
}
