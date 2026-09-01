import AppLink from '../../shell/AppLink'
import { FigureSlot } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, formatDayMonth, formatTimestamp, pluralise } from '../format'

function ColumnHead({ id, kicker, href, linkLabel, navigate }) {
  return (
    <div className="v6-section-head">
      <h2 id={id} className="v6-kicker-text">{kicker}</h2>
      {href ? (
        <AppLink href={href} navigate={navigate} className="v6-inline-link">
          {linkLabel} <span aria-hidden="true">→</span>
        </AppLink>
      ) : null}
    </div>
  )
}

function RegionNote({ children }) {
  return (
    <div className="v6-unavailable" role="note">
      <p className="v6-unavailable-detail" style={{ marginTop: 0 }}>{children}</p>
    </div>
  )
}

/** Top spend by canonical category actual, reconciled to the period total. */
export function TopSpendColumn({ topSpend, period }) {
  return (
    <div>
      <ColumnHead id="v6-top-spend" kicker={`Top spend · ${period.title.toLowerCase()}`} />
      {topSpend.status !== 'available' ? (
        <RegionNote>{topSpend.reason}</RegionNote>
      ) : topSpend.rows.length === 0 ? (
        <RegionNote>No canonical category actuals fall inside this period.</RegionNote>
      ) : (
        <ul className="v6-bar-rows">
          {topSpend.rows.map((row) => (
            <li key={row.key}>
              <span className="v6-bar-row-head">
                <span>{row.label}</span>
                <span className="v6-list-value">{formatAed(row.value)}</span>
              </span>
              <span className="v6-bar-track" aria-hidden="true">
                <span
                  className="v6-bar-fill"
                  style={{ width: `${(row.fill * 100).toFixed(2)}%`, opacity: Math.max(0.34, 1 - row.rank * 0.16) }}
                />
              </span>
              <span className="v6-bar-note">
                {pluralise(row.transactionCount, 'transaction')}
                {row.needsReviewCount > 0 ? <> · <span className="v6-tone-warning">{row.needsReviewCount} needs review</span></> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The most recent canonical ledger entries in the selected period. */
export function RecentActivityColumn({ recentActivity, navigate }) {
  return (
    <div>
      <ColumnHead
        id="v6-recent-activity"
        kicker="Recent activity"
        href="/money/activity"
        linkLabel="Activity"
        navigate={navigate}
      />
      {recentActivity.status === 'available' ? (
        <ul className="v6-list">
          {recentActivity.rows.map((row) => (
            <li key={row.key}>
              <span className="v6-list-primary">
                {row.title}
                <span className="v6-list-meta">
                  {formatDayMonth(row.date)}
                  {row.category ? <> · {row.category}</> : <> · Uncategorised</>}
                  {row.classification !== 'consumption_spend' ? <> · {row.classificationLabel}</> : null}
                  {row.needsReview ? <> · <span className="v6-tone-warning">needs review</span></> : null}
                  {!isAvailable(row.amount) ? <> · <span className="v6-tone-warning">{slotReason(row.amount)}</span></> : null}
                </span>
              </span>
              <span className="v6-list-value">
                <FigureSlot slot={row.amount} format={(value) => formatAed(value)} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <RegionNote>{recentActivity.reason}</RegionNote>
      )}
    </div>
  )
}

/** Canonical per-account AED values, assets before liabilities. */
export function AccountsColumn({ accounts, navigate }) {
  return (
    <div>
      <ColumnHead
        id="v6-accounts"
        kicker="Accounts"
        href="/wealth/accounts"
        linkLabel="Wealth"
        navigate={navigate}
      />
      {accounts.status === 'available' ? (
        <>
          <ul className="v6-list">
            {accounts.rows.map((row) => (
              <li key={row.key}>
                <span className="v6-list-primary">
                  {row.label}
                  <span className="v6-list-meta">
                    {row.typeLabel}
                    {row.owner ? <> · {row.owner}</> : null}
                    {row.isLiability ? <> · Liability</> : null}
                    {row.quality !== 'complete' ? <> · <span className="v6-tone-warning">{row.quality}</span></> : null}
                    {row.valuationAsOf ? <> · valued {formatTimestamp(row.valuationAsOf)}</> : null}
                  </span>
                </span>
                <span className="v6-list-value">
                  <FigureSlot
                    slot={row.amount}
                    format={(value) => (row.isLiability ? `−${formatAed(value)}` : formatAed(value))}
                    tone={row.isLiability ? 'negative' : undefined}
                  />
                </span>
              </li>
            ))}
          </ul>
          {accounts.total > accounts.rows.length ? (
            <p className="v6-bar-note">
              Showing {accounts.rows.length} of {accounts.total} accounts. Liability values are shown as negative magnitudes; the
              canonical contract stores them as positive.
            </p>
          ) : (
            <p className="v6-bar-note">
              Liability values are shown as negative magnitudes; the canonical contract stores them as positive.
            </p>
          )}
        </>
      ) : (
        <RegionNote>{accounts.reason}</RegionNote>
      )}
    </div>
  )
}
