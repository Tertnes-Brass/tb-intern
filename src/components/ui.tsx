import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'

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

// Med finger (pointer: coarse) får ALLE knapper minst 44 px høyde — Apples og
// Googles minstemål for et trykkmål, også `sm` (den var 40 px, og på iPad er
// det ikke færre fingre enn på telefon). Med mus beholdes den kompakte høyden.
const btnSizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs px-2.5 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-3.5 pointer-coarse:text-[0.8rem]',
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
  wrap = false,
  className = '',
  title,
  children,
}: {
  tone?: 'neutral' | 'brass' | 'oxblood'
  /** Fritekst som kan bli lang (adresse, prosjektnavn): brytes i stedet for å gå ut over skjermen. */
  wrap?: boolean
  className?: string
  /** Valgfri forklaring på hover — for stempler som er et begrep, ikke en etikett. */
  title?: string
  children: ReactNode
}) {
  const toneClass = tone === 'brass' ? 'stamp-brass' : tone === 'oxblood' ? 'stamp-oxblood' : ''
  return (
    <span className={`stamp ${toneClass} ${wrap ? 'stamp-wrap' : ''} ${className}`} title={title}>
      {children}
    </span>
  )
}

// ---------- Typografi ----------

/**
 * Pila i tilbakelenkene øverst på en detaljside (`.back-link` i styles.css):
 * en chevron som i iOS, ikke et tekst-«←», så den kan vokse med lenken på
 * berøringsskjerm.
 */
