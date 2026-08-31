import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

type AreaNavItem = {
  to: '/styre' | '/styre/moter' | '/styre/dokumenter'
  label: string
  exact?: boolean
}

const ITEMS: AreaNavItem[] = [
  { to: '/styre', label: 'Oppgaver', exact: true },
  { to: '/styre/moter', label: 'Møter' },
  { to: '/styre/dokumenter', label: 'Dokumenter' },
]

/**
 * Styreområdet: oppgaver, møter og dokumenter — synlig kun for dem som har
 * `board.manage`. Områdemenyen er området sin egen navigasjon
 * (navigasjonsmodell (a) i `docs/designprinsipper.md` §6), akkurat som
 * `src/routes/noter/route.tsx`.
 *
 * Sjekken her er kosmetikk: hver serverfunksjon i `src/server/board.ts` og
 * begge rutene under `/api/board-files` gater seg selv på `board.manage`.
 */
export const Route = createFileRoute('/styre')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const { permissions } = context.me
    if (!permissions.includes('*') && !permissions.includes('board.manage')) {
      throw redirect({ to: '/' })
    }
    return { me: context.me }
  },
  component: StyreLayout,
})

function StyreLayout() {
  return (
    <div>
      <div className="-mt-2 mb-9 border-b border-line">
        <nav
          className="flex items-center gap-6 overflow-x-auto overscroll-x-contain pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Styre"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className="nav-link whitespace-nowrap font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-ink [&[data-status=active]]:text-brass-strong"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
