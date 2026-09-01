import { useEffect, useId, useRef, useState } from 'react'
import { type MentionUser, findMentionQuery, insertMention } from '../lib/mentions'

/**
 * Tekstfeltet med `@`-autofullføring — ett felt, tre bruksteder: kommentarer på
 * veggen (#83), brødteksten i et innlegg og meldingsfeltet i chattene.
 *
 * ## Hvorfor navnet står i feltet, og ikke markøren
 *
 * En `<textarea>` kan bare vise sin egen verdi — det finnes ingen måte å tegne
 * en «chip» inne i den. Valget står mellom å la lagringsmarkøren `@[u:kd9…]`
 * stå synlig mens man skriver, eller å vise `@Navn` og oversette til markører
 * ved innsending. Vi valgte det siste: skribenten skal lese det hen skriver.
 *
 * Alternativet — `contenteditable` med ekte chips — ville gitt et felt som
 * oppfører seg annerledes enn alle andre felt i appen (markør, angre, autokorrekt
 * og mobiltastatur), og er ikke verdt det.
 *
 * ## Hvorfor `chosen` er kallerens tilstand
 *
 * Oversettelsen (`toMarkers`) matcher KUN navn som faktisk er valgt fra lista.
 * Den lista må derfor overleve helt fram til innsending — som skjer hos
 * kalleren, sammen med resten av skjemaet. Komponenten er heleid og kontrollert:
 * den eier ingenting annet enn selve søket, og kan derfor ikke komme i utakt med
 * teksten den skriver i.
 *
 * ## Hva komponenten IKKE gjør
 *
 * Den validerer ingenting. Serveren sjekker hver markør på nytt før teksten
 * lagres — forslagslista er hjelp, ikke sikring (docs/designprinsipper.md §4).
 */

/** Ventetid før søket sendes. Nok til å skrive ferdig et par bokstaver. */
const SEARCH_DELAY = 140

/** Søkefunksjonen kalleren gir: den vet hvem som kan omtales akkurat her. */
export type MentionSearch = (query: string) => Promise<MentionUser[]>

type Props = Omit<React.ComponentPropsWithoutRef<'textarea'>, 'value' | 'onChange' | 'ref'> & {
  value: string
  onChange: (value: string) => void
  /** Medlemmene som er valgt fra lista — grunnlaget for `toMarkers`. */
  chosen: MentionUser[]
  onChosenChange: (chosen: MentionUser[]) => void
  search: MentionSearch
  /**
   * Enter uten skift, når forslagslista er lukket. Satt der Enter sender
   * (kommentarer og chat), utelatt der Enter er et linjeskift (innlegg).
   */
  onEnter?: () => void
  /**
   * Hvor lista legger seg. `above` når feltet står nederst på skjermen
   * (kommentarfeltet og chatten står rett over tastaturet på mobil).
   */
  placement?: 'above' | 'below'
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /**
   * Klasser på boksen rundt feltet. Den må finnes (lista posisjoneres mot den),
   * så et `flex-1` som ellers hadde stått på selve feltet hører hjemme her.
   */
  wrapperClassName?: string
}

export function MentionTextarea({
  value,
  onChange,
  chosen,
  onChosenChange,
  search,
  onEnter,
  placement = 'above',
  textareaRef,
  wrapperClassName = '',
  ...rest
}: Props) {
  const listId = useId()
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = textareaRef ?? ownRef
  /** Caret som skal settes etter at React har skrevet den nye verdien. */
  const caretRef = useRef<number | null>(null)

  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [suggestions, setSuggestions] = useState<MentionUser[]>([])
  const [active, setActive] = useState(0)
  /** `@`-posisjonen brukeren lukket lista på med Escape. Åpnes ikke igjen for den. */
  const [dismissed, setDismissed] = useState<number | null>(null)

  const open = query !== null && dismissed !== query.start

  // `search` er som regel et objektliteral/en pil hos kalleren og ville ellers
  // restartet søket ved hver render. Samme grep som `api` i ChatThread.
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  })

  /** Leser caret-posisjonen og avgjør om vi står i et `@`-søk. */
  const syncQuery = (text: string, caret: number | null) => {
    const found = caret === null ? null : findMentionQuery(text, caret)
    setQuery(found)
    if (found === null) setDismissed(null)
  }

  useEffect(() => {
    if (caretRef.current === null) return
    const el = inputRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(caretRef.current, caretRef.current)
    }
    caretRef.current = null
  }, [value, inputRef])

  // Søket. Hvert svar merkes med sin egen forespørsel, slik at et tregt søk
  // aldri overskriver et ferskere.
  useEffect(() => {
    if (!open || !query) {
      setSuggestions([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      searchRef
        .current(query.query)
        .then((rows) => {
          if (!current) return
          setSuggestions(rows)
          setActive(0)
        })
        .catch(() => {
          if (current) setSuggestions([])
        })
    }, SEARCH_DELAY)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, query?.start, query?.query])

  const choose = (member: MentionUser) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? value.length
    const next = insertMention(value, caret, member.name)
    onChosenChange([...chosen, member])
    onChange(next.body)
    caretRef.current = next.caret
    setQuery(null)
    setSuggestions([])
    setDismissed(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(query?.start ?? null)
        return
      }
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActive((i) => (i + 1) % suggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
          return
        }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          const member = suggestions[active]
          if (member) choose(member)
          return
        }
      }
    }
    // Enter sender på desktop; skift+enter gir linjeskift. På mobil gjør
    // tastaturets enter linjeskift, og knappen under sender.
    if (onEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onEnter()
      return
    }
    rest.onKeyDown?.(e)
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Medlemmer"
          className={`sheet absolute left-0 z-20 max-h-60 w-full overflow-y-auto py-1 ${
            placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {suggestions.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-ink-faint">Ingen medlemmer å nevne her</li>
          ) : (
            suggestions.map((member, i) => (
              <li key={member.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // mousedown, ikke click: feltet skal ikke miste fokus før valget er tatt.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(member)
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault()
                    choose(member)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full cursor-pointer items-center px-3.5 py-2.5 text-left text-sm transition-colors ${
                    i === active ? 'bg-brass-soft text-brass-strong' : 'text-ink-soft hover:bg-paper-sunken'
                  }`}
                >
                  {member.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <textarea
        {...rest}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions.length > 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          syncQuery(e.target.value, e.target.selectionStart)
        }}
        onClick={(e) => {
          syncQuery(value, e.currentTarget.selectionStart)
          rest.onClick?.(e)
        }}
        onKeyUp={(e) => {
          // Piltaster flytter caret uten å endre teksten — søket må følge med.
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
            syncQuery(value, e.currentTarget.selectionStart)
          }
          rest.onKeyUp?.(e)
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          setQuery(null)
          rest.onBlur?.(e)
        }}
      />
    </div>
  )
}
