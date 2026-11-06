import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  EMOJI_CATEGORIES,
  type EmojiCategoryKey,
  type EmojiEntry,
  type EmojiSection,
  MAX_EMOJI_VERSION,
  RECENT_EMOJI_KEY,
  emojiVersionIndex,
  groupEmoji,
  normalizeEmoji,
  parseRecent,
  pushRecent,
  searchEmoji,
} from '../lib/emoji-data'
import { Button } from './ui'

/**
 * Emojivelgeren — innholdet i et panel, ikke panelet selv. To bruksteder:
 * reaksjoner på innlegg og kommentarer, og «Emoji»-fanen i GIF-velgeren, som
 * setter tegnet inn i et tekstfelt. Kalleren eier popoveren, plasseringen,
 * bredden og Escape/lukking; velgeren fyller boksen den står i.
 *
 * ## Hvorfor dataene lastes først her
 *
 * De norske navnene og stikkordene er ~0,5 MB JSON (~80 kB komprimert). De
 * hentes med dynamisk `import()` når velgeren monteres — egen chunk fra vår
 * egen bundel, aldri fra et CDN — og `import.meta.env.SSR`-vakten holder dem
 * ute av Worker-bundelen, som i `pdf-loader.ts`.
 *
 * ## Hvorfor «Nylig brukt» ikke flytter seg mens velgeren er åpen
 *
 * Valget lagres med en gang, men seksjonen viser lista slik den var da
 * velgeren åpnet. Ellers ville hele rutenettet hoppet en rad ned under
 * fingeren første gang man valgte noe, og tegnene byttet plass mens man setter
 * inn flere på rad.
 */

type Props = {
  onPick: (emoji: string) => void
  /** Fokuser søkefeltet ved montering (standard `true`). */
  autoFocus?: boolean
  className?: string
}

type SectionKey = EmojiCategoryKey | 'recent'
type GridSection = { key: SectionKey; label: string; icon: string; emoji: EmojiEntry[] }
type EmojiData = { list: EmojiEntry[]; sections: EmojiSection[]; byEmoji: Map<string, EmojiEntry> }

const RECENT_LABEL = 'Nylig brukt'
const RECENT_ICON = '🕘'

/**
 * Fargeemoji-fontene først. Ellers tegner Schibsted Grotesk tegn den selv har
 * (©, ™, ↔) som svart tekst, og Windows viser flaggene som bokstaver.
 */
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif'

// ---------- Data ----------

let loading: Promise<EmojiData> | null = null
let loaded: EmojiData | null = null

function loadEmojiData(): Promise<EmojiData> {
  if (import.meta.env.SSR) return Promise.reject(new Error('Emojidataene lastes bare i nettleseren'))
  loading ??= Promise.all([import('emojibase-data/nb/compact.json'), import('emojibase-data/versions/emoji.json')])
    .then(([compact, versions]) => {
      const list = normalizeEmoji(compact.default, {
        versions: emojiVersionIndex(versions.default),
        maxVersion: MAX_EMOJI_VERSION,
      })
      loaded = { list, sections: groupEmoji(list), byEmoji: new Map(list.map((e) => [e.emoji, e])) }
      return loaded
    })
    .catch((error: unknown) => {
      // En feilet chunk (nettet var borte) skal kunne prøves på nytt.
      loading = null
      throw error
    })
  return loading
}

/** Start nedlastingen før velgeren åpnes, f.eks. ved hover på reaksjonsknappen. */
export function preloadEmojiData(): void {
  if (import.meta.env.SSR) return
  loadEmojiData().catch(() => {})
}

// localStorage kan kaste (privat modus, blokkerte nettstedsdata). Velgeren
// skal virke like godt uten — da er «Nylig brukt» bare tom.
function readRecent(): string[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_EMOJI_KEY))
  } catch {
    return []
  }
}