export function BackArrow() {
  return (
    <svg width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden className="back-link-arrow shrink-0">
      <path d="M7.5 1.5 1.5 7.5l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`kicker ${className}`}>{children}</p>
}

/**
 * Sidehodet på en arbeidsflate (Veggen, Forum, Noter, Styre …): én tittel, én
 * valgfri linje forklaring og én primærhandling på linje med tittelen. Kompakt
 * med vilje — innholdet skal begynne innenfor første skjerm på telefonen.
 * Identitetssider (en hendelse, et prosjekt, et innlegg) har egne, større
 * titler; dette er for oversiktene.
 */
export function PageHeader({
  kicker,
  title,
  summary,
  action,
  children,
  className = '',
}: {
  kicker?: ReactNode
  title: ReactNode
  /** Én kort linje. Lengre forklaringer hører hjemme i en tomtilstand eller et hjelpeark. */
  summary?: ReactNode
  /** Primærhandlingen, høyrestilt på linje med tittelen. */
  action?: ReactNode
  /** Filtre, faner o.l. under tittelen. */
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={`page-header ${className}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && <Kicker className="mb-1.5">{kicker}</Kicker>}
          <h1 className="display-title text-[2rem] font-semibold italic leading-[1.05] text-ink sm:text-[2.5rem]">{title}</h1>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {summary && <p className="mt-1.5 max-w-xl text-sm leading-snug text-ink-soft">{summary}</p>}
      {children && <div className="mt-4">{children}</div>}
    </header>
  )
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

// ---------- Ark og dialoger: ett mønster ----------
//
// Alle ark (BottomSheet, Modal på telefon, ActionMenu på berøring) har samme
// anatomi, så man aldri må lete etter hvordan man kommer seg ut:
//
//   grep (dra ned)            — bunnark, og Modal der den er et bunnark
//   SheetHeader               — tittel til venstre (+ valgfri kicker/undertekst),
//                               lukkeknapp til høyre: 44 pt «×», eller en
//                               tekstknapp («Ferdig») der arkets valg gjelder
//                               med en gang (filtre, «Meg og mer»)
//   kropp                     — det eneste som ruller
//   footer                    — valgfri, festet nederst over hjem-indikatoren:
//                               arkets primærhandling («Vis 10 verk»)
//
// Handlingsrader (`SheetActions`/`SheetAction`/`SheetActionSeparator`) er de
// samme i ActionMenu, chatten og «Meg og mer»: ikon + etikett (+ én linje
// forklaring), 52 pt høye i et ark, ødeleggende valg i `--danger` nederst etter
// en skillelinje.

type SheetHeaderProps = {
  /** id til overskriften, så dialogen kan peke på den (`aria-labelledby`). */
  titleId?: string
  title: ReactNode
  kicker?: ReactNode
  /** Én linje under tittelen (hvilket innlegg, hvilken hendelse …). */
  subtitle?: ReactNode
  onClose: () => void
  /**
   * Tekst på lukkeknappen («Ferdig»). Uten den er det en rund «×» med
   * «Lukk» som tilgjengelig navn.
   */
  closeLabel?: string
}

export function SheetHeader({ titleId, title, kicker, subtitle, onClose, closeLabel }: SheetHeaderProps) {
  return (
    <div className="sheet-head-row">
      <div className="min-w-0 flex-1">
        {kicker && <Kicker className="mb-1">{kicker}</Kicker>}
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
      </div>
      {closeLabel ? (
        <button type="button" onClick={onClose} className="sheet-close-text">
          {closeLabel}
        </button>
      ) : (
        <button type="button" onClick={onClose} aria-label="Lukk" className="sheet-close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** En gruppe handlingsrader (se `SheetAction`). */
export function SheetActions({
  children,
  role,
  className = '',
}: {
  children: ReactNode
  /** `menu` når radene er en meny (ActionMenu). */
  role?: string
  className?: string
}) {
  return (
    <div role={role} className={`sheet-actions ${className}`}>
      {children}
    </div>
  )
}

/** Skillet før de ødeleggende radene. */
export function SheetActionSeparator() {
  return <div role="separator" className="sheet-actions-sep" />
}

/**
 * Én handlingsrad: ikon + etikett, valgfri forklaringslinje og noe til høyre
 * (en verdi, en chevron). 52 pt høy i et ark; `tone="danger"` for det som ikke
 * kan angres. For en lenke-rad: gi `<Link>` klassen `sheet-action`.
 */
export function SheetAction({
  icon,
  label,
  hint,
  tone,
  trailing,
  className = '',
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  tone?: 'danger'
  trailing?: ReactNode
}) {
  return (
    <button type={type} className={`sheet-action ${tone === 'danger' ? 'sheet-action-danger' : ''} ${className}`} {...rest}>
      {icon && <span className="sheet-action-icon">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="sheet-action-hint">{hint}</span>}
      </span>
      {trailing}
    </button>
  )
}

// ---------- Dialog ----------

export function Modal({
  open,
  onClose,
  title,
  kicker,
  subtitle,
  footer,
  closeLabel,
  children,
  wide,
  mobileFull,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  kicker?: string
  subtitle?: ReactNode
  /** Festet nederst, under den rullende kroppen (primærhandlingen). */
  footer?: ReactNode
  /** Se `SheetHeader`. */
  closeLabel?: string
  children: ReactNode
  wide?: boolean
  mobileFull?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useDialogOpen(ref, open)
  // På telefon er dialogen et bunnark (styles.css), og overskriften er grepet.
  const drag = useSheetDrag(ref, onClose)

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`sheet-dialog ${wide ? 'sheet-dialog-wide' : ''} ${mobileFull ? 'sheet-dialog-mobile-full' : ''} ${footer ? 'has-footer' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        // klikk på backdrop lukker
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="sheet-head sheet-head-modal" {...drag}>
        <span className="sheet-grab sheet-grab-phone" aria-hidden />
        <SheetHeader titleId={titleId} title={title} kicker={kicker} subtitle={subtitle} onClose={onClose} closeLabel={closeLabel} />
      </div>
      {/* flex-auto (ikke flex-1): flex-basis 0 % blir 0 px i WebKit på iPhone/
          iPad, som regner dialogens høyde som bestemt. Med overflow-y: auto er
          minimumshøyden også 0, så kroppen kollapset til bare padding. */}
      <div className="sheet-body sheet-body-modal">{children}</div>
      {footer && <div className="sheet-footer">{footer}</div>}
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
 *
 * Gi `title` (og eventuelt `kicker`/`subtitle`/`closeLabel`) for den felles
 * overskriften med synlig lukkeknapp — det er normalen. `header` er den gamle
 * frie overskriften og brukes bare når `title` mangler.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  title,
  kicker,
  subtitle,
  closeLabel,
  header,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Tilgjengelig navn. Valgfritt med `title` (da peker dialogen på tittelen). */
  label?: string
  title?: ReactNode
  kicker?: ReactNode
  subtitle?: ReactNode
  /** Se `SheetHeader`: «Ferdig» der valgene i arket gjelder med en gang. */
  closeLabel?: string
  /** Fri overskrift (eldre bruk) — ignoreres når `title` er gitt. */
  header?: ReactNode
  /** Festet nederst, over hjem-indikatoren; kroppen ruller over den. */
  footer?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useDialogOpen(ref, open)
  const drag = useSheetDrag(ref, onClose)

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={title ? undefined : label}
      aria-labelledby={title ? titleId : undefined}
      className={`sheet-dialog sheet-dialog-bottom ${footer ? 'has-footer' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="sheet-head sheet-head-bottom" {...drag}>
        <span className="sheet-grab" aria-hidden />
        {title ? (
          <SheetHeader
            titleId={titleId}
            title={title}
            kicker={kicker}
            subtitle={subtitle}
            onClose={onClose}
            closeLabel={closeLabel}
          />
        ) : (
          header
        )}
      </div>
      <div className="sheet-body">{children}</div>
      {footer && <div className="sheet-footer">{footer}</div>}
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

// ---------- Lenke som ser ut som en knapp ----------

/**
 * Klassene til `Button`, for en `<Link>` som er en handling («Skriv innlegg»,
 * «Start en tråd»). En `<Link>` rundt en `<Button>` er en knapp inni en lenke —
 * to trykkmål i ett, og ugyldig HTML.
 */
export function buttonClass(variant: NonNullable<ButtonProps['variant']> = 'secondary', size: NonNullable<ButtonProps['size']> = 'md') {
  return `${btnBase} ${btnVariants[variant]} ${btnSizes[size]} no-underline`
}
