import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function walk(directory) {
  const entries = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) entries.push(...walk(path))
    else if (/\.(jsx?|css)$/.test(name)) entries.push(path)
  }
  return entries
}

const files = walk(ROOT)
const sources = files.map((path) => ({
  path: path.slice(ROOT.length).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}))

test('the V6 surface has files to guard', () => {
  assert.ok(sources.length >= 25, `expected the V6 surface to contain modules, found ${sources.length}`)
})

test('no V6 module imports legacy screen or component presentation', () => {
  const offenders = sources
    .filter((file) => !file.path.endsWith('v6-boundary.test.js'))
    .filter((file) => /from\s+'[^']*\/(screens|components)\//.test(file.text))
    .map((file) => file.path)
  assert.deepEqual(offenders, [], 'V6 composition must not be built from the legacy component hierarchy')
})

test('no V6 module consumes a legacy global CSS ramp', () => {
  // The legacy `@theme` ramps in src/index.css stay in place for the legacy
  // screens. A V6 file reaching for one would reintroduce the old visual
  // system through the back door, so the boundary forbids them outright.
  const legacyUtility = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder|accent|outline|decoration|shadow)-(?:ink|brand|pos|neg|night)-\d{2,3}\b|\bbg-night\b|\bshadow-(?:card|lift|pop|hero)\b/
  const offenders = sources
    .filter((file) => !file.path.endsWith('v6-boundary.test.js'))
    .filter((file) => legacyUtility.test(file.text))
    .map((file) => file.path)
  assert.deepEqual(offenders, [], 'V6 files must style themselves through the SHR-151 semantic tokens')
})

