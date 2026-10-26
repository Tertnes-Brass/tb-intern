/**
 * Strekikoner til fanelinjen og «Meg og mer». Ett 24×24-rutenett, 1.7 i strek,
 * `currentColor` — så de følger tekstfargen og temaet som alt annet.
 */
const PATHS = {
  home: <path d="M3.5 10.5 12 3.8l8.5 6.7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />,
  forum: (
    <>
      <path d="M4 4.5h10.5A1.5 1.5 0 0 1 16 6v6a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5z" />
      <path d="M16 8.5h3.5A1.5 1.5 0 0 1 21 10v6a1.5 1.5 0 0 1-1.5 1.5H19v3l-4-3h-4a1.5 1.5 0 0 1-1.5-1.5v-1" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3.5 10v4a1 1 0 0 0 1 1H7l9 5V4L7 9H4.5a1 1 0 0 0-1 1z" />
      <path d="M7 15l1.5 5H11l-1.2-4" />
      <path d="M19 9.3a3.6 3.6 0 0 1 0 5.4" />
    </>
  ),
  notes: (
    <>
      <path d="M3.5 6h10M3.5 10.5h10M3.5 15h6" />
      <path d="M17.3 17.5V5l3.7-1.2" />
      <circle cx="15" cy="17.5" r="2.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M16.5 14.6c2.4.2 4 1.7 4.5 4.4" />
    </>
  ),
  board: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  star: <path d="M12 3.5l2.4 4.9 5.3.8-3.8 3.7.9 5.3L12 15.7l-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" />,
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  search: (
    <>
      <path d="M13.5 3.5h-7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h5" />
      <path d="M13.5 3.5l5 5v2.5" />
      <circle cx="16" cy="16.5" r="3" />
      <path d="M18.2 18.7 20.5 21" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 15.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3.5" />
    </>
  ),
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  play: <path d="M7.5 5v14l11-7z" fill="currentColor" stroke="none" />,
  playCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v12M8 7.5l4-4 4 4" />
      <path d="M7.5 11H6a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12a1 1 0 0 0-1-1h-1.5" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  wifiOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 16.3a5 5 0 0 1 6-.6M5 12.6a10 10 0 0 1 4-2.3M19 12.6a10 10 0 0 0-2.7-1.9M2 9.2a15 15 0 0 1 4.3-2.7M22 9.2A15 15 0 0 0 11 5.1" />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 22,
  className = '',
  strokeWidth = 1.7,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  )
}
