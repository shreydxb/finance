import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { formatAed, formatDayMonthYear, formatTimestamp } from '../format'
import { NET_WORTH_RANGE_OPTIONS } from '../data/netWorthRanges'

const STATUS_LABELS = Object.freeze({
  complete: 'Complete',
  provisional: 'Provisional',
  legacy: 'Legacy',
  skipped: 'Skipped — incomplete',
})

function HistoryDrawing({ geometry }) {
  return (
    <div className="v6-wealth-history-drawing" aria-hidden="true">
      <span className="v6-wealth-grid" data-line="top" />
      <span className="v6-wealth-grid" data-line="mid" />
      <span className="v6-wealth-grid" data-line="base" />
      {geometry.map((point) => (
        <span
          key={`${point.day}-${point.status}`}
          className="v6-wealth-drawing-point"
          data-quality={point.status}
          data-missing={point.missing ? 'true' : 'false'}
          style={{ left: `${point.x}%` }}
        >
          {point.missing ? <span className="v6-wealth-gap-mark" /> : (
            <>
              <span className="v6-wealth-asset-bar" style={{ height: `${point.assetHeight}%` }} />
              <span className="v6-wealth-liability-bar" style={{ height: `${point.liabilityHeight}%` }} />
              <span className="v6-wealth-net-point" style={{ top: `${point.netY}%` }} />
            </>
          )}
        </span>
      ))}
    </div>
  )
}

function provenanceText(row) {
  if (row.history_status === 'legacy') return 'Legacy point · authoritative provenance unavailable'
  if (row.history_status === 'skipped') return 'Authoritative run · no point published'
  const policy = row.quality_evidence?.policy_version
  return [row.source_version, policy].filter(Boolean).join(' · ') || 'Published authoritative snapshot'
}

export default function NetWorthHistory({ history, range, onRangeChange }) {
  return (
    <section className="v6-wealth-history v6-enter" aria-labelledby="net-worth-history-title">
      <div className="v6-wealth-history-head">
        <div>
          <h2 id="net-worth-history-title" className="v6-kicker-text">How it has changed</h2>
          <p className="v6-section-note">Published observations only · no interpolation, backfill or browser-created change</p>
        </div>
        <div className="v6-segmented" role="group" aria-label="Net worth history range">
          {NET_WORTH_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range.key === option.value}
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {history.status === 'unavailable' ? (
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">Snapshot history is not available.</p>
          <p className="v6-unavailable-detail">{history.reason}</p>
        </div>
      ) : history.status === 'empty' ? (
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">No snapshot facts in this range.</p>
          <p className="v6-unavailable-detail">{history.reason} Missing history remains missing; current account values are not used to fill it.</p>
        </div>
      ) : (
        <>
          <figure className="v6-wealth-history-figure">
            <HistoryDrawing geometry={history.geometry} />
            <figcaption className="v6-chart-legend">
              <span><i data-series="asset" />Assets</span>
              <span><i data-series="liability" />Liabilities</span>
              <span><i data-series="net" />Net worth point</span>
              <span><i data-series="provisional" />Provisional point</span>
              <span><i data-series="skipped" />Skipped publication</span>
            </figcaption>
          </figure>

          <div className="v6-wealth-history-table-wrap" role="region" aria-label="Authoritative net worth history table" tabIndex={0}>
            <table className="v6-wealth-history-table">
              <caption>Authoritative and preserved legacy snapshot facts. Change and saved positions remain unavailable under SHR-173 / SHR-153.</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="v6-numeric">Assets (AED)</th>
                  <th scope="col" className="v6-numeric">Liabilities (AED)</th>
                  <th scope="col" className="v6-numeric">Net worth (AED)</th>
                  <th scope="col">Quality</th>
                  <th scope="col">Snapshot evidence</th>
                  <th scope="col">Change</th>
                  <th scope="col">Saved</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={`${row.day}-${row.run_id ?? 'legacy'}`}>
                    <th scope="row">{formatDayMonthYear(row.day)}</th>
                    <td className="v6-numeric">{formatAed(row.assets_aed) ?? 'Not published'}</td>
                    <td className="v6-numeric">{formatAed(row.liabilities_aed) ?? 'Not published'}</td>
                    <td className="v6-numeric v6-fig-text">{formatAed(row.total_aed) ?? 'Not published'}</td>
                    <td>
                      <span className="v6-wealth-table-status">
                        <i className="v6-quality-dot" data-status={row.history_status} aria-hidden="true" />
                        {STATUS_LABELS[row.history_status] ?? row.history_status}
                      </span>
                    </td>
                    <td>
                      {provenanceText(row)}
                      {row.snapshot_at ? <span className="v6-list-meta">Captured {formatTimestamp(row.snapshot_at)}</span> : null}
                    </td>
                    <td><FigureSlot slot={row.change} /></td>
                    <td><FigureSlot slot={row.saved} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="v6-wealth-history-gaps">
        <UnavailableRegion slot={history.change} />
        <UnavailableRegion slot={history.saved} />
      </div>
    </section>
  )
}
