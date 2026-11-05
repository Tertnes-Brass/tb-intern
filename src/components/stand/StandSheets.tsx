/**
 * Arkene i notestativet: «Program» (hopp til et stykke, eller «Fra starten») og
 * «Visning» (visning, nattlys, lytt, offline, del, hjelp for bladingen,
 * fullskjerm). Stativet er alltid mørkt, så arkene har sin egen mørke drakt (`--stand-*` i styles.css) i stedet for appens
 * papir — et lyst ark midt i en mørk sal blender.
 *
 * Sidepanel fra høyre på iPad og bredere (noten blir synlig ved siden av), og
 * bunnark på telefon stående, innenfor tommelens rekkevidde.
 */
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { formatBytes } from '../../lib/format'
import type { StandEntry } from '../../lib/stand'
import { type StandView, VIEW_LABELS } from '../../lib/stand-view'
import { Icon, type IconName } from '../Icons'
import { useSheetDrag } from '../ui'

function StandSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const drag = useSheetDrag(ref, onClose)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.style.transform = ''
      dlg.setAttribute('autofocus', '')
      dlg.showModal()
    }
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="stand-sheet"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {/* Grepet vises bare når arket er et bunnark (telefon). */}
      <div className="stand-sheet-grab shrink-0 touch-none select-none pt-2.5" {...drag}>
        <span aria-hidden />
      </div>
      {/* Samme topp i begge arkene: tittel til venstre, «Ferdig» til høyre —
          en synlig vei ut også der man ikke vet at man kan dra arket ned. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-3">
        <div className="min-w-0">
          <h2 id={titleId} className="display-title text-xl font-semibold text-(--stand-ink)">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate font-mono text-[0.62rem] uppercase tracking-[0.14em] text-(--stand-muted)">
              {subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-2.5 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full px-3 text-[0.95rem] font-semibold text-(--stand-accent) transition-colors hover:bg-(--stand-hover) active:scale-95"
        >
          Ferdig
        </button>
      </div>
      <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-3 pb-5">{children}</div>
    </dialog>
  )
}

// ---------- Program ----------

export function ProgramSheet({
  open,
  onClose,
  projectName,
  entries,
  index,
  onPick,
  onRestart,
}: {
  open: boolean
  onClose: () => void
  projectName: string
  entries: StandEntry[]
  index: number
  onPick: (index: number) => void
  /** «Fra starten»: første side i første stykke. `null` når man allerede står der. */
  onRestart: (() => void) | null
}) {
  const list = useRef<HTMLOListElement>(null)

  // Stykket som spilles nå skal synes med en gang, også i et langt program.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }, [open])

  return (
    <StandSheet open={open} onClose={onClose} title="Program" subtitle={projectName}>
      {onRestart && (
        <button
          type="button"
          onClick={onRestart}
          className="mb-2 flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-(--stand-line) px-3 text-left text-[0.95rem] font-semibold text-(--stand-accent) transition-colors hover:bg-(--stand-hover) active:bg-(--stand-hover)"
        >
          <span className="grid w-9 shrink-0 place-items-center">
            <Icon name="toStart" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            Fra starten
            <span className="block truncate text-xs font-normal text-(--stand-muted)">
              Første side i {entries[0] ? `${entries[0].number} ${entries[0].title}` : 'første stykke'}
            </span>
          </span>
        </button>
      )}
      <ol ref={list} className="space-y-0.5">
        {entries.map((e, i) => {
          const current = i === index
          // To stemmer i samme verk: nummeret står bare på den første.
          const sameWork = i > 0 && entries[i - 1]!.workId === e.workId
          return (
            <li key={e.fileId}>
              <button
                type="button"
                aria-current={current}
                onClick={() => onPick(i)}
                className={`stand-program-row relative flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl py-2.5 pl-3 pr-3 text-left transition-colors ${
                  current ? 'bg-(--stand-accent-soft)' : 'hover:bg-(--stand-hover) active:bg-(--stand-hover)'
                }`}
              >
                <span
                  className={`w-9 shrink-0 text-right font-mono text-[0.78rem] tracking-wider ${
                    current ? 'text-(--stand-accent)' : 'text-(--stand-muted)'
                  }`}
                >
                  {sameWork ? '' : e.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[0.98rem] font-semibold ${current ? 'text-(--stand-accent)' : 'text-(--stand-ink)'}`}
                  >
                    {e.title}
                  </span>
                  <span className="block truncate font-mono text-[0.62rem] uppercase tracking-[0.14em] text-(--stand-muted)">
                    {e.label}
                    {e.pageCount ? ` · ${e.pageCount} ${e.pageCount === 1 ? 'side' : 'sider'}` : ''}
                  </span>
                </span>
                {current && (
                  <span className="shrink-0 rounded-full border border-(--stand-accent)/50 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-(--stand-accent)">
                    Nå
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </StandSheet>
  )
}

// ---------- Visning ----------

const VIEW_ICONS: Record<StandView, IconName> = { scroll: 'viewScroll', page: 'viewPage', spread: 'viewSpread' }

export function ViewSheet({
  open,
  onClose,
  view,
  views,
  spreadHint,
  onView,
  night,
  onNight,
  listen,
  offline,
  onShare,
  fullscreen,
  onHelp,
}: {
  open: boolean
  onClose: () => void
  view: StandView
  /** Visningene som kan velges på denne skjermen, i rekkefølge. */
  views: StandView[]
  /** Vis «snu iPad-en»-hintet når «To sider» ikke er tilgjengelig. */
  spreadHint: boolean
  onView: (view: StandView) => void
  night: boolean
  onNight: () => void
  /** Lytteeksempler for stykket som vises, om det har noen. */
  listen: { title: string; onOpen: () => void } | null
  offline: {
    saved: { bytes: number } | null
    progress: { done: number; total: number } | null
    count: number
    onToggle: () => void
  } | null
  onShare: (() => void) | null
  fullscreen: { active: boolean; onToggle: () => void } | null
  /** Vis hjelpen for bladingen i visningen man står i. */
  onHelp: () => void
}) {
  return (
    <StandSheet open={open} onClose={onClose} title="Visning">
      <div className="px-2">
        <div role="radiogroup" aria-label="Visning" className="grid gap-1.5 rounded-2xl bg-(--stand-sunken) p-1.5" style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}>
          {views.map((v) => {
            const active = v === view
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onView(v)}
                className={`flex min-h-[68px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[0.78rem] font-medium transition-colors ${
                  active
                    ? 'bg-(--stand-raised-2) text-(--stand-accent) shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_2px_8px_rgba(0,0,0,0.35)]'
                    : 'text-(--stand-ink-soft) hover:text-(--stand-ink)'
                }`}
              >
                <Icon name={VIEW_ICONS[v]} size={24} strokeWidth={1.5} />
                {VIEW_LABELS[v]}
              </button>
            )
          })}
        </div>
        {spreadHint && (
          <p className="mt-2 px-1 text-xs text-(--stand-muted)">Legg iPad-en ned for å se to sider ved siden av hverandre.</p>
        )}
      </div>

      <ul className="mt-4 divide-y divide-(--stand-line) border-y border-(--stand-line)">
        <li>
          <SheetRow
            icon="moon"
            title="Nattlys"
            detail="Lys skrift på mørkt ark, for mørke scener"
            onClick={onNight}
            toggle={night}
          />
        </li>
        {offline && (
          <li>
            <SheetRow
              icon="download"
              title="Tilgjengelig offline"
              detail={
                offline.progress
                  ? `Lagrer ${offline.progress.done} av ${offline.progress.total} …`
                  : offline.saved
                    ? `${offline.count === 1 ? '1 stemme' : `${offline.count} stemmer`} · ${formatBytes(offline.saved.bytes)} på enheten`
                    : 'Bla i notene uten nett, på øvelse og konsert'
              }
              busy={!!offline.progress}
              onClick={offline.onToggle}
              toggle={!!offline.saved}
            />
          </li>
        )}
        {listen && (
          <li>
            <SheetRow icon="playCircle" title="Lytt" detail={`Lytteeksempler for «${listen.title}»`} onClick={listen.onOpen} />
          </li>
        )}
        {onShare && (
          <li>
            <SheetRow icon="share" title="Del eller åpne PDF-en" detail="Lagre i Filer, skriv ut eller send" onClick={onShare} />
          </li>
        )}
        <li>
          <SheetRow
            icon="help"
            title="Vis hjelp for bladingen"
            detail={view === 'scroll' ? 'Rull, sveip og trykk i «Tilpass bredde»' : 'Trykkfeltene og sveip i sidevisningen'}
            onClick={onHelp}
          />
        </li>
        {fullscreen && (
          <li>
            <SheetRow
              icon="fullscreen"
              title={fullscreen.active ? 'Avslutt fullskjerm' : 'Fullskjerm'}
              detail="Skjul nettleserens egne linjer"
              onClick={fullscreen.onToggle}
            />
          </li>
        )}
      </ul>
    </StandSheet>
  )
}

function SheetRow({
  icon,
  title,
  detail,
  onClick,
  toggle,
  busy,
}: {
  icon: IconName
  title: string
  detail: string
  onClick: () => void
  /** Satt: raden er en bryter. */
  toggle?: boolean
  busy?: boolean
}) {
  const isSwitch = toggle !== undefined
  return (
    <button
      type="button"
      role={isSwitch ? 'switch' : undefined}
      aria-checked={isSwitch ? toggle : undefined}
      onClick={onClick}
      disabled={busy}
      className="flex min-h-[60px] w-full cursor-pointer items-center gap-3.5 px-3 py-3 text-left transition-colors hover:bg-(--stand-hover) active:bg-(--stand-hover) disabled:cursor-wait"
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          toggle ? 'bg-(--stand-accent-soft) text-(--stand-accent)' : 'bg-(--stand-sunken) text-(--stand-ink-soft)'
        }`}
      >
        {busy ? <span className="spinner" aria-hidden /> : <Icon name={icon} size={19} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold text-(--stand-ink)">{title}</span>
        <span className="block truncate text-xs text-(--stand-muted)">{detail}</span>
      </span>
      {isSwitch ? (
        <span
          aria-hidden
          className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${toggle ? 'bg-(--stand-accent)' : 'bg-(--stand-line-strong)'}`}
        >
          <span
            className={`absolute top-[3px] h-6 w-6 rounded-full bg-(--stand-ink) shadow transition-transform ${toggle ? 'translate-x-[23px]' : 'translate-x-[3px]'}`}
          />
        </span>
      ) : (
        <Icon name="chevronRight" size={16} className="text-(--stand-muted)" />
      )}
    </button>
  )
}
