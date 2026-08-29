import { PRIMARY_NAV_ITEMS } from '../lib/routes'
import AppLink from './AppLink'
import NavIcon from './NavIcon'

export default function MobileBottomNav({ activeKey, navigate }) {
  return (
    <nav aria-label="Mobile primary navigation" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md md:hidden">
      <ul className="m-0 grid grid-cols-4 p-0">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = item.key === activeKey
          return (
            <li key={item.key} className="list-none">
              <AppLink
                href={item.href}
                navigate={navigate}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[3.5rem] flex-col items-center justify-center px-1 pb-1 pt-1.5 text-micro font-semibold transition-colors ${
                  active ? 'text-action' : 'text-text-tertiary hover:text-text-primary'
                }`}
              >
                <span aria-hidden="true" className={`mb-1 flex size-7 items-center justify-center rounded-control ${active ? 'bg-action-soft' : ''}`}>
                  <NavIcon name={item.key} className="size-[1.125rem]" />
                </span>
                <span>{item.label}</span>
                {active ? <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-action" /> : null}
              </AppLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
