import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = new URL('.', import.meta.url).pathname

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
const sources = files.map((path) => ({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }))

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
  for (const [screen, module] of [['Overview', 'OverviewScreen'], ['Activity', 'ActivityScreen'], ['Budget', 'BudgetScreen']]) {
    assert.match(app, new RegExp(`import ${module} from '\\./v6/${module}'`), `${screen} must mount its V6 screen`)
    assert.match(app, new RegExp(`${screen}: ${module},`), `${screen} must resolve to its V6 screen`)
  }
  for (const legacy of ['Home', 'Transactions', 'Budget']) {
    assert.ok(
      !new RegExp(`from '\\./screens/${legacy}'`).test(app),
      `the legacy ${legacy} screen must no longer be imported by the app`,
    )
  }
})
