import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Me } from '../server/access'
import { type HubAreaTo, areasFor } from '../lib/hub'
import { formatBytes } from '../lib/format'
import { clearOfflineNotes, offlineBytes, offlineStands, offlineSupported } from '../lib/offline-notes'
import { currentPushSubscription, pushSupport } from '../lib/push-client'
import { signOutHere } from '../lib/session-client'
import { type ThemeMode, readThemeMode, setThemeMode } from '../lib/theme'
import type { ShellCounts } from '../lib/unread'
import { Icon, type IconName } from './Icons'
import { TABS } from './TabBar'
import { Segmented } from './Segmented'
import { Avatar, BottomSheet, SheetAction, SheetActions } from './ui'

/** Ikon og kortlinje per område i launcheren. Etikettene kommer fra `areasFor`. */
const AREA_TILES: Partial<Record<HubAreaTo, { icon: IconName; hint: string }>> = {
  '/medlemmer': { icon: 'people', hint: 'Hvem spiller hva' },
  '/gruppeledere': { icon: 'star', hint: 'Oversikt og chat' },
  '/styre': { icon: 'board', hint: 'Oppgaver og møter' },
  '/fravaer': { icon: 'absence', hint: 'Hvem kan ikke komme' },
  '/innstillinger/nedlastinger': { icon: 'search', hint: 'Hvem har åpnet hva' },
  '/innstillinger': { icon: 'sliders', hint: 'Besetning og roller' },
}

const THEME_CHOICES: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'auto', label: 'Følg telefonen' },
  { mode: 'light', label: 'Lyst' },
  { mode: 'dark', label: 'Mørkt' },
]

/**
 * «Meg og mer» — arket bak avataren på berøringsskjerm og i smale vinduer.
 * Her bor alt som ikke har plass i fanelinjen: profilen, de rollestyrte områdene (samme `areasFor` som hub-en,
 * minus det fanelinjen allerede har), varsler, utseende og utlogging.
 *
 * Dette er launcher-flaten (b) fra docs/designprinsipper.md §6, men bare med
 * `appnav`: desktop med mus beholder toppmenyen og brukermenyen.
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
  const [offline, setOffline] = useState<{ supported: boolean; stands: number; bytes: number }>({
    supported: false,
    stands: 0,
    bytes: 0,
  })

  const [push, setPush] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTheme(readThemeMode())
    setOffline({ supported: offlineSupported(), stands: offlineStands().length, bytes: offlineBytes() })
    const support = pushSupport()
    if (support === 'needs-install') setPush('Krever Hjem-skjerm')
    else if (support === 'unsupported') setPush(null)
    else
      currentPushSubscription()
        .then((sub) => setPush(sub && Notification.permission === 'granted' ? 'På' : 'Av'))
        .catch(() => setPush(null))
  }, [open])

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Meg og mer"
      closeLabel="Ferdig"
    >
      <Link
        to="/min-profil"
        onClick={onClose}
        className="surface-group link-quiet flex items-center gap-3.5 px-4 py-3.5 active:bg-paper-sunken"
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
          <p className="group-label mt-6">Dine områder</p>
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
                    className="surface-group link-quiet relative flex min-h-[104px] flex-1 flex-col justify-between gap-3 px-3 py-3 active:bg-paper-sunken"
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

      <SheetActions className="mt-6">
        <Link
          to="/min-profil"
          hash="varsler"
          onClick={onClose}
          className="sheet-action"
        >
          <GroupIcon name="bell" />
          <span className="flex-1">Varsler</span>
          {push && <span className="sheet-action-value">{push}</span>}
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </Link>
        {offline.supported && (
          <div className="sheet-action is-static">
            <GroupIcon name="download" />
            <span className="flex-1">Lagret offline</span>
            {offline.stands > 0 ? (
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm('Fjerne notene som er lagret på denne enheten?')) return
                  await clearOfflineNotes()
                  setOffline((o) => ({ ...o, stands: 0, bytes: 0 }))
                }}
                className="-mr-2 min-h-11 cursor-pointer rounded-[9px] px-2 text-sm font-normal text-ink-soft active:bg-paper-sunken"
              >
                {formatBytes(offline.bytes)} · <span className="font-medium text-danger">Fjern</span>
              </button>
            ) : (
              <span className="sheet-action-value">Ingenting</span>
            )}
          </div>
        )}
        <div className="sheet-action is-static flex-col !items-stretch gap-3 py-3">
          <div className="flex items-center gap-[0.85rem]">
            <GroupIcon name="contrast" />
            <span className="flex-1">Utseende</span>
          </div>
          <Segmented
            label="Utseende"
            stretch
            value={theme}
            options={THEME_CHOICES.map((c) => ({ value: c.mode, label: c.label }))}
            onChange={(mode) => {
              setThemeMode(mode)
              setTheme(mode)
            }}
          />
        </div>
      </SheetActions>

      <SheetActions>
        <SheetAction
          tone="danger"
          disabled={signingOut}
          icon={signingOut ? <span className="spinner" aria-hidden /> : <Icon name="logout" size={19} />}
          label="Logg ut"
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
        />
      </SheetActions>
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
