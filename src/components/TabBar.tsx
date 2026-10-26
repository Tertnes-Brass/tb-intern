import { Link, useRouterState } from '@tanstack/react-router'
import { badgeLabel, type ShellCounts } from '../lib/unread'
import { Icon, type IconName } from './Icons'

export type TabTo = '/' | '/forum' | '/beskjeder' | '/noter' | '/kalender'

type Tab = { to: TabTo; label: string; icon: IconName; exact?: boolean }

/**
 * Fanelinjen på telefon: de fem første oppføringene i toppmenyen, like for
 * alle roller (docs/designprinsipper.md §6). Medlemmer og de rollestyrte
 * områdene bor i «Meg og mer» bak avataren, så linjen aldri trenger å rulle.
 * Desktop beholder toppmenyen i `Shell.tsx`.
 *
 * Bytte av fane skal føles umiddelbart: rutene bak fanene har
 * `preloadStaleTime: Infinity`. Ellers henter forhåndslastingen (når fingeren
 * treffer skjermen) siden på nytt, og navigasjonen venter på den i stedet for
 * å vise forrige versjon med en gang og oppdatere i bakgrunnen.
 */
export const TABS: Tab[] = [
  { to: '/', label: 'Hjem', icon: 'home', exact: true },
  { to: '/forum', label: 'Forum', icon: 'forum' },
  { to: '/beskjeder', label: 'Beskjeder', icon: 'megaphone' },
  { to: '/noter', label: 'Noter', icon: 'notes' },
  { to: '/kalender', label: 'Kalender', icon: 'calendar' },
]

export function TabBar({ counts }: { counts: ShellCounts }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav
      className="tab-bar print-hidden pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper md:hidden"
      aria-label="Hovedmeny"
    >
      <ul className="px-safe mx-auto grid h-[58px] max-w-lg grid-cols-5">
        {TABS.map((tab) => {
          const badge = tab.to === '/beskjeder' ? badgeLabel(counts.unreadPosts) : null
          const dot = tab.to === '/forum' && counts.forumUnread
          return (
            <li key={tab.to} className="flex">
              <Link
                to={tab.to}
                activeOptions={{ exact: tab.exact ?? false }}
                onClick={() => {
                  // Trykk på fanen du allerede står på = tilbake til toppen, som i
                  // en vanlig app.
                  if (pathname === tab.to) window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="tab-link relative flex flex-1 flex-col items-center justify-center gap-[3px] text-[0.64rem] font-medium tracking-[0.01em] text-ink-faint transition-colors [&[data-status=active]]:text-brass-strong"
              >
                <span className="relative">
                  <Icon name={tab.icon} size={23} />
                  {badge && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-oxblood px-1 font-mono text-[0.58rem] font-semibold leading-none text-paper-raised ring-2 ring-paper">
                      {badge}
                    </span>
                  )}
                  {dot && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brass ring-2 ring-paper" />}
                </span>
                {tab.label}
                {badge && <span className="sr-only">, {counts.unreadPosts} uleste</span>}
                {dot && <span className="sr-only">, nye svar</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
