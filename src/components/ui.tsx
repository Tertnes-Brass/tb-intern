import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

// ---------- Knapper ----------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}

const btnBase =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-[9px] transition-all duration-150 ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap cursor-pointer ' +
  'active:translate-y-px'

const btnVariants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-brass text-paper-raised hover:bg-brass-strong shadow-[0_1px_2px_rgba(43,34,16,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] dark:text-paper',
  secondary:
    'border border-line-strong text-ink bg-paper-raised hover:border-brass hover:text-brass-strong',
  ghost: 'text-ink-soft hover:text-ink hover:bg-paper-sunken',
  danger: 'border border-danger/40 text-danger bg-transparent hover:bg-danger/10',
}

// Med finger (pointer: coarse) får knappene minst 40/44 px høyde — Apples og
// Googles minstemål for et trykkmål. Med mus beholdes den kompakte høyden.
const btnSizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs px-2.5 py-1.5 pointer-coarse:min-h-10 pointer-coarse:px-3.5 pointer-coarse:text-[0.8rem]',
  md: 'text-sm px-4 py-2 pointer-coarse:min-h-11',
}

export function Button({ variant = 'secondary', size = 'md', loading, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  )
}

// ---------- Stempler ----------

export function Stamp({
  tone = 'neutral',
  className = '',
  title,
  children,
}: {
  tone?: 'neutral' | 'brass' | 'oxblood'
  className?: string
  /** Valgfri forklaring på hover — for stempler som er et begrep, ikke en etikett. */
  title?: string
  children: ReactNode
}) {
  const toneClass = tone === 'brass' ? 'stamp-brass' : tone === 'oxblood' ? 'stamp-oxblood' : ''
  return (
    <span className={`stamp ${toneClass} ${className}`} title={title}>
      {children}
    </span>
  )
}

// ---------- Typografi ----------

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`kicker ${className}`}>{children}</p>
}

export function SectionHeading({
  kicker,
  title,
  action,
  className = '',
}: {
  kicker?: string
  title: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div>
        {kicker && <Kicker className="mb-1.5">{kicker}</Kicker>}
        <h2 className="display-title text-2xl font-semibold text-ink sm:text-[1.7rem]">{title}</h2>
      </div>
      {action}
    </div>
  )
}

// ---------- Skjema ----------

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  )
}

// ---------- Dialog ----------

export function Modal({
  open,
  onClose,
  title,
  kicker,
  children,
  wide,
  mobileFull,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  kicker?: string
  children: ReactNode
  wide?: boolean
  mobileFull?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useDialogOpen(ref, open)
  // På telefon er dialogen et bunnark (styles.css), og overskriften er grepet.
  const drag = useSheetDrag(ref, onClose)

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`sheet-dialog ${wide ? 'sheet-dialog-wide' : ''} ${mobileFull ? 'sheet-dialog-mobile-full' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        // klikk på backdrop lukker
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="shrink-0 px-6 pt-5 max-sm:touch-none max-sm:pt-2.5 sm:px-7" {...drag}>
        <span className="sheet-grab sheet-grab-phone" aria-hidden />
        {kicker && <Kicker className="mb-1">{kicker}</Kicker>}
        <div className="flex items-start justify-between gap-4">
          <h2 className="display-title text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Lukk"
            className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink active:scale-95 pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {/* flex-auto (ikke flex-1): flex-basis 0 % blir 0 px i WebKit på iPhone/
          iPad, som regner dialogens høyde som bestemt. Med overflow-y: auto er
          minimumshøyden også 0, så kroppen kollapset til bare padding. */}
      <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-6 pb-6 pt-4 sm:px-7">{children}</div>
    </dialog>
  )
}

// ---------- Bunnark (bottom sheet) ----------

/** Åpner og lukker en native `<dialog>` i takt med `open`. */
function useDialogOpen(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.style.transform = ''
      // Fokus på selve dialogen, ikke på første knapp: det er «Lukk» øverst, og
      // Safari tegner en fokusring rundt den i det arket åpnes. Skjermleseren
      // starter da på dialogens navn, og Tab går videre til første felt.
      dlg.setAttribute('autofocus', '')
      dlg.showModal()
    }
    if (!open && dlg.open) dlg.close()
  }, [open, ref])
}

/**
 * Dra ned for å lukke. Kobles på grepet øverst i arket (og overskriften): arket
 * følger fingeren, og slippes det mer enn ~90 px ned — eller med fart — lukkes
 * det. Ellers glir det tilbake. Bare berøring og penn; med mus er det
 * Lukk-knappen og Esc som gjelder.
 */
export function useSheetDrag(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const start = useRef<{ y: number; t: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    // Knapper og lenker i overskriften skal fortsatt kunne trykkes.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    start.current = { y: e.clientY, t: performance.now() }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (ref.current) ref.current.style.transition = 'none'
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || !ref.current) return
    const dy = Math.max(0, e.clientY - start.current.y)
    ref.current.style.transform = `translateY(${dy}px)`
  }
  const finish = (e: React.PointerEvent) => {
    const from = start.current
    const dlg = ref.current
    start.current = null
    if (!from || !dlg) return
    const dy = Math.max(0, e.clientY - from.y)
    const velocity = dy / Math.max(1, performance.now() - from.t)
    dlg.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.65, 0.25, 1)'
    if (dy > 90 || (dy > 24 && velocity > 0.6)) {
      dlg.style.transform = 'translateY(100%)'
      window.setTimeout(() => {
        onClose()
        // Noen dialoger nekter å lukkes mens de jobber (onClose gjør ingenting).
        // Da skal arket tilbake på plass, ikke bli liggende usynlig og modalt.
        window.setTimeout(() => {
          if (dlg.open) dlg.style.transform = ''
        }, 80)
      }, 160)
    } else {
      dlg.style.transform = ''
    }
  }
  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish }
}

/**
 * Ark som glir opp fra bunnen — innenfor tommelens rekkevidde. Brukes der en
 * handling hører til telefonen (f.eks. «Meg og mer» og «Kan ikke komme»). På
 * bredere skjermer står det sentrert nederst, med samme oppførsel.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  header,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Tilgjengelig navn når overskriften ikke er en vanlig tittel. */
  label: string
  header?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useDialogOpen(ref, open)
  const drag = useSheetDrag(ref, onClose)

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      className="sheet-dialog sheet-dialog-bottom"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="shrink-0 touch-none select-none px-5 pt-2.5" {...drag}>
        <span className="sheet-grab" aria-hidden />
        {header}
      </div>
      <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{children}</div>
    </dialog>
  )
}

// ---------- Tomtilstand ----------

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="fadein flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="staff-rule w-36 opacity-60" aria-hidden />
      <p className="display-title text-lg font-semibold text-ink">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ---------- Avatar ----------

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('')
  const cls = size === 'sm' ? 'h-7 w-7 text-[0.6rem]' : 'h-9 w-9 text-xs'
  return (
    <span
      aria-hidden
      className={`${cls} grid shrink-0 place-items-center rounded-full border border-brass/40 bg-[var(--brass-soft)] font-mono font-semibold tracking-wide text-brass-strong`}
    >
      {initials}
    </span>
  )
}
