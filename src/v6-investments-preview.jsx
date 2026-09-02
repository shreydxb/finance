import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { detailHref, presentationForRoute, resolveAppHref } from './lib/routes'
import InvestmentsScreen from './v6/InvestmentsScreen'
import { investmentsFixtureReadsWith } from './v6/fixtures/investmentsFixture'
import './index.css'

function directRoute(target) {
  const first = resolveAppHref(target)
  return first.kind === 'redirect' ? resolveAppHref(first.to) : first
}

function previewUrl(search, fixture) {
  const params = new URLSearchParams(search)
  params.set('fixture', fixture)
  return `/v6-investments-preview.html?${params.toString()}`
}

function PreviewInvestments() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    const detail = incoming.get('investment')
    incoming.delete('investment')
    const query = incoming.toString()
    const base = detail ? `/wealth/investments/${detail}` : '/wealth/investments'
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
    if (next.detail) search.set('investment', next.detail.id)
    return commit(next, search)
  }

  function openDetail(kind, id) {
    const href = detailHref(kind, id, route.searchParams)
    return href ? navigate(href) : false
  }

  function closeDetail() {
    return navigate(`/wealth/investments${route.searchParams.toString() ? `?${route.searchParams}` : ''}`)
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Investments'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Investments' ? (
        <InvestmentsScreen
          detailId={route.detail?.id ?? null}
          onOpenDetail={openDetail}
          onCloseDetail={closeDetail}
          reads={investmentsFixtureReadsWith(fixture)}
        />
      ) : <p>Preview covers Investments only.</p>}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewInvestments />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