test('V6 surface styles are scoped so legacy globals cannot leak in', () => {
  const css = sources.find((file) => file.path === 'v6.css')
  assert.ok(css, 'src/v6/v6.css must exist')
  const selectors = css.text
    .split('\n')
    .filter((line) => /^[.:@a-zA-Z[]/.test(line) && line.trimEnd().endsWith('{'))
    .map((line) => line.replace(/\s*\{$/, '').trim())
  const unscoped = selectors.filter((selector) => (
    !selector.startsWith('.v6-')
    && !selector.startsWith('@')
    && !selector.startsWith('from')
    && !selector.startsWith('to')
    && !selector.startsWith(':root')
  ))
  assert.deepEqual(unscoped, [], 'every V6 rule must be scoped to the .v6- surface')
})

test('no V6 module reaches for a non-canonical financial reader', () => {
  const legacyReaders = /from\s+'[^']*\/lib\/(transactions|budgets|goals|recurring|accounts|income|snapshots|reports|fire|forecast|cards)(\.js)?'/
  const offenders = sources
    .filter((file) => !file.path.endsWith('v6-boundary.test.js'))
    .filter((file) => legacyReaders.test(file.text))
    .filter((file) => !(file.path === 'data/canonicalReads.js' && /listAuthoritativeNetWorthHistory/.test(file.text)))
    .map((file) => file.path)
  assert.deepEqual(offenders, [], 'V6 figures must come from canonical contracts only')
})

test('the Overview model and its composition never import the Supabase client', () => {
  // The repository has learned three times that pure logic living beside a
  // Supabase import silently becomes untestable. `canonicalReads.js` is the
  // one V6 module allowed to reach the client.
  const pure = [
    'data/overviewModel.js', 'data/composeOverview.js', 'data/periods.js', 'data/gaps.js',
    'data/activityModel.js', 'data/composeActivity.js', 'data/activityPeriods.js', 'data/activityGaps.js',
    'data/budgetModel.js', 'data/composeBudget.js', 'data/budgetPeriods.js', 'data/budgetGaps.js',
    'data/recurringModel.js', 'data/composeRecurring.js', 'data/recurringPeriods.js', 'data/recurringGaps.js',
    'data/insightsModel.js', 'data/composeInsights.js', 'data/insightsPeriods.js', 'data/insightsGaps.js',
    'data/slots.js', 'format.js',
  ]
  for (const path of pure) {
    const file = sources.find((entry) => entry.path === path)
    assert.ok(file, `${path} must exist`)
    assert.ok(!/supabaseClient|canonicalMetrics/.test(file.text), `${path} must stay loadable without a Supabase client`)
  }
})

test('no V6 module computes a plan-versus-actual figure in the browser', () => {
  // Budget is where this is easiest to write by accident: every missing figure
  // on that screen has an obvious formula against the actual beside it. The
  // guard looks for arithmetic between a plan-shaped operand and an
  // actual-shaped one, over the code with comments removed — the prose that
  // explains why these formulas are forbidden is not itself a violation.
  const PLAN = String.raw`\w*(?:plan|planned|limit|budget)\w*`
  const ACTUAL = String.raw`\w*(?:actual|actuals|spent|spend)\w*`
  const forbidden = [
    new RegExp(String.raw`\b${PLAN}\s*[-/]\s*${ACTUAL}\b`, 'i'),
    new RegExp(String.raw`\b${ACTUAL}\s*[-/]\s*${PLAN}\b`, 'i'),
  ]
  const offenders = sources
    .filter((file) => !file.path.endsWith('v6-boundary.test.js'))
    .filter((file) => {
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      return forbidden.some((pattern) => pattern.test(code))
    })
    .map((file) => file.path)
  assert.deepEqual(offenders, [], 'a plan-versus-actual figure must come from an approved contract, never from React')
})

test('the app mounts the fresh V6 screens and no longer imports the legacy ones they replace', () => {
  const app = readFileSync(join(ROOT, '..', 'App.jsx'), 'utf8')
  for (const [screen, module] of [
    ['Overview', 'OverviewScreen'], ['Activity', 'ActivityScreen'],
    ['Budget', 'BudgetScreen'], ['Recurring', 'RecurringScreen'], ['Insights', 'InsightsScreen'],
    ['NetWorth', 'NetWorthScreen'], ['Accounts', 'AccountsScreen'],
  ]) {
    assert.match(app, new RegExp(`import ${module} from '\\./v6/${module}'`), `${screen} must mount its V6 screen`)
    assert.match(app, new RegExp(`${screen}: ${module},`), `${screen} must resolve to its V6 screen`)
  }
  for (const legacy of ['Home', 'Transactions', 'Budget', 'Recurring', 'Reports']) {
    assert.ok(
      !new RegExp(`from '\\./screens/${legacy}'`).test(app),
      `the legacy ${legacy} screen must no longer be imported by the app`,
    )
  }
  assert.match(app, /NetWorth: NetWorthScreen,/, 'Net Worth route key must resolve independently from legacy Accounts')
  // SHR-180. `src/screens/Accounts.jsx` is still imported, but only for
  // Planning's `/planning/forecasts` placeholder, which has always rendered it
  // because that module hosts the forecast card. It must never be the value of
  // the Accounts route key again.
  assert.doesNotMatch(app, /\bAccounts: Accounts\b/, 'the Accounts route must not resolve to legacy presentation')
  assert.match(app, /Forecasts: LegacyForecastsPlaceholder,/, 'the legacy module keeps only its Planning binding')
})

test('the Accounts tree is read-only and contains no browser valuation, FX or ownership engine', () => {
  // SHR-180's central rules, enforced structurally rather than by convention.
  //
  // The tree makes no ledger read at all, so a balance reconstructed from
  // posted rows has nowhere to live. It holds no FX arithmetic, so an AED
  // figure can only be one the canonical contract published. It never reads
  // `owner`, so a legacy label cannot become an ownership claim. And it calls
  // no writer, so opening the screen cannot change wealth truth.
  //
  // Comments are stripped first: the prose explaining why these are absent is
  // not itself a violation. Test files are excluded on purpose — the UI test
  // hands the screen forbidden reader spies and asserts they are never called,
  // so it must be allowed to write names the production tree may not.
  const accounts = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:AccountsScreen\.jsx|accounts\/|data\/(?:accountsModel|accountsGaps|accountsGrouping|composeAccounts|useAccountsData)\.js)/.test(file.path)
  ))
  assert.ok(accounts.length >= 12, `expected the Accounts tree to be guarded, found ${accounts.length} files`)

  const forbiddenReads = /\b(?:listLedgerRows|listCanonicalLedgerRows|listTransactions|listIncomeRows|listCanonicalIncomeRows|listRecurring|listNetWorthHistory)\b/
  const forbiddenWrites = /\b(?:createAccount|updateAccount|deleteAccount|archiveAccount|saveAccount|recordDailyNetWorth|capture_nw_snapshot|claim_nw_snapshot|upsert|refreshPrices|refreshFx)\b/
  const browserFx = /\btoAED\b|convertCurrency|exchangeRate|fxRate\s*[*/]|[*/]\s*fxRate|fx_rate_to_aed\s*[*/]|[*/]\s*fx_rate_to_aed/
  const ownershipInference = /\browner\b\s*[=:]|row\.owner|legacyOwner|ownerAllocation|sharedAllocation|splitShared|allocateTo/
  const freshnessVerdict = /isStale|staleAfter|STALE_(?:DAYS|HOURS)|freshnessScore|daysSince|ageInDays|Date\.now\(\)/
  const investmentAnalytics = /\b(?:cost_basis_aed|unrealized_pnl_aed|costBasis|unrealizedPnl|dayChange|percentChange|returnPct|allocationShare|portfolioValue)\b/

  for (const file of accounts) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    // String literals carry the gap registry's prose, which names the very
    // things it forbids. Only executable code is checked for the judgement and
    // ownership patterns.
    const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''")
    assert.ok(!forbiddenReads.test(code), `${file.path} must make no ledger or history read on the Accounts surface`)
    assert.ok(!forbiddenWrites.test(code), `${file.path} must call no account or snapshot writer`)
    assert.ok(!browserFx.test(code), `${file.path} must not convert currency in the browser`)
    assert.ok(!ownershipInference.test(executable), `${file.path} must not read or allocate legacy ownership`)
    assert.ok(!freshnessVerdict.test(executable), `${file.path} must not author a freshness threshold`)
    assert.ok(!investmentAnalytics.test(code), `${file.path} must not implement Investments analytics`)
  }
})

