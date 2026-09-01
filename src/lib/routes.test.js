import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_DESTINATIONS,
  LEGACY_ALIASES,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  detailHref,
  hrefWithQuery,
  parentHrefForDetail,
  presentationForRoute,
  resolveAppHref,
  routeForScreen,
  safeInternalReturnTo,
} from './routes.js'
import { confirmNavigation, UNSAVED_CHANGES_MESSAGE } from './navigationGuards.js'

const ID = '123e4567-e89b-42d3-a456-426614174000'

test('root resolves by replacement to Overview', () => {
  assert.deepEqual(resolveAppHref('/'), {
    kind: 'redirect',
    pathname: '/',
    href: '/',
    to: '/overview',
  })
})

test('every canonical destination direct-opens an existing production screen', () => {
  const expected = {
    '/overview': 'Overview',
    '/money/activity': 'Transactions',
    '/money/budget': 'Budget',
    '/money/recurring': 'Recurring',
    '/money/insights': 'Reports',
    '/wealth/net-worth': 'Accounts',
    '/wealth/accounts': 'Accounts',
    '/wealth/investments': 'Investments',
    '/planning': 'Goals',
    '/planning/goals': 'Goals',
    '/planning/debt': 'Debts',
    '/planning/forecasts': 'Accounts',
    '/settings': 'Settings',
  }
  assert.deepEqual(CANONICAL_DESTINATIONS, Object.keys(expected))
  for (const [href, screen] of Object.entries(expected)) {
    const route = resolveAppHref(href)
    assert.equal(route.kind, 'screen', href)
    assert.equal(route.screen, screen, href)
    assert.equal(route.href, href, href)
  }
})

test('shell exposes the five-destination V6 IA and route-aware secondary hierarchy', () => {
  assert.deepEqual(PRIMARY_NAV_ITEMS.map(({ label, href }) => [label, href]), [
    ['Overview', '/overview'],
    ['Money', '/money/activity'],
    ['Wealth', '/wealth/net-worth'],
    ['Planning', '/planning'],
    ['Settings', '/settings'],
  ])
  assert.deepEqual(Object.keys(SECONDARY_NAV_ITEMS), ['money', 'wealth', 'planning'])

  const expectations = {
    '/overview': ['Overview', 'overview', undefined, 0],
    '/money/budget': ['Budget', 'money', 'budget', 4],
    '/wealth/investments': ['Investments', 'wealth', 'investments', 3],
    '/planning/debt': ['Debt payoff', 'planning', 'debt', 4],
    '/settings/preferences': ['Settings', 'settings', undefined, 0],
  }
  for (const [href, [title, primary, secondary, itemCount]] of Object.entries(expectations)) {
    const presentation = presentationForRoute(resolveAppHref(href))
    assert.equal(presentation.title, title, href)
    assert.equal(presentation.primary, primary, href)
    assert.equal(presentation.secondary, secondary, href)
    assert.equal(presentation.secondaryItems.length, itemCount, href)
  }
})

test('known Settings children direct-open Settings and unknown children do not', () => {
  for (const href of [
    '/settings/household',
    '/settings/preferences',
    '/settings/categories',
    '/settings/integrations',
    '/settings/integrations/telegram',
    '/settings/data-sources',
  ]) {
    assert.equal(resolveAppHref(href).screen, 'Settings')
  }
  assert.equal(resolveAppHref('/settings/not-a-real-page').kind, 'not-found')
})

test('legacy aliases resolve to canonical destinations without loops', () => {
  for (const [alias, canonical] of Object.entries(LEGACY_ALIASES)) {
    const redirect = resolveAppHref(alias)
    assert.equal(redirect.kind, 'redirect', alias)
    assert.equal(redirect.to, canonical, alias)
    assert.equal(resolveAppHref(redirect.to).kind, 'screen', alias)
  }
})

test('aliases preserve only compatible query parameters', () => {
  assert.equal(
    resolveAppHref('/transactions?search=rent&owner=Shrey&sort=amount&returnTo=https://evil.example').to,
    '/money/activity?search=rent&owner=Shrey&sort=amount',
  )
  assert.equal(
    resolveAppHref('/reports?section=spending&period=month&year=2026&month=8&account=secret').to,
    '/money/insights?section=spending&period=month&year=2026&month=8',
  )
})

test('canonical query state is sanitized and remains stable on refresh', () => {
  const href = '/money/activity?search=groceries&sort=amount&needsReview=1'
  const first = resolveAppHref(href)
  assert.equal(first.kind, 'screen')
  assert.equal(first.href, href)
  assert.equal(resolveAppHref(first.href).href, href)
  assert.equal(
    hrefWithQuery(first, { search: 'utilities', unreviewed: '1', returnTo: '//evil.example' }),
    '/money/activity?search=utilities&unreviewed=1',
  )
})

