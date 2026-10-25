import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Me } from '../server/access'
import { type HubAreaTo, areasFor } from '../lib/hub'
import { signOutHere } from '../lib/session-client'
import { type ThemeMode, readThemeMode, setThemeMode } from '../lib/theme'
import type { ShellCounts } from '../lib/unread'
import { Icon, type IconName } from './Icons'
import { TABS } from './TabBar'
import { Avatar, BottomSheet } from './ui'

/** Ikon og kortlinje per område i launcheren. Etikettene kommer fra `areasFor`. */
const AREA_TILES: Partial<Record<HubAreaTo, { icon: IconName; hint: string }>> = {
  '/medlemmer': { icon: 'people', hint: 'Hvem spiller hva' },
  '/gruppeledere': { icon: 'star', hint: 'Oversikt og chat' },
  '/styre': { icon: 'board', hint: 'Oppgaver og møter' },
  '/innstillinger/nedlastinger': { icon: 'search', hint: 'Hvem har åpnet hva' },
  '/innstillinger': { icon: 'sliders', hint: 'Besetning og roller' },
}

const THEME_CHOICES: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'auto', label: 'Følg telefonen' },
  { mode: 'light', label: 'Lyst' },
  { mode: 'dark', label: 'Mørkt' },
]

/**
 * «Meg og mer» — arket bak avataren på telefon. Her bor alt som ikke har plass
 * i fanelinjen: profilen, de rollestyrte områdene (samme `areasFor` som hub-en,
 * minus det fanelinjen allerede har), varsler, utseende og utlogging.
 *
 * Dette er launcher-flaten (b) fra docs/designprinsipper.md §6, men bare på
 * telefon: desktop beholder toppmenyen og brukermenyen.
 */
export function Launcher({
  me,
  counts,
  open,
  onClose,
}: {
  me: Me
  counts: ShellCounts
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const tabRoutes = new Set<string>(TABS.map((t) => t.to))
  const areas = areasFor(me.permissions, { leadsPartIds: me.leadsPartIds }).filter((a) => !tabRoutes.has(a.to))
  const [theme, setTheme] = useState<ThemeMode>('auto')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (open) setTheme(readThemeMode())
  }, [open])

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Meg og mer"
      header={
        <div className="flex items-center justify-between">
          <span className="w-16" />
          <p className="text-[0.95rem] font-semibold text-ink">Meg og mer</p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-16 cursor-pointer text-right text-[0.95rem] font-semibold text-brass-strong"
          >
            Ferdig
          </button>
        </div>
      }
    >
      <Link
        to="/min-profil"
        onClick={onClose}
        className="sheet link-quiet flex items-center gap-3.5 px-4 py-3.5 active:bg-paper-sunken"
      >
        <Avatar name={me.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{me.name}</span>
          <span className="block truncate text-sm text-ink-soft">
            {[me.roleName, ...me.parts.map((p) => p.nameNo)].join(' · ')}
          </span>
        </span>
        <Icon name="chevronRight" size={18} className="text-ink-faint" />
      </Link>

      {areas.length > 0 && (
        <>
          <p className="kicker mb-2.5 mt-6">Dine områder</p>
          <ul className="grid grid-cols-3 gap-2.5">
            {areas.map((area) => {
              const tile = AREA_TILES[area.to] ?? { icon: 'chevronRight' as IconName, hint: '' }
              // Kort nok for en flis: det forfalte hvis noe er forfalt, ellers antallet åpne.
              const board = area.to === '/styre' ? counts.board : null
              const overdue = (board?.overdue ?? 0) > 0
              const note = board ? (overdue ? `${board.overdue} forfalt` : board.openTasks > 0 ? `${board.openTasks} åpne` : null) : null
              return (
                <li key={area.to} className="flex">
                  <Link
                    to={area.to}
                    onClick={onClose}
                    className="sheet link-quiet relative flex min-h-[104px] flex-1 flex-col justify-between gap-3 px-3 py-3 active:bg-paper-sunken"
                  >
                    <Icon name={tile.icon} size={24} className="text-brass-strong" />
                    {overdue && (
                      <span className="absolute right-2.5 top-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-oxblood px-1 font-mono text-[0.6rem] font-semibold text-paper-raised">
                        {board!.overdue}
                      </span>
                    )}
                    <span>
                      <span className="block text-[0.86rem] font-semibold leading-tight text-ink [hyphens:auto]">{area.label}</span>
                      <span className={`mt-0.5 block text-[0.7rem] leading-snug ${overdue ? 'text-oxblood' : 'text-ink-faint'}`}>
                        {note ?? tile.hint}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="sheet mt-6 divide-y divide-[var(--line)] overflow-hidden">
        <Link to="/min-profil" hash="varsler" onClick={onClose} className="link-quiet flex min-h-[52px] items-center gap-3 px-4 active:bg-paper-sunken">
          <GroupIcon name="bell" />
          <span className="flex-1 text-[0.95rem] text-ink">Varsler</span>
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </Link>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <GroupIcon name="contrast" />
            <span className="flex-1 text-[0.95rem] text-ink">Utseende</span>
          </div>
          <div className="mt-3 grid grid-cols-3 rounded-[10px] bg-paper-sunken p-1" role="radiogroup" aria-label="Utseende">
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                role="radio"
                aria-checked={theme === choice.mode}
                onClick={() => {
                  setThemeMode(choice.mode)
                  setTheme(choice.mode)
                }}
                className={`min-h-10 cursor-pointer rounded-[8px] px-1 text-[0.8rem] font-medium transition-colors ${
                  theme === choice.mode ? 'bg-paper-raised text-ink shadow-[var(--shadow-soft)]' : 'text-ink-soft'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true)
          try {
            await signOutHere()
          } finally {
            onClose()
            await router.invalidate()
            router.navigate({ to: '/login' })
          }
        }}
        className="sheet mt-4 flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 text-[0.95rem] font-semibold text-danger active:bg-paper-sunken disabled:opacity-60"
      >
        {signingOut ? <span className="spinner" aria-hidden /> : <Icon name="logout" size={19} />}
        Logg ut
      </button>
    </BottomSheet>
  )
}

function GroupIcon({ name }: { name: IconName }) {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--brass-soft)] text-brass-strong">
      <Icon name={name} size={18} />
    </span>
  )
}
