import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getChatUnread } from '../../server/board'

type AreaNavItem = {
  to: '/styre' | '/styre/prosjekter' | '/styre/moter' | '/styre/chat' | '/styre/dokumenter'
  label: string
  exact?: boolean
}

const ITEMS: AreaNavItem[] = [
  { to: '/styre', label: 'Oppgaver', exact: true },
  { to: '/styre/prosjekter', label: 'Prosjekter' },
  { to: '/styre/moter', label: 'Møter' },
  { to: '/styre/chat', label: 'Chat' },
  { to: '/styre/dokumenter', label: 'Dokumenter' },
]

/**
 * Styreområdet: oppgaver, prosjekter, møter, chat og dokumenter — synlig kun
 * for dem som har `board.manage`. Områdemenyen er området sin egen navigasjon
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
  // Ulest-prikken på «Chat» skal være riktig uansett hvilken side i området man
  // står på, så den hentes her og ikke i chat-ruten.
  loader: () => getChatUnread(),
  component: StyreLayout,
})

function StyreLayout() {
  const { unread } = Route.useLoaderData()

  return (
    <div>
      <div className="-mt-2 mb-9 border-b border-line">
        <nav
          className="flex items-center gap-5 overflow-x-auto overscroll-x-contain pb-2.5 sm:gap-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Styre"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className="nav-link flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-ink [&[data-status=active]]:text-brass-strong"
            >
              {item.label}
              {item.to === '/styre/chat' && unread > 0 && (
                <span
                  className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-brass px-1 font-mono text-[0.58rem] font-semibold tabular-nums text-paper-raised dark:text-paper"
                  aria-label={unread === 1 ? '1 ulest melding' : `${unread} uleste meldinger`}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