function rememberRecent(emoji: string) {
  try {
    // Les på nytt i stedet for å bruke øyeblikksbildet: en annen velger (eller
    // fane) kan ha lagret noe siden denne åpnet.
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(pushRecent(readRecent(), emoji)))
  } catch {
    /* ingen lagring — greit */
  }
}

// ---------- Tastatur ----------

/**
 * Nabotegnet i retningen tasten peker. Opp/ned går etter faktisk plassering på
 * skjermen, ikke indeks: rutenettet har `auto-fill`-kolonner, og
 * seksjonsoverskriftene bryter radene.
 */
function neighbour(container: HTMLElement, from: HTMLButtonElement, key: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-key]'))
  const i = buttons.indexOf(from)
  if (i === -1) return null
  switch (key) {
    case 'ArrowLeft':
      return buttons[i - 1] ?? null
    case 'ArrowRight':
      return buttons[i + 1] ?? null
    case 'Home':
      return buttons[0] ?? null
    case 'End':
      return buttons[buttons.length - 1] ?? null
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = key === 'ArrowDown' ? 1 : -1
      const origin = from.getBoundingClientRect()
      let rowTop: number | null = null
      let best: HTMLButtonElement | null = null
      let bestDistance = Infinity
      for (let j = i + step; j >= 0 && j < buttons.length; j += step) {
        const rect = buttons[j].getBoundingClientRect()
        if (Math.abs(rect.top - origin.top) < 2) continue
        if (rowTop === null) rowTop = rect.top
        else if (Math.abs(rect.top - rowTop) >= 2) break
        const distance = Math.abs(rect.left - origin.left)
        if (distance < bestDistance) {
          best = buttons[j]
          bestDistance = distance
        }
      }
      return best
    }
    default:
      return null
  }
}

// ---------- Rutenettet ----------

/**
 * Knappene har ingen egne handlere: klikk og piltaster fanges av rullefeltet
 * rundt (`data-emoji`/`data-key`). Bare ett tegn er i tab-rekkefølgen
 * (`tabbable`), resten nås med piltastene.
 */