test('authenticated returnTo accepts canonical or aliased internal routes only', () => {
  assert.equal(safeInternalReturnTo('/planning/goals'), '/planning/goals')
  assert.equal(safeInternalReturnTo('/transactions?search=rent'), '/money/activity?search=rent')
  for (const unsafe of [
    'https://evil.example/money/activity',
    '//evil.example/money/activity',
    '/\\evil.example',
    '/login?returnTo=/wealth/accounts',
    '/unknown',
    '',
  ]) {
    assert.equal(safeInternalReturnTo(unsafe), null, unsafe)
  }
})

test('unknown routes remain authenticated Not Found routes', () => {
  const route = resolveAppHref('/definitely-unknown?x=1')
  assert.equal(route.kind, 'not-found')
  assert.equal(route.pathname, '/definitely-unknown')
})

test('immutable-ID details direct-open without background state', () => {
  const cases = {
    [`/money/activity/${ID}`]: ['transaction', 'Transactions', '/money/activity'],
    [`/money/recurring/${ID}`]: ['recurring', 'Recurring', '/money/recurring'],
    [`/wealth/accounts/${ID}`]: ['account', 'Accounts', '/wealth/accounts'],
    [`/wealth/investments/${ID}`]: ['investment', 'Investments', '/wealth/investments'],
    [`/planning/goals/${ID}`]: ['goal', 'Goals', '/planning/goals'],
    [`/planning/debt/${ID}`]: ['debt', 'Debts', '/planning/debt'],
  }
  for (const [href, [kind, screen, parentPath]] of Object.entries(cases)) {
    const route = resolveAppHref(href)
    assert.equal(route.kind, 'screen', href)
    assert.equal(route.screen, screen, href)
    assert.deepEqual(route.detail, { kind, id: ID, parentPath }, href)
    const presentation = presentationForRoute(route)
    assert.equal(presentation.navigationPath, parentPath, href)
    assert.equal(presentation.detail.id, ID, href)
  }
  assert.equal(resolveAppHref('/planning/goals/not-a-database-id').kind, 'not-found')
})

test('detail builders use immutable IDs and preserve only parent-compatible state', () => {
  assert.equal(
    detailHref('transaction', ID, new URLSearchParams('search=rent&returnTo=bad')),
    `/money/activity/${ID}?search=rent`,
  )
  assert.equal(detailHref('transaction', 'mutable-name', new URLSearchParams()), null)
  assert.equal(routeForScreen('Transactions', { openTransactionId: ID }), `/money/activity/${ID}`)
  assert.equal(routeForScreen('Goals', { openGoalId: ID }), `/planning/goals/${ID}`)
})

test('closing a pushed detail uses Back and direct-open detail replaces with its parent', () => {
  const listHref = '/money/activity?search=rent'
  const route = resolveAppHref(`/money/activity/${ID}?search=rent`)
  assert.deepEqual(parentHrefForDetail(route, { routeParent: listHref }), { method: 'back', href: listHref })
  assert.deepEqual(parentHrefForDetail(route, null), { method: 'replace', href: listHref })
  assert.deepEqual(parentHrefForDetail(route, { routeParent: '/overview' }), { method: 'replace', href: listHref })
})

test('Back and Forward preserve destination and supported query state', () => {
  const stack = ['/overview']
  let index = 0
  function push(href) {
    stack.splice(index + 1)
    stack.push(resolveAppHref(href).href)
    index += 1
  }
  function move(delta) {
    index += delta
    return resolveAppHref(stack[index])
  }
  push('/money/activity?search=rent')
  push(`/money/activity/${ID}?search=rent`)
  assert.equal(move(-1).href, '/money/activity?search=rent')
  assert.equal(move(-1).href, '/overview')
  assert.equal(move(1).href, '/money/activity?search=rent')
  assert.equal(move(1).detail.id, ID)
})

test('dirty navigation cannot silently discard edits', () => {
  let prompts = 0
  assert.equal(confirmNavigation(false, () => { prompts += 1; return false }), true)
  assert.equal(prompts, 0)
  assert.equal(confirmNavigation(true, (message) => {
    prompts += 1
    assert.equal(message, UNSAVED_CHANGES_MESSAGE)
    return false
  }), false)
  assert.equal(confirmNavigation(true, () => true), true)
  assert.equal(prompts, 1)
})
