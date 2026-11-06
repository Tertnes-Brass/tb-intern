/**
 * To små lag over noten på stativet:
 *
 * - `GestureHelp`: hjelpen for bladingen. Vises av seg selv første gang man
 *   bruker en visning (én gang for «Tilpass bredde», én gang for sidevisningene
 *   — `gestureModeOf`), og igjen fra «Visning» → «Vis hjelp for bladingen».
 *   Trykkfeltene tegnes der de faktisk er, så man ser hvor man skal trykke.
 *   Et trykk hvor som helst lukker den; det blar ikke.
 * - `ResumeNotice`: «Fortsatt fra II. Benedictus, side 3 · Fra starten».
 *
 * Tekstene og reglene er rene funksjoner i `src/lib/stand-view.ts` og
 * `src/lib/stand.ts`, testet. Farger fra `--stand-*` (styles.css).
 */
import { useEffect, useId, useRef } from 'react'
import { type GestureMode, gestureHint } from '../../lib/stand-view'
import { Icon, type IconName } from '../Icons'

const ZONE_ICONS: Record<'prev' | 'center' | 'next', IconName> = {
  prev: 'chevronLeft',
  center: 'tap',
  next: 'chevronRight',
}

export function GestureHelp({ mode, onClose }: { mode: GestureMode; onClose: () => void }) {
  const hint = gestureHint(mode)
  const titleId = useId()
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    button.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-no-pull
      className="stand-help fixed inset-0 z-40 flex cursor-pointer flex-col"
      onClick={onClose}
    >
      {/* Trykkfeltene, der de er på noten. */}
      <div className="px-safe pt-safe flex min-h-0 flex-1">
        {hint.zones.map((z, i) => (
          <div
            key={z.zone}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-2 text-center ${
              i > 0 ? 'stand-help-divider' : ''
            }`}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full border border-(--stand-line-strong) bg-(--stand-raised) text-(--stand-accent)">
              <Icon name={ZONE_ICONS[z.zone]} size={24} />
            </span>
            <span className="max-w-[14rem] rounded-full bg-(--stand-raised) px-3 py-1 text-[0.95rem] font-semibold leading-snug text-(--stand-ink)">
              {z.label}
            </span>
          </div>
        ))}
      </div>

      <div className="px-safe flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <div className="stand-pill w-full max-w-md cursor-default rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
          <p id={titleId} className="display-title text-lg font-semibold text-(--stand-ink)">
            Slik blar du
          </p>
          <p className="mt-1 flex items-center gap-2 text-[0.95rem] text-(--stand-ink-soft)">
            <span className="flex shrink-0 text-(--stand-accent)" aria-hidden>
              <Icon name="chevronLeft" size={16} />
              <Icon name="chevronRight" size={16} className="-ml-1.5" />
            </span>
            {hint.swipe}
          </p>
          <p className="mt-1.5 text-sm text-(--stand-muted)">{hint.more}</p>
          <button
            ref={button}
            type="button"
            onClick={onClose}
            className="mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full bg-(--stand-accent) px-5 text-sm font-semibold text-(--stand-bg) transition-transform active:scale-[0.97]"
          >
            Skjønner
          </button>
        </div>
      </div>
    </div>
  )
}

export function ResumeNotice({
  label,
  onRestart,
  onDismiss,
}: {
  label: string
  onRestart: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-30 flex justify-center px-3"
    >
      {/* Tittelen får brekke over to linjer på telefon heller enn å kuttes. */}
      <div className="stand-pill stand-notice pointer-events-auto flex max-w-full items-center gap-1 rounded-[22px] py-1 pl-4 pr-1">
        <span className="line-clamp-2 min-w-0 text-sm leading-snug text-(--stand-ink-soft)">
          Fortsatt fra <span className="font-semibold text-(--stand-ink)">{label}</span>
        </span>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-(--stand-line-strong)" />
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-(--stand-accent) transition-colors hover:bg-(--stand-hover)"
        >
          <Icon name="toStart" size={15} />
          Fra starten
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Lukk"
          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-(--stand-muted) transition-colors hover:text-(--stand-ink)"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
