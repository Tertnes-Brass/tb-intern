/**
 * Segmentert kontroll — to til fire gjensidig utelukkende valg på én linje
 * (Alle · Mine, Alle · Kommende · Tidligere, På · Av). Erstatter rekker med
 * primær/sekundær-knapper og nedtrekkslister der valgene er få og korte.
 * 44 pt høy på berøringsskjerm, kompakt med mus.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = '',
  stretch,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  /** Tilgjengelig navn for gruppen. */
  label: string
  disabled?: boolean
  className?: string
  /** Fyll bredden (lik bredde per valg). */
  stretch?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`segmented ${stretch ? 'segmented-stretch' : ''} ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
          className="segmented-option"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