test('the Accounts tree classifies accounts by contract, never by account name', () => {
  // A name heuristic is the cheapest wrong answer available on this screen:
  // "Mortgage · ENBD" looks like a liability, and matching on that would move
  // an account between the sides of the balance sheet on the strength of a
  // label the household typed.
  const accounts = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:AccountsScreen\.jsx|accounts\/|data\/(?:accountsModel|accountsGrouping|composeAccounts)\.js)/.test(file.path)
  ))
  const heuristics = [
    /name\.(?:includes|match|startsWith|endsWith|indexOf|search|toLowerCase)/i,
    /\/[^/\n]+\/[gimsuy]*\.test\(\s*\w*[Nn]ame/,
    /isLiability\s*=\s*(?!row\.is_liability)/,
  ]
  for (const file of accounts) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const pattern of heuristics) {
      assert.ok(!pattern.test(code), `${file.path} must not classify an account from its name (${pattern})`)
    }
  }
})

test('the Net Worth production tree is read-only and contains no browser wealth engine', () => {
  const wealth = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:NetWorthScreen\.jsx|net-worth\/|data\/(?:netWorthModel|netWorthGaps|netWorthRanges|composeNetWorth|useNetWorthData)\.js)/.test(file.path)
  ))
  assert.ok(wealth.length >= 8, `expected the Net Worth tree to be guarded, found ${wealth.length} files`)
  const forbidden = /\b(?:listTransactions|listCanonicalLedgerRows|listIncome|createAccount|updateAccount|deleteAccount|recordDailyNetWorth|capture_nw_snapshot|claim_nw_snapshot|upsert|insert|projectNetWorth|computeMonthlyAssumptions)\b/
  const heuristics = /\b(?:changePct|percentChange|percentageChange|CAGR|growthRate|averageGrowth|forecast|projection|interpolate|extrapolate|ownerAllocation|sharedAllocation)\b/i
  for (const file of wealth) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.ok(!forbidden.test(code), `${file.path} must not read ledger truth or call a financial writer`)
    assert.ok(!heuristics.test(code), `${file.path} must not contain a browser-side wealth heuristic`)
  }
})

