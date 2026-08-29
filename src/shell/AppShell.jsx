import { useEffect, useRef, useState } from 'react'
import ContentFrame from './ContentFrame'
import DesktopSidebar from './DesktopSidebar'
import MobileAppHeader from './MobileAppHeader'
import MobileBottomNav from './MobileBottomNav'
import PageHeader from './PageHeader'
import SecondaryNav from './SecondaryNav'
import UtilityPanel from './UtilityPanel'

export default function AppShell({ children, identity, navigate, onSignOut, presentation, route, takePendingFocusTarget }) {
  const [utilityOpen, setUtilityOpen] = useState(false)
  const utilityTriggerRef = useRef(null)

  function openUtility(event) {
    utilityTriggerRef.current = event.currentTarget
    setUtilityOpen(true)
  }

  useEffect(() => {
    if (route.detail) return
    document.title = `${presentation.title} · Our Money`
    const pending = takePendingFocusTarget?.()
    const target = pending?.isConnected ? pending : document.getElementById('page-title')
    target?.focus({ preventScroll: true })
  }, [presentation.title, route.detail, route.pathname, takePendingFocusTarget])

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <a href="#main-content" className="fixed left-3 top-3 z-[200] -translate-y-24 rounded-control bg-action px-3 py-2 text-body font-semibold text-action-contrast shadow-elevation-2 focus:translate-y-0">
        Skip to content
      </a>
      <div className="shell-layout mx-auto min-h-screen max-w-shell md:grid">
        <DesktopSidebar
          activeKey={presentation.primary}
          navigate={navigate}
          onOpenUtility={openUtility}
        />

        <div className="min-w-0">
          <div className="sticky top-0 z-30">
            <MobileAppHeader onOpenUtility={openUtility} />
            <SecondaryNav activeKey={presentation.secondary} items={presentation.secondaryItems} navigate={navigate} />
          </div>

          <main id="main-content" aria-labelledby="page-title" className="portal-v1 shell-main min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-10">
            <ContentFrame width={presentation.width}>
              <PageHeader title={presentation.title} description={presentation.description} eyebrow={presentation.eyebrow} />
              {children}
            </ContentFrame>
          </main>

          {!route.detail ? <MobileBottomNav activeKey={presentation.primary} navigate={navigate} /> : null}
        </div>
      </div>

      <UtilityPanel
        identity={identity}
        navigate={navigate}
        onSignOut={onSignOut}
        open={utilityOpen}
        onOpenChange={setUtilityOpen}
        returnFocusRef={utilityTriggerRef}
      />
    </div>
  )
}
