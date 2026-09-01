const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const CANONICAL_DESTINATIONS = Object.freeze([
  '/overview',
  '/money/activity',
  '/money/budget',
  '/money/recurring',
  '/money/insights',
  '/wealth/net-worth',
  '/wealth/accounts',
  '/wealth/investments',
  '/planning',
  '/planning/goals',
  '/planning/debt',
  '/planning/forecasts',
  '/settings',
])

export const PRIMARY_NAV_ITEMS = Object.freeze([
  { key: 'overview', label: 'Overview', href: '/overview' },
  { key: 'money', label: 'Money', href: '/money/activity' },
  { key: 'wealth', label: 'Wealth', href: '/wealth/net-worth' },
  { key: 'planning', label: 'Planning', href: '/planning' },
  { key: 'settings', label: 'Settings', href: '/settings' },
])

export const SECONDARY_NAV_ITEMS = Object.freeze({
  money: Object.freeze([
    { key: 'activity', label: 'Activity', href: '/money/activity' },
    { key: 'budget', label: 'Budget', href: '/money/budget' },
    { key: 'recurring', label: 'Recurring', href: '/money/recurring' },
    { key: 'insights', label: 'Insights', href: '/money/insights' },
  ]),
  wealth: Object.freeze([
    { key: 'net-worth', label: 'Net worth', href: '/wealth/net-worth' },
    { key: 'accounts', label: 'Accounts', href: '/wealth/accounts' },
    { key: 'investments', label: 'Investments', href: '/wealth/investments' },
  ]),
  planning: Object.freeze([
    { key: 'plan', label: 'Plan', href: '/planning' },
    { key: 'goals', label: 'Goals', href: '/planning/goals' },
    { key: 'debt', label: 'Debt payoff', href: '/planning/debt' },
    { key: 'forecasts', label: 'Forecasts', href: '/planning/forecasts' },
  ]),
})

const ROUTE_PRESENTATION = Object.freeze({
  '/overview': { primary: 'overview', title: 'Overview', width: 'content' },
  '/money/activity': { primary: 'money', secondary: 'activity', title: 'Activity', width: 'content' },
  '/money/budget': { primary: 'money', secondary: 'budget', title: 'Budget', width: 'content' },
  // SHR-200: the fresh V6 Recurring screen carries a month calendar grid and
  // a multi-column position layout, so it takes the same content width as the
  // other Money screens rather than the narrower detail width the legacy
  // single-column list used.
  '/money/recurring': { primary: 'money', secondary: 'recurring', title: 'Recurring', width: 'content' },
  '/money/insights': { primary: 'money', secondary: 'insights', title: 'Insights', width: 'content' },
  '/wealth/net-worth': { primary: 'wealth', secondary: 'net-worth', title: 'Net worth', width: 'content' },
  '/wealth/accounts': { primary: 'wealth', secondary: 'accounts', title: 'Accounts', width: 'content' },
  '/wealth/investments': { primary: 'wealth', secondary: 'investments', title: 'Investments', width: 'content' },
  '/planning': { primary: 'planning', secondary: 'plan', title: 'Plan', width: 'detail' },
  '/planning/goals': { primary: 'planning', secondary: 'goals', title: 'Goals', width: 'detail' },
  '/planning/debt': { primary: 'planning', secondary: 'debt', title: 'Debt payoff', width: 'detail' },
  '/planning/forecasts': { primary: 'planning', secondary: 'forecasts', title: 'Forecasts', width: 'content' },
  '/settings': { primary: 'settings', title: 'Settings', width: 'content' },
})

export function presentationForRoute(route) {
  if (route?.kind === 'not-found') {
    return { title: 'Page not found', width: 'detail', primary: null, secondary: null, secondaryItems: [] }
  }
  if (route?.kind !== 'screen') return null
  const navigationPath = route.detail?.parentPath ?? route.pathname
  const metadata = ROUTE_PRESENTATION[navigationPath]
    ?? (SETTINGS_PATHS.has(navigationPath) ? ROUTE_PRESENTATION['/settings'] : null)
  if (!metadata) return null
  return {
    ...metadata,
    navigationPath,
    secondaryItems: metadata.primary ? SECONDARY_NAV_ITEMS[metadata.primary] ?? [] : [],
    detail: route.detail ?? null,
  }
}

export const LEGACY_ALIASES = Object.freeze({
  '/': '/overview',
  '/home': '/overview',
  '/transactions': '/money/activity',
  '/reports': '/money/insights',
  '/accounts': '/wealth/accounts',
  '/investments': '/wealth/investments',
  '/budget': '/money/budget',
  '/recurring': '/money/recurring',
  '/goals': '/planning/goals',
  '/debts': '/planning/debt',
  '/money': '/money/activity',
  '/wealth': '/wealth/net-worth',
})

const SETTINGS_PATHS = new Set([
  '/settings',
  '/settings/household',
  '/settings/preferences',
  '/settings/categories',
  '/settings/integrations',
  '/settings/integrations/telegram',
  '/settings/data-sources',
])

