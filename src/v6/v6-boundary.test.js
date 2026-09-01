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
