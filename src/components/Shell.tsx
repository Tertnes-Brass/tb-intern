import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Me } from '../server/access'
import { getShellCounts } from '../server/shell'
import { isGroupLeader } from '../lib/gruppeledere'
import { signOutHere } from '../lib/session-client'
import { onShellCountsRefresh } from '../lib/shell-events'
import { setThemeMode } from '../lib/theme'
import { EMPTY_SHELL_COUNTS, type ShellCounts, badgeLabel } from '../lib/unread'
import { AppBehaviour, OfflineBanner, PullToRefresh } from './AppBehaviour'
import { Launcher } from './Launcher'
import { TabBar } from './TabBar'
import { Avatar } from './ui'

function ThemeToggle() {
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setResolved(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  const toggle = () => {
    const next = resolved === 'dark' ? 'light' : 'dark'
    setResolved(setThemeMode(next))
  }

  return (
    <button
      onClick={toggle}
      aria-label={resolved === 'dark' ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'}
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
    >
      {resolved === 'dark' ? (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <circle cx="7.5" cy="7.5" r="3.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.5 .8v1.9M7.5 12.3v1.9M.8 7.5h1.9M12.3 7.5h1.9M2.8 2.8l1.3 1.3M10.9 10.9l1.3 1.3M12.2 2.8l-1.3 1.3M4.1 10.9l-1.3 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <path d="M13 9.2A5.7 5.7 0 1 1 5.8 2a4.6 4.6 0 0 0 7.2 7.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2.5 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-paper-sunken"
        aria-expanded={open}
      >
        <Avatar name={me.name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block text-[0.8rem] font-semibold leading-tight text-ink">{me.name}</span>
          <span className="block font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">
            {me.roleName}
          </span>
        </span>
      </button>
      {open && (
        <div className="sheet rise absolute right-0 top-[calc(100%+6px)] z-50 w-52 overflow-hidden !rounded-xl p-1.5">
          <div className="border-b border-line px-3 py-2 sm:hidden">
            <p className="text-sm font-semibold">{me.name}</p>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{me.roleName}</p>
          </div>
          {me.parts.length > 0 && (
            <p className="px-3 pb-1 pt-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">
              {me.parts.map((p) => p.nameNo).join(' · ')}
            </p>
          )}
          <Link
            to="/min-profil"
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Min profil
          </Link>
          <button
            onClick={async () => {
              try {
                await signOutHere()
              } finally {
                await router.invalidate()
                router.navigate({ to: '/login' })
              }
            }}
            className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Logg ut
          </button>
        </div>
      )}
    </div>
  )
}

type NavItem = {
  to: '/' | '/forum' | '/beskjeder' | '/noter' | '/kalender' | '/medlemmer' | '/gruppeledere' | '/styre' | '/innstillinger'
  label: string
  exact?: boolean
}

// Kort toppmeny på desktop; hvert område eier sin egen undernavigasjon
// (navigasjonsmodell (a) i docs/designprinsipper.md §6). «Noter» er aktiv for
// hele /noter/*, så Prosjekter og Arkiv hører hjemme i områdemenyen, ikke her.
//
// Forum er en fast oppføring etter Hjem, etter brukerens ønske (26. september).
// Filtilganger nås fortsatt fra Innstillinger og områdesnarveien på Hjem.
//
// På telefon (< md) erstattes menyen av fanelinjen (`TabBar.tsx`: de fem første
// oppføringene her) og «Meg og mer» bak avataren (`Launcher.tsx`: resten).
const BASE_NAV: NavItem[] = [
  { to: '/', label: 'Hjem', exact: true },
  { to: '/forum', label: 'Forum' },
  { to: '/beskjeder', label: 'Beskjeder' },
  { to: '/noter', label: 'Noter' },
  { to: '/kalender', label: 'Kalender' },
  { to: '/medlemmer', label: 'Medlemmer' },
]

/**
 * Tellerne i skallet. Hentes etter navigasjon (maks hvert 20. sekund), når
 * appen kommer tilbake i forgrunnen, og med en gang når en side sier fra
 * (`refreshShellCounts`). Tallet på app-ikonet (Badging API) følger med.
 */
function useShellCounts(): ShellCounts {
  const [counts, setCounts] = useState<ShellCounts>(EMPTY_SHELL_COUNTS)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const lastFetch = useRef(0)

  const load = useCallback(async (force: boolean) => {
    if (!force && Date.now() - lastFetch.current < 20_000) return
    lastFetch.current = Date.now()
    try {
      const next = await getShellCounts()
      setCounts(next)
      updateAppBadge(next.unreadPosts)
    } catch {
      // Frakoblet eller utlogget: behold det vi har.
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [pathname, load])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    const off = onShellCountsRefresh(() => void load(true))
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      off()
    }
  }, [load])

  return counts
}

/** Tallet på app-ikonet (installert PWA). Stilltiende uten støtte. */
function updateAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const canManageSettings = me.permissions.includes('*') || me.permissions.includes('settings.manage')
  const canManageBoard = me.permissions.includes('*') || me.permissions.includes('board.manage')
  const counts = useShellCounts()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const NAV: NavItem[] = [...BASE_NAV]
  // Gruppeledere (#81): aktiv leiarbinding, samme rene regel som
  // guarden på serveren og `areasFor` på hub-en. En admin uten binding ser den
  // altså ikke — oppføringen skal si noe om hva du gjør, ikke hva du kan.
  if (isGroupLeader(me)) NAV.push({ to: '/gruppeledere', label: 'Gruppeledere' })
  // Styret er et eget område, ikke en fane i noe annet — men det vises bare for
  // dem det gjelder, slik Arkiv gjør i noteområdet.
  if (canManageBoard) NAV.push({ to: '/styre', label: 'Styre' })
  // exact, ellers markeres Innstillinger som aktiv også på /innstillinger/nedlastinger
  if (canManageSettings) NAV.push({ to: '/innstillinger', label: 'Innstillinger', exact: true })
  const unread = badgeLabel(counts.unreadPosts)
  const launcherAttention = (counts.board?.overdue ?? 0) > 0

  return (
    // `app-shell`: i installert app på iOS er det denne som ruller, ikke vinduet
    // (`html.ios-app` i styles.css, src/lib/app-scroll.ts).
    <div className="app-shell flex min-h-dvh flex-col" data-scroll-restoration-id="app">
      {/* Tett bakgrunn, ingen backdrop-filter. */}
      <header className="print-hidden pt-safe sticky top-0 z-40 border-b border-line bg-paper">
        <div className="px-safe mx-auto flex h-[56px] w-full max-w-6xl items-center justify-between gap-4 md:h-[60px]">
          <Link to="/" className="link-quiet group flex shrink-0 items-baseline gap-2.5">
            <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-ink">
              Tertnes Brass
            </span>
            <span className="display-title text-[1.05rem] italic leading-none text-brass-strong transition-colors group-hover:text-brass">
              Intern
            </span>
          </Link>

          <nav className="hidden min-w-0 items-center gap-5 overflow-x-auto md:flex" aria-label="Hovedmeny">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className="nav-link shrink-0 whitespace-nowrap text-[0.86rem] font-medium text-ink-soft transition-colors hover:text-ink [&[data-status=active]]:text-ink"
              >
                {item.label}
                {item.to === '/beskjeder' && unread && (
                  <span className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-oxblood px-1 align-[1px] font-mono text-[0.56rem] font-semibold text-paper-raised">
                    {unread}
                    <span className="sr-only"> uleste</span>
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <ThemeToggle />
            <UserMenu me={me} />
          </div>

          {/* Telefon: avataren åpner «Meg og mer». */}
          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            aria-label="Meg og mer"
            aria-haspopup="dialog"
            className="relative -mr-1.5 grid h-11 w-11 cursor-pointer place-items-center rounded-full md:hidden"
          >
            <Avatar name={me.name} />
            {launcherAttention && (
              <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-oxblood ring-2 ring-paper" aria-hidden />
            )}
          </button>
        </div>
        <OfflineBanner />
        <NavProgress />
        <PullToRefresh />
      </header>

      {/* `overflow-x-clip`: noe som er bredere enn telefonen, skal aldri gjøre
          hele siden sidelengs rullbar. `clip` (ikke `hidden`) lager ingen
          rullecontainer, så sticky inni virker fortsatt. */}
      <main className="main-with-tabs px-safe mx-auto w-full max-w-6xl flex-1 overflow-x-clip pt-6 sm:pt-10">{children}</main>

      <footer className="print-hidden pb-safe hidden border-t border-line md:block">
        <div className="px-safe mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 py-6">
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-ink-faint">
            Tertnes Brass · Intern
          </p>
          <div className="staff-rule w-28 opacity-50" aria-hidden />
        </div>
      </footer>

      <TabBar counts={counts} />
      <AppBehaviour />
      <Launcher me={me} counts={counts} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  )
}

/**
 * Tynn messinglinje under toppmenyen mens en navigasjon venter på serveren —
 * fanen markeres med en gang, og linjen viser at noe skjer. Først etter 150 ms,
 * så sider fra cachen ikke blinker.
 */
function NavProgress() {
  const pending = useRouterState({ select: (s) => s.status === 'pending' })
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!pending) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), 150)
    return () => clearTimeout(timer)
  }, [pending])
  return <div aria-hidden className={`nav-progress${visible ? ' is-active' : ''}`} />
}