const SCREEN_ROUTES = Object.freeze({
  Overview: '/overview',
  Activity: '/money/activity',
  // Legacy screens still call onNavigate('Home') / onNavigate('Transactions');
  // keep those aliases resolving to the same canonical destinations.
  Home: '/overview',
  Accounts: '/wealth/accounts',
  Investments: '/wealth/investments',
  Transactions: '/money/activity',
  Reports: '/money/insights',
  Budget: '/money/budget',
  Recurring: '/money/recurring',
  Goals: '/planning/goals',
  Debts: '/planning/debt',
  Settings: '/settings',
})

const EXACT_ROUTES = Object.freeze({
  '/overview': { screen: 'Overview' },
  '/money/activity': { screen: 'Activity' },
  '/money/budget': { screen: 'Budget' },
  '/money/recurring': { screen: 'Recurring' },
  '/money/insights': { screen: 'Reports' },
  '/wealth/net-worth': { screen: 'Accounts' },
  '/wealth/accounts': { screen: 'Accounts' },
  '/wealth/investments': { screen: 'Investments' },
  '/planning': { screen: 'Goals' },
  '/planning/goals': { screen: 'Goals' },
  '/planning/debt': { screen: 'Debts' },
  '/planning/forecasts': { screen: 'Accounts' },
})

const DETAIL_ROUTES = Object.freeze([
  { pattern: /^\/money\/activity\/([^/]+)$/, screen: 'Activity', kind: 'transaction', parentPath: '/money/activity' },
  { pattern: /^\/money\/recurring\/([^/]+)$/, screen: 'Recurring', kind: 'recurring', parentPath: '/money/recurring' },
  { pattern: /^\/wealth\/accounts\/([^/]+)$/, screen: 'Accounts', kind: 'account', parentPath: '/wealth/accounts' },
  { pattern: /^\/wealth\/investments\/([^/]+)$/, screen: 'Investments', kind: 'investment', parentPath: '/wealth/investments' },
  { pattern: /^\/planning\/goals\/([^/]+)$/, screen: 'Goals', kind: 'goal', parentPath: '/planning/goals' },
  { pattern: /^\/planning\/debt\/([^/]+)$/, screen: 'Debts', kind: 'debt', parentPath: '/planning/debt' },
])

const QUERY_RULES = Object.freeze({
  // SHR-155: the Overview period selection is part of the URL so a shared or
  // reloaded link reopens the same period rather than silently resetting.
  '/overview': { period: ['mtd', 'qtd', 'ytd'] },
  '/money/activity': {
    search: 'shortText', category: 'shortText', owner: 'shortText', account: 'uuid',
    from: 'date', to: 'date', sort: ['date', 'amount'], needsReview: ['1'], unreviewed: ['1'],
    // SHR-164: the month under review and the list/calendar switch are part of
    // the URL, so a shared or reloaded Activity link reopens the same view.
    view: ['list', 'calendar'], year: 'year', month: 'month',
  },
  // SHR-199: the Budget month/year under review and the Month/Year switch are
  // part of the URL, so a shared or reloaded Budget link reopens the same
  // period rather than silently resetting to today's.
  '/money/budget': { view: ['month', 'year'], year: 'year', month: 'month' },
  '/money/recurring': {
    type: ['bills', 'income'], view: ['list', 'calendar'], year: 'year', month: 'month',
    owner: 'shortText', kind: 'slug',
  },
  '/money/insights': {
    section: ['cashflow', 'spending', 'income'], period: ['month', 'quarter', 'year'],
    year: 'year', month: 'month', quarter: ['1', '2', '3', '4'],
    view: ['breakdown', 'trends', 'compare'], group: ['category', 'group', 'merchant'],
    comparison: 'slug', shape: ['sankey', 'bars', 'line', 'donut'], flowGroup: ['group', 'category'],
  },
  '/wealth/net-worth': { group: ['type', 'owner'] },
  '/wealth/accounts': { group: ['type', 'owner'] },
  '/wealth/investments': {
    owner: 'shortText', group: ['holding', 'owner', 'currency'], shape: ['donut', 'bars'],
  },
})

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

function queryParentPath(pathname) {
  for (const detail of DETAIL_ROUTES) {
    if (detail.pattern.test(pathname)) return detail.parentPath
  }
  return pathname
}

