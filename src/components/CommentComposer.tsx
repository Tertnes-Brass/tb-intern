import { useEffect, useId, useRef, useState } from 'react'
import { type MentionUser, findMentionQuery, insertMention, toMarkers } from '../lib/mentions'
import { searchMentionableMembers } from '../server/posts'
import { Button } from './ui'

/**
 * Kommentarfeltet på veggen, med `@`-omtaler (#83).
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
 * og mobiltastatur), og er ikke verdt det for et kommentarfelt.
 *
 * Oversettelsen (`toMarkers`) matcher KUN navn som faktisk er valgt fra lista,
 * lengste navn først, med ordgrense på begge sider og aldri inne i backticks.
 * Skriver noen `@Ola Nordmann` for hånd, blir det stående som ren tekst — og
 * serveren validerer uansett hver markør på nytt før kommentaren lagres.
 *
 * Forslagslista legges OVER feltet: kommentarfeltet ligger nederst i tråden, og
 * på mobil står det rett over tastaturet når det har fokus. Plassen er der oppe.
 */

/** Ventetid før søket sendes. Nok til å skrive ferdig et par bokstaver. */
const SEARCH_DELAY = 140

export function CommentComposer({
  postId,
  onSubmit,
}: {
  postId: string
  /** Kalles med den ferdige teksten (markører, ikke navn). Kaster den, beholdes teksten. */
  onSubmit: (body: string) => Promise<void>
}) {
  const listId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Caret som skal settes etter at React har skrevet den nye verdien. */
  const caretRef = useRef<number | null>(null)

  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  /** Medlemmene som FAKTISK er valgt fra lista — grunnlaget for `toMarkers`. */
  const [chosen, setChosen] = useState<MentionUser[]>([])

  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [suggestions, setSuggestions] = useState<MentionUser[]>([])
  const [active, setActive] = useState(0)
  /** `@`-posisjonen brukeren lukket lista på med Escape. Åpnes ikke igjen for den. */
  const [dismissed, setDismissed] = useState<number | null>(null)

  const open = query !== null && dismissed !== query.start

  /** Leser caret-posisjonen og avgjør om vi står i et `@`-søk. */
  const syncQuery = (value: string, caret: number | null) => {
    const found = caret === null ? null : findMentionQuery(value, caret)
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
  }, [body])

  // Søket. Hvert svar merkes med sin egen forespørsel, slik at et tregt søk
  // aldri overskriver et ferskere.
  useEffect(() => {
    if (!open || !query) {
      setSuggestions([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      searchMentionableMembers({ data: { postId, query: query.query } })
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
  }, [postId, open, query?.start, query?.query])

  const choose = (member: MentionUser) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? body.length
    const next = insertMention(body, caret, member.name)
    setChosen((prev) => [...prev, member])
    setBody(next.body)
    caretRef.current = next.caret
    setQuery(null)
    setSuggestions([])
    setDismissed(null)
  }

  const submit = async () => {
    const text = toMarkers(body, chosen)
    if (!text.trim()) return
    setBusy(true)
    try {
      await onSubmit(text)
      setBody('')
      setChosen([])
      setQuery(null)
      setSuggestions([])
    } catch {
      // Kalleren har allerede vist feilen. Teksten blir stående, så en tapt
      // forbindelse ikke koster skribenten kommentaren.
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(query?.start ?? null)
        return
      }
    }
    if (open && suggestions.length > 0) {
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
    // Enter sender på desktop; skift+enter gir linjeskift. På mobil gjør
    // tastaturets enter linjeskift, og knappen under sender.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="relative flex-1">
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Medlemmer"
            className="sheet absolute bottom-full left-0 z-20 mb-1 max-h-60 w-full overflow-y-auto py-1"
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
          ref={inputRef}
          className="field-input min-h-16 w-full resize-y text-sm"
          value={body}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && suggestions.length > 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setBody(e.target.value)
            syncQuery(e.target.value, e.target.selectionStart)
          }}
          onClick={(e) => syncQuery(body, e.currentTarget.selectionStart)}
          onKeyUp={(e) => {
            // Piltaster flytter caret uten å endre teksten — søket må følge med.
            if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
              syncQuery(body, e.currentTarget.selectionStart)
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
          placeholder="Skriv en kommentar … bruk @ for å nevne noen"
        />
      </div>
      <Button
        type="button"
        variant="primary"
        loading={busy}
        disabled={!body.trim()}
        onClick={() => void submit()}
        className="w-full sm:w-auto"
      >
        Kommenter
      </Button>
    </div>
  )
}