function EmojiButtons({ entries, prefix, tabbable }: { entries: EmojiEntry[]; prefix: string; tabbable: string | null }) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] pointer-coarse:grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]"
      style={{ fontFamily: EMOJI_FONT }}
    >
      {entries.map((entry) => {
        const key = `${prefix}:${entry.emoji}`
        return (
          <button
            key={key}
            type="button"
            data-key={key}
            data-emoji={entry.emoji}
            tabIndex={key === tabbable ? 0 : -1}
            aria-label={entry.label}
            title={entry.label}
            className="grid aspect-square cursor-pointer select-none place-items-center rounded-[9px] text-[1.375rem] leading-none transition-[background-color,transform] duration-100 hover:bg-paper-sunken focus-visible:bg-[var(--brass-soft)] active:scale-90 pointer-coarse:text-[1.6rem]"
          >
            {entry.emoji}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Én kategori. `memo` er hele ytelsesgrepet: ~1 800 knapper tegnes én gang, og
 * et tastetrykk i søkefeltet eller en ny aktiv kategori rører dem ikke.
 */
const GridSectionView = memo(function GridSectionView({
  section,
  headingId,
  tabbable,
}: {
  section: GridSection
  headingId: string
  tabbable: string | null
}) {
  return (
    <section data-section={section.key} aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="sticky top-0 z-10 -mx-2 bg-paper-raised px-3 pb-1.5 pt-2.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint"
      >
        {section.label}
      </h3>
      <EmojiButtons entries={section.emoji} prefix={section.key} tabbable={tabbable} />
    </section>
  )
})

// ---------- Velgeren ----------

export function EmojiPicker({ onPick, autoFocus = true, className = '' }: Props) {
  const baseId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Starter alltid tomt (også når dataene er lastet før): serveren har dem
  // aldri, og første klientrender må stemme med den.
  const [data, setData] = useState<EmojiData | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null)

  // Treffene tegnes etter tastetrykket, ikke i det: feltet skal aldri henge.
  const q = useDeferredValue(query).trim()
  const searching = q !== ''

  // Layout-effekt: er dataene i minnet fra forrige gang, vises rutenettet uten
  // at «Henter emoji …» blinker forbi.
  useLayoutEffect(() => {
    setRecent(readRecent())
    if (loaded) setData(loaded)
  }, [])

  useEffect(() => {
    if (loaded) return
    let current = true
    setFailed(false)
    loadEmojiData().then(
      (result) => current && setData(result),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [attempt])

  useEffect(() => {
    // preventScroll: popoveren er allerede plassert; siden skal ikke hoppe.
    // Kun ved montering — å endre `autoFocus` senere skal ikke stjele fokus.
    if (autoFocus) inputRef.current?.focus({ preventScroll: true })
  }, [])

  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  })

  const pick = useCallback((emoji: string) => {
    rememberRecent(emoji)
    onPickRef.current(emoji)
  }, [])

  const sections = useMemo<GridSection[]>(() => {
    if (!data) return []
    const recentEntries = recent.flatMap((e) => data.byEmoji.get(e) ?? [])
    return recentEntries.length > 0
      ? [{ key: 'recent', label: RECENT_LABEL, icon: RECENT_ICON, emoji: recentEntries }, ...data.sections]
      : data.sections
  }, [data, recent])

  const results = useMemo(() => (data && searching ? searchEmoji(data.list, q) : []), [data, q, searching])

  // Ett tab-stopp per rutenett: det sist fokuserte tegnet, ellers det første.
  const firstGridKey = sections[0] ? `${sections[0].key}:${sections[0].emoji[0]?.emoji}` : null
  const gridTabbable = focusKey && !focusKey.startsWith('search:') ? focusKey : firstGridKey
  const resultsTabbable =
    focusKey?.startsWith('search:') && results.some((r) => `search:${r.emoji}` === focusKey)
      ? focusKey
      : results[0]
        ? `search:${results[0].emoji}`
        : null

  // Nytt søk begynner øverst i treffene.
  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0
  }, [q])

  // ----- Kategoriraden -----

  const scrollToSection = (key: SectionKey) => {
    const grid = gridRef.current
    const target = grid?.querySelector<HTMLElement>(`[data-section="${key}"]`)
    // Rullefeltet er `relative`, så `offsetTop` er avstanden fra toppen av det.
    if (grid && target) grid.scrollTop = target.offsetTop
  }

  // Valgt kategori under et søk: tøm søket først, rull når rutenettet er synlig.
  const pendingSection = useRef<SectionKey | null>(null)
  useLayoutEffect(() => {
    if (searching || !pendingSection.current) return
    scrollToSection(pendingSection.current)
    pendingSection.current = null
  }, [searching])

  const goToSection = (key: SectionKey) => {
    setActiveSection(key)
    if (query !== '') setQuery('')
    if (searching) pendingSection.current = key
    else scrollToSection(key)
  }

  // Hvilken kategori står øverst? Én måling per bilde, ikke per scroll-hendelse.
  const spyFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(spyFrame.current), [])
  const onGridScroll = () => {
    if (spyFrame.current) return
    spyFrame.current = requestAnimationFrame(() => {
      spyFrame.current = 0
      const grid = gridRef.current
      if (!grid) return
      const all = grid.querySelectorAll<HTMLElement>('[data-section]')
      let current: SectionKey | null = null
      // Helt i bunnen når den siste kategorien kanskje aldri toppen.
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2) {
        current = (all[all.length - 1]?.dataset.section as SectionKey | undefined) ?? null
      } else {
        for (const el of all) {
          if (el.offsetTop > grid.scrollTop + 4) break
          current = el.dataset.section as SectionKey
        }
      }
      setActiveSection(current)
    })
  }

  // ----- Hendelser i rutenettet -----

  const onGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-emoji]')
    if (button?.dataset.emoji) pick(button.dataset.emoji)
  }

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const from = e.target
    if (!(from instanceof HTMLButtonElement) || !from.dataset.key) return
    const next = neighbour(e.currentTarget, from, e.key)
    if (next?.dataset.key) {
      e.preventDefault()
      setFocusKey(next.dataset.key)
      next.focus()
    } else if (e.key === 'ArrowUp') {
      // Over første rad ligger søkefeltet.
      e.preventDefault()
      inputRef.current?.focus()
    }
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      const container = resultsRef.current && !resultsRef.current.hidden ? resultsRef.current : gridRef.current
      const target = container?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      if (target) {
        e.preventDefault()
        target.focus()
      }
      return
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      // Søk på det som står i feltet nå, ikke på de utsatte treffene.
      const first = data && query.trim() ? searchEmoji(data.list, query, 1)[0] : undefined
      if (first) {
        e.preventDefault()
        pick(first.emoji)
      }
    }
  }

  const shownActive = searching ? null : (activeSection ?? sections[0]?.key ?? null)
  // Mens dataene lastes står raden der likevel (avslått), så ingenting hopper.
  const navItems: readonly { key: SectionKey; label: string; icon: string }[] = data ? sections : EMOJI_CATEGORIES

  return (
    <div className={`flex h-[340px] w-full min-w-0 flex-col ${className}`}>
      <div className="shrink-0 px-2 pt-2">
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="field-input"
          placeholder="Søk etter emoji"
          aria-label="Søk etter emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <nav aria-label="Emojikategorier" className="flex shrink-0 gap-0.5 border-b border-line px-2 py-1.5">
        {navItems.map((item) => {
          const active = item.key === shownActive
          return (
            <button
              key={item.key}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'true' : undefined}
              disabled={!data}
              onClick={() => goToSection(item.key)}
              style={{ fontFamily: EMOJI_FONT }}
              className={`grid h-8 min-w-0 flex-1 cursor-pointer place-items-center rounded-[9px] text-[1.05rem] leading-none transition-[background-color,opacity,filter] duration-150 disabled:pointer-events-none pointer-coarse:h-10 ${
                active ? 'bg-[var(--brass-soft)]' : 'opacity-60 grayscale hover:bg-paper-sunken hover:opacity-100 hover:grayscale-0'
              }`}
            >
              {item.icon}
            </button>
          )
        })}
      </nav>

      {!data ? (
        <div role="status" className="grid min-h-0 flex-1 place-items-center px-4 text-center text-sm text-ink-faint">
          {failed ? (
            <div className="space-y-2">
              <p>Fikk ikke hentet emoji.</p>
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Prøv igjen
              </Button>
            </div>
          ) : (
            <p>Henter emoji …</p>
          )}
        </div>
      ) : (
        <>
          <div
            ref={gridRef}
            hidden={searching}
            onScroll={onGridScroll}
            onClick={onGridClick}
            onKeyDown={onGridKeyDown}
            // scroll-pt: et tegn som får fokus med piltastene skal ikke havne
            // under den klebrige overskriften.
            className="relative min-h-0 flex-1 scroll-pt-8 overflow-y-auto overscroll-contain px-2 pb-2"
          >
            {sections.map((section) => (
              <GridSectionView
                key={section.key}
                section={section}
                headingId={`${baseId}-${section.key}`}
                tabbable={gridTabbable?.startsWith(`${section.key}:`) ? gridTabbable : null}
              />
            ))}
          </div>

          <div
            ref={resultsRef}
            hidden={!searching}
            onClick={onGridClick}
            onKeyDown={onGridKeyDown}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-2"
          >
            {results.length > 0 ? (
              <EmojiButtons entries={results} prefix="search" tabbable={resultsTabbable} />
            ) : (
              searching && <p className="px-2 py-6 text-center text-sm text-ink-faint">Ingen emoji passer «{q}».</p>
            )}
          </div>

          <p className="sr-only" aria-live="polite">
            {searching ? (results.length > 0 ? `${results.length} treff` : 'Ingen treff') : ''}
          </p>
        </>
      )}
    </div>
  )
}