function validQueryValue(rule, value) {
  if (Array.isArray(rule)) return rule.includes(value)
  if (rule === 'uuid') return UUID_PATTERN.test(value)
  if (rule === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (rule === 'year') return /^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2100
  if (rule === 'month') return /^(?:[1-9]|1[0-2])$/.test(value)
  if (rule === 'slug') return /^[a-z0-9_-]{1,40}$/i.test(value)
  if (rule === 'shortText') return value.length > 0 && value.length <= 120 && !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  return false
}

export function sanitizeQuery(pathname, search = '') {
  const parentPath = queryParentPath(normalizePathname(pathname))
  const rules = QUERY_RULES[parentPath]
  const output = new URLSearchParams()
  if (!rules) return output

  const input = search instanceof URLSearchParams ? search : new URLSearchParams(search)
  for (const [key, rule] of Object.entries(rules)) {
    const value = input.get(key)
    if (value !== null && validQueryValue(rule, value)) output.set(key, value)
  }
  return output
}

function withQuery(pathname, query) {
  const text = query.toString()
  return text ? `${pathname}?${text}` : pathname
}

function screenRoute(pathname, searchParams, definition, detail = null) {
  return {
    kind: 'screen',
    pathname,
    href: withQuery(pathname, searchParams),
    searchParams,
    screen: definition.screen,
    detail,
  }
}

export function resolveAppHref(href) {
  const url = new URL(href, 'https://our-money.local')
  const pathname = normalizePathname(url.pathname)

  if (pathname === '/login') {
    return { kind: 'login', pathname, href: `${pathname}${url.search}`, searchParams: url.searchParams }
  }

  const aliasTarget = LEGACY_ALIASES[pathname]
  if (aliasTarget) {
    const safeQuery = sanitizeQuery(aliasTarget, url.searchParams)
    return { kind: 'redirect', pathname, href: withQuery(pathname, safeQuery), to: withQuery(aliasTarget, safeQuery) }
  }

  if (SETTINGS_PATHS.has(pathname)) {
    return screenRoute(pathname, new URLSearchParams(), { screen: 'Settings' })
  }

  const exact = EXACT_ROUTES[pathname]
  if (exact) {
    const safeQuery = sanitizeQuery(pathname, url.searchParams)
    const canonicalHref = withQuery(pathname, safeQuery)
    if (`${pathname}${url.search}` !== canonicalHref) {
      return { kind: 'redirect', pathname, href: `${pathname}${url.search}`, to: canonicalHref }
    }
    return screenRoute(pathname, safeQuery, exact)
  }

  for (const definition of DETAIL_ROUTES) {
    const match = pathname.match(definition.pattern)
    if (!match) continue
    let id
    try {
      id = decodeURIComponent(match[1])
    } catch {
      break
    }
    if (!UUID_PATTERN.test(id)) break
    const safeQuery = sanitizeQuery(definition.parentPath, url.searchParams)
    const canonicalHref = withQuery(pathname, safeQuery)
    if (`${pathname}${url.search}` !== canonicalHref) {
      return { kind: 'redirect', pathname, href: `${pathname}${url.search}`, to: canonicalHref }
    }
    return screenRoute(pathname, safeQuery, definition, {
      kind: definition.kind,
      id,
      parentPath: definition.parentPath,
    })
  }

  return { kind: 'not-found', pathname, href: `${pathname}${url.search}`, searchParams: url.searchParams }
}

export function safeInternalReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  let url
  try {
    url = new URL(value, 'https://our-money.local')
  } catch {
    return null
  }
  if (url.origin !== 'https://our-money.local') return null
  const resolved = resolveAppHref(`${url.pathname}${url.search}`)
  if (resolved.kind === 'redirect') {
    const target = resolveAppHref(resolved.to)
    return target.kind === 'screen' ? target.href : null
  }
  return resolved.kind === 'screen' ? resolved.href : null
}

export function routeForScreen(screen, payload = null) {
  const parent = SCREEN_ROUTES[screen] ?? '/overview'
  const detailId = payload?.openTransactionId ?? payload?.openRecurringId ?? payload?.openGoalId ?? null
  if (!detailId || !UUID_PATTERN.test(detailId)) return parent
  if (screen === 'Transactions') return `${parent}/${detailId}`
  if (screen === 'Recurring') return `${parent}/${detailId}`
  if (screen === 'Goals') return `${parent}/${detailId}`
  return parent
}

export function detailHref(kind, id, searchParams = new URLSearchParams()) {
  if (!UUID_PATTERN.test(id)) return null
  const parentByKind = {
    transaction: '/money/activity', recurring: '/money/recurring', account: '/wealth/accounts',
    investment: '/wealth/investments', goal: '/planning/goals', debt: '/planning/debt',
  }
  const parent = parentByKind[kind]
  return parent ? withQuery(`${parent}/${id}`, sanitizeQuery(parent, searchParams)) : null
}

export function parentHrefForDetail(route, historyState) {
  if (route?.kind !== 'screen' || !route.detail) return null
  const parent = safeInternalReturnTo(historyState?.routeParent)
  if (parent && resolveAppHref(parent).pathname === route.detail.parentPath) {
    return { method: 'back', href: parent }
  }
  return {
    method: 'replace',
    href: withQuery(route.detail.parentPath, sanitizeQuery(route.detail.parentPath, route.searchParams)),
  }
}

export function queryObject(searchParams) {
  return Object.fromEntries(searchParams ?? [])
}

export function hrefWithQuery(route, values) {
  if (!route || route.kind !== 'screen') return route?.href ?? '/overview'
  const raw = new URLSearchParams()
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value !== undefined && value !== null && value !== '') raw.set(key, String(value))
  }
  return withQuery(route.pathname, sanitizeQuery(route.detail?.parentPath ?? route.pathname, raw))
}

export function isImmutableId(value) {
  return UUID_PATTERN.test(value)
}
