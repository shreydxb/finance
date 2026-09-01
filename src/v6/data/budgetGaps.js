import { gapSlotFactory } from './slots.js'

/**
 * Named contract gaps for the V6 Budget screen.
 *
 * The frozen prototype's Budget page is built almost entirely out of
 * plan-versus-actual: a limit per category, a progress bar, a pace marker, a
 * projected close, a year grid whose last four columns are the plan, and a
 * "Net saved" line. Exactly one half of every one of those pairs exists as
 * canonical truth today — the actual. The plan does not.
 *
 * So Budget renders the prototype's composition in full and fills only the
 * half a canonical contract can answer. Each remaining slot states its own
 * gap and names the issue that would close it. None of them is quietly
 * computed from the actual, which is the failure mode this registry exists to
 * make impossible: `planned - actual`, `actual / planned` and a projected
 * close are all trivially derivable in React and all of them would be a
 * household figure no contract stands behind.
 */
export const BUDGET_GAPS = Object.freeze({
  plan: Object.freeze({
    id: 'budget-plan',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'The planned amount is not available yet.',
    detail: 'No versioned monthly plan contract exists, so this period has no canonical planned amount. The legacy `budgets` table is not a canonical contract and is deliberately not read here: it carries one undated limit per category with no period version, no effective history and no quality semantics, so presenting it as this month’s plan would state a number the household never set for this month.',
  }),
  remaining: Object.freeze({
    id: 'budget-remaining',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Budget left is not available yet.',
    detail: 'Remaining budget is planned minus actual. The actual is canonical; the plan is not published for this period, so the difference cannot be stated. Subtracting a legacy limit in the browser would create the figure rather than report it.',
  }),
  progress: Object.freeze({
    id: 'budget-progress',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Progress against plan is not available yet.',
    detail: 'A progress bar here would be actual divided by plan. No canonical contract publishes that ratio, and dividing by an unpublished plan in the browser would draw a proportion of nothing. The bars shown beside the category actuals are relative magnitude between canonical actuals only — they are not progress towards a limit.',
  }),
  pace: Object.freeze({
    id: 'budget-pace',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Pace against plan is not available yet.',
    detail: 'Pace compares spend so far against the share of the period elapsed and the plan for it. Days elapsed is a calendar fact, but the comparison it feeds is a plan judgement, so no "under pace", "on pace" or "over by" claim is made.',
  }),
  projectedClose: Object.freeze({
    id: 'budget-projected-close',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Projected close is not available yet.',
    detail: 'Projecting where a period will close needs an approved contract stating its inputs, its treatment of irregular and one-off spend, and what it does when inputs are incomplete. Extrapolating the month so far in the browser would be a forecast presented as household truth.',
  }),
  variance: Object.freeze({
    id: 'budget-variance',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Variance and "on track" judgements are not available.',
    detail: 'Over, under, on track and by how much are all statements about a plan. Nothing on this screen ranks, colours or narrates a category as doing well or badly against a target that does not exist.',
  }),
  rollover: Object.freeze({
    id: 'budget-rollover',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract (rollover is separately out of scope)',
    reason: 'Rollover between periods is not available.',
    detail: 'Carrying an unspent or overspent balance into the next period is explicitly outside the approved plan contract unless separately approved. No balance is carried, and none is implied.',
  }),
  allocation: Object.freeze({
    id: 'budget-allocation',
    contract: 'SHR-156 / SHR-195 — economic-party mapping and stable attribution',
    reason: 'Per-person budget allocation is not available.',
    detail: 'Budget here is whole-household truth, counted once. Splitting a plan or an actual between people needs stable economic-party facts; the prototype’s per-person allocation is a quarantined exception and is never implemented.',
  }),
  yearAggregate: Object.freeze({
    id: 'budget-year-aggregate',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Year totals, averages and net saved are not available.',
    detail: 'The year view navigates twelve canonical monthly reads. Totalling or averaging them in the browser would publish an annual figure no contract computed, and the plan half of the prototype’s year grid — its Sep–Dec planned cells and its Net saved line — has no canonical source at all.',
  }),
  income: Object.freeze({
    id: 'budget-income',
    contract: 'SHR-167 — canonical Budget consumer migration and posted-income truth',
    reason: 'Budget-period income is not available on this screen.',
    detail: 'The prototype’s year grid opens with per-source income rows and closes with net saved. Which income counts towards a budget period, and how it breaks down by source, is exactly what the posted-income truth contract settles. Budget states no income figure until it does, rather than borrowing a period total that was defined for a different question.',
  }),
  savings: Object.freeze({
    id: 'budget-savings',
    contract: 'SHR-167 — canonical Budget consumer migration and posted-income truth',
    reason: 'Savings and net-saved positions are not available on this screen.',
    detail: 'Canonical category actuals are consumption spend only — transfers and savings movements are excluded by the contract. A savings or net-saved position therefore cannot be assembled from them, and no assumption stands in for it.',
  }),
  categoryIdentity: Object.freeze({
    id: 'budget-category-identity',
    contract: 'SHR-198 — Category v2 resolver, canonical classification and writer compatibility',
    reason: 'Categories are the labels reported by the canonical actuals contract.',
    detail: 'Each row is one label as `canonical_budget_actuals` reported it, shown verbatim. There is no stable category identity behind it yet, so a label is never treated as a durable key, never merged with a similar one, and never inferred from description text. `Uncategorised` is the contract’s own bucket for entries carrying no category and is kept separate from any category the household happens to have named `Other`.',
  }),
  categoryGroups: Object.freeze({
    id: 'budget-category-groups',
    contract: 'SHR-198 — Category v2 resolver, canonical classification and writer compatibility',
    reason: 'Category groups are not available.',
    detail: 'The canonical actuals contract reports a flat list of labels. Grouping them into parents would invent a taxonomy the household never defined, so the rows are listed flat rather than nested under invented headings.',
  }),
  setBudget: Object.freeze({
    id: 'budget-set',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Setting a budget is not available on this screen yet.',
    detail: 'Writing a plan needs the versioned plan contract: which period a plan belongs to, how an edit versions the previous one, and what happens to historical plans. The legacy budget writer has none of that and is deliberately not wired in — a parallel write path would create plans the plan contract could not later interpret.',
  }),
  editBudget: Object.freeze({
    id: 'budget-edit',
    contract: 'SHR-166 — versioned monthly Budget plan and projected-close contract',
    reason: 'Editing a category plan is not available on this screen yet.',
    detail: 'The prototype opens an editor from a category row and from each planned cell of the year grid. Both write a period-specific plan, which is the same missing contract. Rows are read-only until it exists.',
  }),
  categoryAdmin: Object.freeze({
    id: 'budget-category-admin',
    contract: 'SHR-198 — Category v2 resolver, canonical classification and writer compatibility',
    reason: 'Renaming, archiving and deleting categories are not available here.',
    detail: 'Category lifecycle is not a Budget-screen concern and is not introduced by this screen. Nothing here renames, archives, merges or hides a label the canonical contract reported.',
  }),
})

export const budgetGapSlot = gapSlotFactory(BUDGET_GAPS, 'Budget')
