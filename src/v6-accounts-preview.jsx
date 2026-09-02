import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { detailHref, presentationForRoute, resolveAppHref } from './lib/routes'
import AccountsScreen from './v6/AccountsScreen'
import { accountsFixtureReadsWith } from './v6/fixtures/accountsFixture'
import './index.css'

function directRoute(target) {
  const first = resolveAppHref(target)
  return first.kind === 'redirect' ? resolveAppHref(first.to) : first
}

function previewUrl(search, fixture) {
  const params = new URLSearchParams(search)
  params.set('fixture', fixture)
  return `/v6-accounts-preview.html?${params.toString()}`
}

function PreviewAccounts() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    const detail = incoming.get('account')
    incoming.delete('account')
    const query = incoming.toString()
    const base = detail ? `/wealth/accounts/${detail}` : '/wealth/accounts'
    return directRoute(query ? `${base}?${query}` : base)
  })

  function commit(next, search) {
    if (next.kind !== 'screen') return false
    window.history.replaceState({}, '', previewUrl(search, fixture))
    setRoute(next)
    return true
  }

  function navigate(target) {
    if (!safety.confirmLeave()) return false
    safety.clearAll()
    const next = directRoute(target)
    const search = new URLSearchParams(next.searchParams)
    if (next.detail) search.set('account', next.detail.id)
    return commit(next, search)
  }

  function updateQuery(values) {
    const raw = new URLSearchParams()
    for (const [key, value] of Object.entries(values ?? {})) {
      if (value !== undefined && value !== null && value !== '') raw.set(key, String(value))
    }
    const text = raw.toString()
    return commit(directRoute(text ? `/wealth/accounts?${text}` : '/wealth/accounts'), text)
  }

  function openDetail(kind, id) {
    const href = detailHref(kind, id, route.searchParams)
    return href ? navigate(href) : false
  }

  function closeDetail() {
    return navigate(`/wealth/accounts${route.searchParams.toString() ? `?${route.searchParams}` : ''}`)
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Accounts'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Accounts' ? (
        <AccountsScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          detailId={route.detail?.id ?? null}
          onOpenDetail={openDetail}
          onCloseDetail={closeDetail}
          reads={accountsFixtureReadsWith(fixture)}
        />
      ) : <p>Preview covers Accounts only.</p>}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewAccounts />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
