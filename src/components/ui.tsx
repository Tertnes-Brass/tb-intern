import { useEffect, useRef, type ReactNode } from 'react'

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

const btnSizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs px-2.5 py-1.5',
  md: 'text-sm px-4 py-2',
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

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`sheet-dialog ${wide ? 'sheet-dialog-wide' : ''} ${mobileFull ? 'sheet-dialog-mobile-full' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        // klikk på backdrop lukker
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="shrink-0 px-6 pt-5 sm:px-7">
        {kicker && <Kicker className="mb-1">{kicker}</Kicker>}
        <div className="flex items-start justify-between gap-4">
          <h2 className="display-title text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Lukk"
            className="-mr-2 -mt-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4 sm:px-7">{children}</div>
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
