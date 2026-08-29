const PATHS = {
  overview: <><path d="M4 13h6V4H4v9Z" /><path d="M14 20h6v-9h-6v9Z" /><path d="M4 20h6v-3H4v3Z" /><path d="M14 7h6V4h-6v3Z" /></>,
  money: <><path d="M4 7.5h16" /><path d="M6 4h12a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M16 12h4" /><circle cx="16" cy="12" r=".5" fill="currentColor" /></>,
  wealth: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M3 19h18" /><path d="m4 7 6-4 6 6 4-3" /></>,
  planning: <><path d="M6 3v3M18 3v3" /><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="m8 15 2 2 5-5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3h4v.08A1.7 1.7 0 0 0 15.04 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.4.52.68.95.68H21v4h-.65c-.43 0-.82.28-.95.68Z" /></>,
  preferences: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
}

export default function NavIcon({ name, className = 'size-5' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {PATHS[name] ?? PATHS.overview}
    </svg>
  )
}
