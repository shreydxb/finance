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
  assert.ok(sources.length >= 15, `expected the V6 surface to contain modules, found ${sources.length}`)
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
    .filter((line) => /^[.:@a-zA-Z\[]/.test(line) && line.trimEnd().endsWith('{'))
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
  const pure = ['data/overviewModel.js', 'data/composeOverview.js', 'data/periods.js', 'data/gaps.js', 'format.js']
  for (const path of pure) {
    const file = sources.find((entry) => entry.path === path)
    assert.ok(file, `${path} must exist`)
    assert.ok(!/supabaseClient|canonicalMetrics/.test(file.text), `${path} must stay loadable without a Supabase client`)
  }
})
