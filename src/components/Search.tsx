import { useEffect, useRef, useState } from 'react'
import { highlightParts } from '../lib/post-search'
import { Icon } from './Icons'
import { BottomSheet, SheetAction, SheetActions } from './ui'

/**
 * Byggeklossene til søk og sortering i en liste — delt av veggen
 * (`/beskjeder`) og forumet (`/forum`), så de to søkene ser og oppfører seg
 * likt. Reglene (folding, treff, sortering) er rene funksjoner i
 * src/lib/post-search.ts; her er bare skjermdelene.
 */

/**
 * Tekst i søkefeltet med lokal tilstand, så skrivingen ikke venter på ruteren.
 * `commit` kalles når man tar en pause (og skal legge teksten i URL-en).
 * `pushed` er det vi selv har sendt: en endring vi har lagt i URL-en skal ikke
 * skrive feltet tilbake midt i neste ord — men «Tøm søket», en delt lenke og
 * «tilbake» skal.
 */
export function useSearchText(q: string, commit: (text: string) => void, delay = 250) {
  const [text, setText] = useState(q)
  const pushed = useRef(q)
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q
      setText(q)
    }
  }, [q])
  useEffect(() => {
    if (text === pushed.current) return
    const timer = setTimeout(() => {
      pushed.current = text
      commitRef.current(text)
    }, delay)
    return () => clearTimeout(timer)
  }, [text, delay])

  /** Tøm feltet med en gang; kalleren tømmer URL-en. */
  const reset = () => {
    pushed.current = ''
    setText('')
  }
  return { text, setText, reset }
}

/** Søkefeltet med lupe. Escape tømmer, Enter lukker tastaturet. */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  label,
  maxLength,
}: {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder: string
  /** Tilgjengelig navn — si hva som søkes i. */
  label: string
  maxLength?: number
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <svg
        width="15"
        height="15"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
      >
        <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className="field-input !pl-10"
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onClear()
          }
          // Lukk tastaturet på telefonen — treffene står under.
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}

/**
 * Teksten med søkeordene uthevet (`<mark>`). Uten søkeord er det bare teksten.
 * Posisjonene kommer fra `highlightParts`, som folder tegn én til én — så
 * «Café» i teksten utheves med søket «cafe» uten at noe forskyves.
 */
export function Highlight({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || terms.length === 0) return <>{text}</>
  return (
    <>
      {highlightParts(text, terms).map((part, i) =>
        part.match ? (
          <mark key={i} className="search-mark">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/** «Hvor står treffet»: en etikett og et utdrag med uthevede søkeord. */
export function SearchHitLine({ label, snippet, terms }: { label: string; snippet: string; terms: string[] }) {
  return (
    <span className="search-hit">
      <span className="search-hit-label">{label}</span>
      <span className="block wrap-anywhere">
        <Highlight text={snippet} terms={terms} />
      </span>
    </span>
  )
}

export type SortOption<T extends string> = { value: T; label: string; hint: string }

/**
 * Knappen som åpner sorteringsarket. Messingfarget når sorteringen ikke er
 * standard, så en uvanlig rekkefølge aldri er usynlig.
 */
export function SortButton({
  label,
  isDefault,
  onClick,
  className = '',
}: {
  label: string
  isDefault: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Sortering: ${label}`}
      className={`inline-flex min-h-[2.6rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] border px-3 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${
        isDefault
          ? 'border-line-strong bg-paper-raised text-ink hover:border-brass'
          : 'border-brass bg-[var(--brass-soft)] text-brass-strong'
      } ${className}`}
    >
      <Icon name="sort" size={17} />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  )
}

/** Sorteringsvalgene i et bunnark; et valg gjelder med en gang og lukker arket. */
export function SortSheet<T extends string>({
  open,
  onClose,
  options,
  value,
  onChange,
}: {
  open: boolean
  onClose: () => void
  options: ReadonlyArray<SortOption<T>>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Sorter" closeLabel="Ferdig">
      <SheetActions role="radiogroup">
        {options.map((option) => (
          <SheetAction
            key={option.value}
            role="radio"
            aria-checked={value === option.value}
            label={option.label}
            hint={option.hint}
            onClick={() => {
              onClose()
              if (option.value !== value) onChange(option.value)
            }}
            trailing={value === option.value ? <Icon name="check" size={18} className="text-brass" /> : undefined}
          />
        ))}
      </SheetActions>
    </BottomSheet>
  )
}
