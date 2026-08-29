import { PRIMARY_NAV_ITEMS } from '../lib/routes'
import AppLink from './AppLink'
import NavIcon from './NavIcon'

export default function DesktopSidebar({ activeKey, navigate, onOpenUtility }) {
  return (
    <aside className="sticky top-0 hidden h-screen min-h-[36rem] flex-col border-r border-border bg-surface md:flex" aria-label="Application sidebar">
      <div className="flex h-20 items-center gap-3 border-b border-border px-3 min-[1200px]:px-5">
        <span aria-hidden="true" className="brand-mark flex size-10 shrink-0 items-center justify-center rounded-feature bg-text-primary text-body font-bold text-text-inverse">
          <span className="size-2.5 rotate-45 rounded-[3px] border-2 border-current" />
        </span>
        <span className="hidden min-w-0 min-[1200px]:block">
          <span className="block truncate text-title-3 font-semibold text-text-primary">Our Money</span>
          <span className="block truncate text-micro text-text-tertiary">Household finances</span>
        </span>
      </div>

      <nav aria-label="Desktop primary navigation" className="flex-1 px-2 py-5 min-[1200px]:px-3">
        <ul className="m-0 space-y-1.5 p-0">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const active = item.key === activeKey
            return (
              <li key={item.key} className="list-none">
                <AppLink
                  href={item.href}
                  navigate={navigate}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-[3.5rem] flex-col items-center justify-center rounded-panel px-1 text-center font-semibold transition-colors min-[1200px]:min-h-control min-[1200px]:flex-row min-[1200px]:justify-start min-[1200px]:gap-3 min-[1200px]:px-3 min-[1200px]:text-left ${
                    active
                      ? 'bg-action-soft text-action'
                      : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                  }`}
                >
                  <NavIcon name={item.key} className="size-5 shrink-0 min-[1200px]:w-5" />
                  <span className="mt-1 text-micro min-[1200px]:mt-0 min-[1200px]:text-body">{item.label}</span>
                  {active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-action" /> : null}
                </AppLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="space-y-1 border-t border-border p-2 min-[1200px]:p-3">
        <AppLink
          href="/settings"
          navigate={navigate}
          className="flex min-h-control flex-col items-center justify-center rounded-control px-1 text-micro font-semibold text-text-secondary hover:bg-surface-subtle hover:text-text-primary min-[1200px]:flex-row min-[1200px]:justify-start min-[1200px]:px-3 min-[1200px]:text-body"
        >
          <NavIcon name="settings" className="size-5 min-[1200px]:mr-3" />
          <span>Settings</span>
        </AppLink>
        <button
          type="button"
          onClick={onOpenUtility}
          className="flex min-h-control w-full flex-col items-center justify-center rounded-control px-1 text-micro font-semibold text-text-secondary hover:bg-surface-subtle hover:text-text-primary min-[1200px]:flex-row min-[1200px]:justify-start min-[1200px]:px-3 min-[1200px]:text-body"
        >
          <NavIcon name="preferences" className="size-5 min-[1200px]:mr-3" />
          <span>Preferences</span>
        </button>
      </div>
    </aside>
  )
}
