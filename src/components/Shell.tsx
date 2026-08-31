import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { Me } from '../server/access'
import { authClient } from '../lib/auth-client'
import { Avatar } from './ui'

function ThemeToggle() {
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setResolved(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  const toggle = () => {
    const next = resolved === 'dark' ? 'light' : 'dark'
    setResolved(next)
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(next)
    root.setAttribute('data-theme', next)
    root.style.colorScheme = next
    try {
      localStorage.setItem('theme', next)
    } catch {}
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
                await authClient.signOut()
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
  to: '/' | '/beskjeder' | '/noter' | '/kalender' | '/medlemmer' | '/styre' | '/innstillinger'
  label: string
  exact?: boolean
}

// Kort toppmeny; hvert område eier sin egen undernavigasjon (navigasjonsmodell
// (a) i docs/designprinsipper.md §6). «Noter» er aktiv for hele /noter/*, så
// Prosjekter og Arkiv hører hjemme i områdemenyen, ikke her.
//
// Filtilganger ble tatt UT av toppmenyen da Beskjeder kom (§6): fem faste
// oppføringer + Innstillinger er taket, og en sjuende ville forsvunnet bak
// fade-gradienten på mobil uten at noen merket det. URL-en
// `/innstillinger/nedlastinger` består, og området nås fra /innstillinger og
// fra «Områder» på hub-en (`areasFor` i src/lib/hub.ts).
const BASE_NAV: NavItem[] = [
  { to: '/', label: 'Hjem', exact: true },
  { to: '/beskjeder', label: 'Beskjeder' },
  { to: '/noter', label: 'Noter' },
  { to: '/kalender', label: 'Kalender' },
  { to: '/medlemmer', label: 'Medlemmer' },
]

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const canManageSettings = me.permissions.includes('*') || me.permissions.includes('settings.manage')
  const canManageBoard = me.permissions.includes('*') || me.permissions.includes('board.manage')
  const NAV: NavItem[] = [...BASE_NAV]
  // Styret er et eget område, ikke en fane i noe annet — men det vises bare for
  // dem det gjelder, slik Arkiv gjør i noteområdet.
  if (canManageBoard) NAV.push({ to: '/styre', label: 'Styre' })
  // exact, ellers markeres Innstillinger som aktiv også på /innstillinger/nedlastinger
  if (canManageSettings) NAV.push({ to: '/innstillinger', label: 'Innstillinger', exact: true })
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="print-hidden sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="link-quiet group flex items-baseline gap-2.5">
            <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-ink">
              Tertnes Brass
            </span>
            <span className="display-title text-[1.05rem] italic leading-none text-brass-strong transition-colors group-hover:text-brass">
              Intern
            </span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Hovedmeny">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className="nav-link text-[0.86rem] font-medium text-ink-soft transition-colors hover:text-ink [&[data-status=active]]:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu me={me} />
          </div>
        </div>
        <div className="relative md:hidden after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-8 after:bg-gradient-to-l after:from-paper/85 after:to-transparent">
          <nav
            className="flex items-center gap-5 overflow-x-auto overscroll-x-contain border-t border-line px-4 py-1.5 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Hovedmeny mobil"
          >
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className="nav-link whitespace-nowrap py-1 text-[0.8rem] font-medium text-ink-soft [&[data-status=active]]:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-10">{children}</main>

      <footer className="print-hidden border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-ink-faint">
            Tertnes Brass · Intern
          </p>
          <div className="staff-rule w-28 opacity-50" aria-hidden />
        </div>
      </footer>
    </div>
  )
}
