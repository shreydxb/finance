import { useEffect, useRef, useState } from 'react'
import ContentFrame from './ContentFrame'
import DesktopSidebar from './DesktopSidebar'
import MobileAppHeader from './MobileAppHeader'
import MobileNav from './MobileNav'
import PageHeader from './PageHeader'
import SecondaryNav from './SecondaryNav'
import UtilityPanel from './UtilityPanel'

/**
 * `screenOwnsHeader` lets a V6 screen compose its own page header — the
 * Overview's date/context kicker, sentence title and period control cannot be
 * expressed by the shared PageHeader. Such a screen must still render the
 * `page-title` h1 the shell focuses and labels `main` with.
 */
export default function AppShell({ children, identity, navigate, onSignOut, presentation, route, screenOwnsHeader = false, takePendingFocusTarget }) {
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
    <div className="shell-root">
      <a href="#main-content" className="shell-skip-link">
        Skip to content
      </a>
      <div className="shell-layout">
        <DesktopSidebar
          activeKey={presentation.primary}
          navigate={navigate}
          onOpenUtility={openUtility}
        />
        <div className="shell-content-column">
          <div className="shell-mobile-region">
            <MobileAppHeader onOpenUtility={openUtility} />
            <MobileNav activeKey={presentation.primary} navigate={navigate} />
          </div>
          <div className="shell-secondary-region">
            <SecondaryNav activeKey={presentation.secondary} items={presentation.secondaryItems} navigate={navigate} />
          </div>

          <main id="main-content" aria-labelledby="page-title" className="shell-main">
            <ContentFrame width={presentation.width}>
              {screenOwnsHeader
                ? null
                : <PageHeader kicker={presentation.primary === 'overview' ? 'Command center' : presentation.primary} title={presentation.title} />}
              {children}
            </ContentFrame>
          </main>
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
