import { gapSlotFactory } from './slots.js'

/** Named fail-closed positions on the fresh Insights screen. */
export const INSIGHTS_GAPS = Object.freeze({
  categoryComparison: Object.freeze({
    id: 'insights-category-comparison',
    contract: 'SHR-169 — canonical Money Insights category analytical and trend reads',
    reason: 'Category comparison is not available yet.',
    detail: 'The current category actual can be reported, but no approved contract publishes its six-month average, change, percentage change, direction or explanatory note. The browser does not calculate any of those positions from monthly values.',
  }),
  categoryTrend: Object.freeze({
    id: 'insights-category-trend',
    contract: 'SHR-169 — canonical Money Insights trend read models',
    reason: 'Category trends and judgements are not available yet.',
    detail: 'Completed-month values below are individual facts already published by the period contract. They are not converted into a rising/falling label, moving average, anomaly, category trend identity or forecast in the browser.',
  }),
  descriptions: Object.freeze({
    id: 'insights-descriptions',
    contract: 'SHR-169 — description/payee identity decision and analytical reads',
    reason: 'Description and payee analysis is not available yet.',
    detail: 'No approved contract publishes ranked recorded descriptions or payee labels. Raw ledger rows are deliberately not grouped here, and recorded description text is never presented as canonical merchant identity.',
  }),
  merchantIdentity: Object.freeze({
    id: 'insights-merchant-identity',
    contract: 'SHR-169 — optional normalized merchant alias semantics',
    reason: 'Top merchants are not available yet.',
    detail: 'There is no canonical merchant identity, alias layer or merchant ranking. The screen does not trim, fuzzy-match, merge or otherwise normalize transaction descriptions in React.',
  }),
  explanation: Object.freeze({
    id: 'insights-explanation',
    contract: 'SHR-169 — canonical Money Insights analytical conclusions',
    reason: 'Explanatory insights are not available yet.',
    detail: 'No approved contract publishes a behavioural explanation, unusual-spend claim, cause, recommendation or prediction. The prototype position remains visible without invented prose.',
  }),
  incomeAnalysis: Object.freeze({
    id: 'insights-income-analysis',
    contract: 'SHR-167 — canonical Budget consumer migration and posted-income truth',
    reason: 'Income breakdown and comparison are not available yet.',
    detail: 'The selected-period posted-income total is published directly by canonical_period_metrics and is labelled exactly that way. Source breakdown, expected-versus-posted meaning, per-source trends and comparative income claims need the SHR-167 consumer contract and are withheld.',
  }),
  categoryIdentity: Object.freeze({
    id: 'insights-category-identity',
    contract: 'SHR-157 / SHR-198 — stable category identity and canonical v2 classification',
    reason: 'Categories are reported labels, not stable analytical identity.',
    detail: 'Each row is the label returned by canonical_budget_actuals, shown verbatim. Similar labels are never merged or aliased. The contract’s Uncategorised bucket remains distinct from a household category literally named Other.',
  }),
  attribution: Object.freeze({
    id: 'insights-attribution',
    contract: 'SHR-195 / SHR-156 — stable transaction attribution and household scope semantics',
    reason: 'Per-person and shared-versus-personal analysis is not available.',
    detail: 'This screen reports whole-household truth once. Recorded owner text, account labels and descriptions are not stable economic-party attribution, and shared money is never duplicated or divided between people.',
  }),
})

export const insightsGapSlot = gapSlotFactory(INSIGHTS_GAPS, 'Insights')
