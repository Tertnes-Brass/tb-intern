import { useId, type ReactNode } from 'react'

/**
 * Skriveflaten — felles ramme for «Nytt innlegg», «Rediger innlegg» og «Ny
 * tråd» i forumet. Laget som en app-skriver (Mail, Notater), ikke som et
 * skjema:
 *
 * - **Linjen øverst** (`ComposerBar`) er «Avbryt · Tittel · Publiser». Den står
 *   klistret rett under toppmenyen (`.composer-bar` i styles.css), så
 *   hovedhandlingen alltid er innen rekkevidde — før lå «Publiser» under
 *   vedlegg, målgruppe, viktighet, avsender og varsling.
 * - **Skrivefeltet først** (`ComposerLayout`, `main`): overskrift og tekst, så
 *   en verktøylinje for bilder og vedlegg.
 * - **Valgene** (`side`) er en egen spalte på ~280 px ved siden av teksten fra
 *   768 px (iPad), og et sammenleggbart «Valg» på telefon. Det er ren
 *   presentasjon: hva som vises for hvem avgjøres av kalleren, og serveren
 *   håndhever det uansett (`sanitizePostInput`).
 */

export function ComposerBar({
  cancel,
  title,
  actions,
  status,
}: {
  /** «Avbryt» — en lenke tilbake dit man kom fra. */
  cancel: ReactNode
  title: ReactNode
  /** Lagre/Publiser. Primærknappen står sist, ytterst til høyre. */
  actions: ReactNode
  /** En liten linje under tittelen, f.eks. «Lagret på enheten». */
  status?: ReactNode
}) {
  return (
    <div className="composer-bar">
      <div className="composer-bar-inner">
        <div className="flex shrink-0 justify-start">{cancel}</div>
        <div className="relative min-w-0 flex-1 text-center">
          <h1 className="truncate text-[0.95rem] font-semibold leading-tight text-ink">{title}</h1>
          {/* Hengt under tittelen (absolutt), så tittelen ikke flytter seg når statusen dukker opp. */}
          <p className="composer-status" aria-live="polite">
            {status}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">{actions}</div>
      </div>
    </div>
  )
}

export function ComposerLayout({
  main,
  side,
  sideOpen = true,
  sideLabel = 'Valg',
}: {
  main: ReactNode
  side?: ReactNode
  /** Bare telefon: «Valg» er lagt sammen til man åpner det. Fra 768 px vises spalten alltid. */
  sideOpen?: boolean
  sideLabel?: string
}) {
  return (
    <div className={`composer-layout ${side ? 'composer-layout-split' : ''}`}>
      <div className="min-w-0">{main}</div>
      {side && (
        <aside id="composer-valg" className={`composer-side ${sideOpen ? '' : 'max-md:hidden'}`} aria-label={sideLabel}>
          {side}
        </aside>
      )}
    </div>
  )
}

/**
 * Overskriften i skrivefeltet: stor, uten ramme, som emnelinjen i en e-post.
 * Etiketten er skjult visuelt, men koblet til feltet med `htmlFor`.
 */
export function ComposerTitle({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="composer-title-wrap">
      <label htmlFor={rest.id ?? id} className="sr-only">
        {label}
      </label>
      <input id={id} className="composer-title" autoComplete="off" {...rest} />
    </div>
  )
}

/** En knapp i verktøylinjen under teksten (Bilder, Vedlegg, Valg). */
export function ToolButton({
  icon,
  children,
  active = false,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={`tool-button ${active ? 'is-active' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Segmentert valg (radioknapper) — for valg med to-tre faste alternativer, der
 * en nedtrekksliste skjuler hva man kan velge mellom.
 */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string
  name: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  hint?: ReactNode
}) {
  const hintId = useId()
  return (
    <fieldset className="min-w-0" aria-describedby={hint ? hintId : undefined}>
      <legend className="composer-label">{legend}</legend>
      <div className="segmented" role="presentation">
        {options.map((option) => (
          <label key={option.value} className={`segmented-option ${value === option.value ? 'is-on' : ''}`}>
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-snug text-ink-faint">
          {hint}
        </p>
      )}
    </fieldset>
  )
}

/** Små tegn for skriveflaten og veggen (Icons.tsx har dem ikke). */
export function Glyph({ name, size = 18 }: { name: 'image' | 'clip' | 'options' | 'chevron' | 'send' | 'more' | 'comment' | 'eye' | 'pencil'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    image: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m20.5 16-4.8-4.6L8 19" />
      </>
    ),
    clip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
    options: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    send: <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />,
    more: (
      <>
        <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
      </>
    ),
    comment: <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z" />,
    eye: (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </>
    ),
    pencil: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {paths[name]}
    </svg>
  )
}
