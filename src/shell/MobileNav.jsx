import { useEffect, useRef } from 'react'
import { PRIMARY_NAV_ITEMS } from '../lib/routes'
import AppLink from './AppLink'

export default function MobileNav({ activeKey, navigate }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  return (
    <nav aria-label="Mobile primary navigation" className="shell-mobile-nav">
      <ul>
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = item.key === activeKey
          return (
            <li key={item.key}>
              <AppLink
                href={item.href}
                navigate={navigate}
                aria-current={active ? 'page' : undefined}
                className="shell-mobile-link"
              >
                <span ref={active ? activeRef : undefined}>{item.label}</span>
              </AppLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
