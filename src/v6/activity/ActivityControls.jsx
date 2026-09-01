import { UnavailableRegion } from '../primitives/Slot'
import { SORT_OPTIONS, VIEW_OPTIONS } from '../data/activityModel'

/**
 * Search, filters, the list/calendar switch and the add affordance.
 *
 * Two honesty rules shape this row:
 *
 *  - The search and filter controls narrow the canonical rows already read for
 *    the period. They are labelled that way, and the SHR-163 gap is stated
 *    beneath, so nobody reads an empty result as "the household has no such
 *    transaction".
 *  - "Add transaction" is rendered, disabled, naming its missing contract. It
 *    is not wired to a legacy writer, and it is not hidden — hiding it would
 *    misrepresent the product as not having the idea.
 */
export default function ActivityControls({ model, onFilterChange, onViewChange }) {
  const { filters, filterOptions, view, capabilities, reviewCount } = model

  return (
    <section aria-label="Activity search and filters">
      <div className="v6-controls">
        <div className="v6-field">
          <label htmlFor="v6-activity-search">Search</label>
          <input
            id="v6-activity-search"
            className="v6-input"
            type="search"
            value={filters.search}
            placeholder="Description, category, owner or account"
            aria-describedby="v6-activity-search-gap"
            onChange={(event) => onFilterChange({ search: event.target.value })}
          />
        </div>

        <div className="v6-field">
          <label htmlFor="v6-activity-owner">Owner</label>
          <select
            id="v6-activity-owner"
            className="v6-select"
            value={filters.owner}
            onChange={(event) => onFilterChange({ owner: event.target.value })}
          >
            <option value="">All owners</option>
            {filterOptions.owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
          </select>
        </div>

        <div className="v6-field">
          <label htmlFor="v6-activity-category">Category</label>
          <select
            id="v6-activity-category"
            className="v6-select"
            value={filters.category}
            onChange={(event) => onFilterChange({ category: event.target.value })}
          >
            <option value="">All categories</option>
            {filterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>

        <div className="v6-field">
          <label htmlFor="v6-activity-sort">Sort</label>
          <select
            id="v6-activity-sort"
            className="v6-select"
            value={filters.sort}
            onChange={(event) => onFilterChange({ sort: event.target.value })}
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <button
          type="button"
          className="v6-toggle"
          aria-pressed={filters.needsReview}
          onClick={() => onFilterChange({ needsReview: !filters.needsReview })}
        >
          Needs review{reviewCount > 0 ? ` · ${reviewCount}` : ''}
        </button>

        <div className="v6-controls-trailing">
          <div className="v6-segmented" role="group" aria-label="Activity view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === view}
                onClick={() => onViewChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="v6-unsupported-action"
            disabled
            aria-describedby="v6-activity-create-gap"
          >
            <span aria-hidden="true">+</span> Add transaction
          </button>
        </div>
      </div>

      <div id="v6-activity-create-gap" style={{ marginTop: '12px' }}>
        <UnavailableRegion slot={capabilities.create} inline />
      </div>
    </section>
  )
}