test('the Insights tree has no raw-row analytical input or legacy writer', () => {
  const insights = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:InsightsScreen\.jsx|insights\/|data\/(?:insightsModel|insightsGaps|insightsPeriods|composeInsights|useInsightsData)\.js)/.test(file.path)
  ))
  assert.ok(insights.length >= 12, `expected the Insights tree to be guarded, found ${insights.length} files`)
  const forbidden = /\b(?:listLedgerRows|listCanonicalLedgerRows|listIncomeRows|listCanonicalIncomeRows|listTransactions|loadCanonicalReportPeriod|upsertTransaction|updateTransaction|deleteTransaction|upsertBudget|upsertRecurring)\b/
  for (const file of insights) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.ok(!forbidden.test(code), `${file.path} must not read raw analytical input or call a financial writer`)
  }
})

test('the Insights tree contains no merchant normalization or analytical arithmetic engine', () => {
  const insights = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:InsightsScreen\.jsx|insights\/|data\/(?:insightsModel|composeInsights|useInsightsData)\.js)/.test(file.path)
  ))
  const forbidden = [
    /levenshtein|similarity|fuzzy|normalizeMerchant|merchantAlias|stripPrefix|stripSuffix/i,
    /rollingAverage|movingAverage|averageInterval|detectTrend|inferTrend|projectValue/i,
    /percent(?:age)?Change|monthOverMonth|anomalyScore|unusualSpend|rankingScore/i,
  ]
  for (const file of insights) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(code), `${file.path} must not contain an Insights heuristic (${pattern})`)
    }
  }
})

test('no V6 module infers a recurring plan from posted facts', () => {
  // SHR-200's central rule. A recurring plan reconstructed from transactions
  // is the cheapest thing to write on that screen and the most damaging: it
  // would publish a schedule, a due date and a paid/unpaid status the
  // household never declared, with no versioning and no way to correct it.
  //
  // The guard is structural rather than semantic. The Recurring tree makes no
  // ledger or income read at all, so there is no posted row in scope to
  // cluster — the inference has nowhere to live. Comments are stripped first,
  // because the prose explaining why these reads are absent is not itself one.
  // Test files are excluded on purpose. `v6-recurring.ui.test.jsx` hands the
  // screen a `listLedgerRows` spy and asserts it is never called, so it must
  // be allowed to write the name the production tree may not.
  const recurring = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:RecurringScreen\.jsx|recurring\/|data\/(?:recurringModel|recurringGaps|recurringPeriods|composeRecurring|useRecurringData)\.js|fixtures\/recurringFixture\.js)/.test(file.path)
  ))
  assert.ok(recurring.length >= 10, `expected the Recurring tree to be guarded, found ${recurring.length} files`)

  const forbiddenReads = /\b(?:listLedgerRows|listCanonicalLedgerRows|listIncomeRows|listCanonicalIncomeRows|listTransactions|listRecurring|upsertRecurring|deleteRecurring)\b/
  for (const file of recurring) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.ok(
      !forbiddenReads.test(code),
      `${file.path} must not read posted rows or legacy recurring rows on a plan surface`,
    )
  }
})

test('the Recurring tree contains no matching, cadence or paid-status heuristic', () => {
  // Fuzzy merchant matching, an amount-and-date similarity score and a
  // "recurs monthly" cadence detector are all a few lines each, and all of
  // them would present a guess as household truth. None may exist here.
  // Test files are excluded for the same reason as above: the UI test names
  // these very patterns in order to assert the screen never states them.
  const recurring = sources.filter((file) => (
    !/\.test\.jsx?$/.test(file.path)
    && /^(?:RecurringScreen\.jsx|recurring\/|data\/(?:recurringModel|composeRecurring|useRecurringData)\.js)/.test(file.path)
  ))
  assert.ok(recurring.length >= 8, `expected the Recurring tree to be guarded, found ${recurring.length} files`)
  const heuristics = [
    /levenshtein|similarity|fuzzy|\bscore\(/i,
    /\.startsWith\([^)]*merchant|merchant[A-Za-z]*\.(?:includes|match)\(/i,
    /daysBetween|intervalDays|averageInterval|detectCadence|inferCadence|guessCadence/i,
    /isPaid|markPaid\s*=\s*(?:true|\()|\bpaid\s*=\s*true/i,
  ]
  for (const file of recurring) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const pattern of heuristics) {
      assert.ok(!pattern.test(code), `${file.path} must not carry a plan-from-fact heuristic (${pattern})`)
    }
  }
})
