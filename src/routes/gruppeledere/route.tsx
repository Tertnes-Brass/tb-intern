import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { isGroupLeader } from '../../lib/gruppeledere'
import { getChatUnread } from '../../server/gruppeledere'

type AreaNavItem = {
  to: '/gruppeledere' | '/gruppeledere/chat'
  label: string
  exact?: boolean
}

const ITEMS: AreaNavItem[] = [
  { to: '/gruppeledere', label: 'Oversikt', exact: true },
  { to: '/gruppeledere/chat', label: 'Chat' },
]

/**
 * Gruppelederområdet (#81): oversikt over hvem som leder hvilke stemmer, og
 * gruppeledernes egen chat. Områdemenyen er området sin egen navigasjon
 * (navigasjonsmodell (a) i `docs/designprinsipper.md` §6), som i `/styre` og
 * `/noter`.
 *
 * Sjekken her er kosmetikk: hver serverfunksjon i `src/server/gruppeledere.ts`
 * går gjennom `requireGroupLeader()` — også lesing. Regelen (`isGroupLeader`)
 * er den samme rene funksjonen som toppmenyen og hub-en bruker, så de tre kan
 * ikke komme i utakt.
 */
export const Route = createFileRoute('/gruppeledere')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    // Uten aktiv leiarbinding finnes ikke området.
    if (!isGroupLeader(context.me)) throw redirect({ to: '/' })
    return { me: context.me }
  },
  // Ulest-prikken på «Chat» skal være riktig uansett hvilken side i området man
  // står på, så den hentes her og ikke i chat-ruten.
  loader: () => getChatUnread(),
  component: GruppeledereLayout,
})

function GruppeledereLayout() {
  const { unread } = Route.useLoaderData()

  return (
    <div>
      <div className="-mt-2 mb-9 border-b border-line">
        <nav
          className="flex items-center gap-5 overflow-x-auto overscroll-x-contain pb-2.5 sm:gap-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Gruppeledere"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className="nav-link flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-ink [&[data-status=active]]:text-brass-strong"
            >
              {item.label}
              {item.to === '/gruppeledere/chat' && unread > 0 && (
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
