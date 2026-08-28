import { useEffect, useRef } from 'react'
import AppLink from './AppLink'

export default function SecondaryNav({ activeKey, items, navigate }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  if (!items?.length) return null

  return (
    <nav aria-label="Section navigation" className="border-b border-border bg-surface/95 backdrop-blur-md">
      <div className="mx-auto max-w-content overflow-x-auto px-2 [scrollbar-width:none] sm:px-4 lg:px-6 [&::-webkit-scrollbar]:hidden">
        <ul className="m-0 flex min-w-max list-none gap-1 p-1.5">
          {items.map((item) => {
            const active = item.key === activeKey
            return (
              <li key={item.key}>
                <AppLink
                  href={item.href}
                  navigate={navigate}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-control-sm items-center rounded-control px-3 text-body-sm font-semibold transition-colors ${
                    active
                      ? 'bg-action-soft text-action'
                      : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                  }`}
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
