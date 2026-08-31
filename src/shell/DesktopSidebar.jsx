import { PRIMARY_NAV_ITEMS } from '../lib/routes'
import AppLink from './AppLink'

export default function DesktopSidebar({ activeKey, navigate, onOpenUtility }) {
  return (
    <aside className="shell-sidebar" aria-label="Application sidebar">
      <div className="shell-brand">
        <span className="shell-brand-name">Our Money</span>
        <span className="shell-brand-subtitle">Household command center</span>
      </div>

      <nav aria-label="Desktop primary navigation" className="shell-primary-nav">
        <ul>
          {PRIMARY_NAV_ITEMS.map((item) => {
            const active = item.key === activeKey
            return (
              <li key={item.key}>
                <AppLink
                  href={item.href}
                  navigate={navigate}
                  aria-current={active ? 'page' : undefined}
                  className="shell-primary-link"
                >
                  <span>{item.label}</span>
                  {active ? <span aria-hidden="true" className="shell-active-mark">→</span> : null}
                </AppLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="shell-sidebar-footer">
        <div className="shell-scope" aria-label="Financial scope: whole household">
          <span>Scope</span>
          <strong>Whole household</strong>
        </div>
        <button type="button" onClick={onOpenUtility} className="shell-preferences-button">
          Theme &amp; preferences
        </button>
      </div>
    </aside>
  )
}
