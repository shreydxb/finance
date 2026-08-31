import { useEffect, useRef } from 'react'
import AppLink from './AppLink'

export default function SecondaryNav({ activeKey, items, navigate }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  if (!items?.length) return null

  return (
    <nav aria-label="Section navigation" className="shell-secondary-nav">
      <div className="shell-secondary-scroll">
        <ul>
          {items.map((item) => {
            const active = item.key === activeKey
            return (
              <li key={item.key}>
                <AppLink
                  href={item.href}
                  navigate={navigate}
                  aria-current={active ? 'page' : undefined}
                  className="shell-secondary-link"
                >
                  <span ref={active ? activeRef : undefined}>{item.label}</span>
                </AppLink>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
