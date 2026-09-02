import { UnavailableRegion } from '../primitives/Slot'

/**
 * The prototype's "By type / By owner" segmented control and its trailing meta
 * line.
 *
 * "By owner" is rendered and disabled rather than removed. Hiding it would
 * misrepresent the product as not having the idea; wiring it to the legacy
 * `accounts.owner` label would publish a household-ownership claim the
 * database has never recorded. The disabled state is announced through
 * `aria-disabled` and `aria-describedby`, and the reason is visible text below
 * the control — never colour or a dimmed border alone.
 */
export default function AccountsControls({ grouping, summary, onGroupChange, gaps }) {
  const noteId = 'v6-accounts-owner-grouping-gap'

  return (
    <section className="v6-section v6-accounts-controls v6-enter" aria-labelledby="v6-accounts-grouping-title">
      <div className="v6-section-head">
        <h2 id="v6-accounts-grouping-title" className="v6-kicker-text">Grouping</h2>
        <p className="v6-section-note v6-accounts-meta">
          {summary.currencies.length > 0
            ? `Currencies recorded: ${summary.currencies.join(' · ')}`
            : 'Currencies are listed once the canonical account set answers'}
        </p>
      </div>

      <div className="v6-segmented v6-accounts-segmented" role="group" aria-label="Account grouping">
        {grouping.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.supported ? grouping.key === option.value : undefined}
            aria-disabled={option.supported ? undefined : 'true'}
            aria-describedby={option.supported ? undefined : noteId}
            data-unsupported={option.supported ? undefined : 'true'}
            onClick={option.supported ? () => onGroupChange?.(option.value) : undefined}
          >
            {option.label}
            {option.supported ? null : <span className="v6-accounts-segment-state"> · not available</span>}
          </button>
        ))}
      </div>

      <div id={noteId} className="v6-accounts-grouping-gap">
        <UnavailableRegion slot={gaps.ownerGrouping} inline />
      </div>
      {!grouping.honoured ? (
        <p className="v6-section-note v6-accounts-grouping-fallback" role="status">
          This link asked to group by owner. Accounts are grouped by canonical type instead, and nothing is
          regrouped by the legacy owner label.
        </p>
      ) : null}
    </section>
  )
}
