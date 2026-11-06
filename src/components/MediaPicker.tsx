import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KlipyCategory, KlipyConfig, KlipyItem } from '../lib/klipy'
import { type KlipyFeed, fetchKlipyCategories, fetchKlipyItems, loadKlipyConfig, triggerKlipyShare } from '../lib/klipy-client'
import type { ExternalMediaKind, MessageMediaItem } from '../lib/message-media'
import { addKlipyMedia } from '../server/klipy'
import { EmojiPicker } from './EmojiPicker'
import { Icon } from './Icons'
import { MediaButton, type MediaDraft } from './MessageMedia'
import { Popover } from './Popover'
import { toastError } from './toast'

/**
 * GIF-velgeren, som i Discord: faner for GIF-er, stickers, memes og emoji, søk,
 * «Trending», «Nylig brukt» og kategorier — med innhold fra KLIPY.
 *
 * Søk og visning går rett fra nettleseren til KLIPY (vilkåret deres, se
 * src/lib/klipy.ts). Søkefeltet heter «Search KLIPY» fordi KLIPY krever det, og
 * treffene vises i KLIPYs rekkefølge. Et valg blir et utkast hos oss
 * (`addKlipyMedia`), og sendes med meldingen som et vanlig bilde.
 */

export type PickerTab = ExternalMediaKind | 'emoji'

const TAB_LABEL: Record<PickerTab, string> = { gif: 'GIF-er', sticker: 'Stickers', meme: 'Memes', emoji: 'Emoji' }
const KIND_WORD: Record<ExternalMediaKind, string> = { gif: 'GIF', sticker: 'sticker', meme: 'meme' }

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return match
}

type ConfigState = { status: 'loading' } | { status: 'off' } | { status: 'error' } | { status: 'ready'; config: KlipyConfig }

function useKlipyConfig(): [ConfigState, () => void] {
  const [state, setState] = useState<ConfigState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    loadKlipyConfig().then(
      (config) => alive && setState(config ? { status: 'ready', config } : { status: 'off' }),
      () => alive && setState({ status: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [attempt])
  return [state, () => setAttempt((n) => n + 1)]
}

/** Panelet. Eieren (`PickerButton`) har popoveren og det som skjer etter et valg. */
export function MediaPicker({
  initialTab = 'gif',
  onPickMedia,
  onPickEmoji,
  busy = false,
}: {
  initialTab?: PickerTab
  onPickMedia: (item: KlipyItem, config: KlipyConfig, query: string) => void
  /** Uten denne vises ikke Emoji-fanen (der det ikke finnes et tekstfelt å sette inn i). */
  onPickEmoji?: (emoji: string) => void
  busy?: boolean
}) {
  const [tab, setTab] = useState<PickerTab>(initialTab)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<{ feed: KlipyFeed; title: string } | null>(null)
  const [config, retry] = useKlipyConfig()
  const coarse = useMedia('(pointer: coarse)')
  const tabs: PickerTab[] = onPickEmoji ? ['gif', 'sticker', 'meme', 'emoji'] : ['gif', 'sticker', 'meme']

  // Søket venter til man har skrevet ferdig et ord eller to.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query])

  // Samme objekt så lenge søket/visningen er den samme — ellers ville hver
  // tegning (hvert tastetrykk, hvert valg) hentet første side på nytt.
  const feed = useMemo<KlipyFeed | null>(() => (search ? { op: 'search', q: search } : (view?.feed ?? null)), [search, view])
  const scroller = useRef<HTMLDivElement>(null)
  const title = search ? `«${search}»` : (view?.title ?? '')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Hva vil du sette inn?" className="flex shrink-0 gap-1 px-3 pt-3">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t)
              setView(null)
            }}
            className={`cursor-pointer rounded-[7px] px-2.5 py-1 text-[0.8rem] font-semibold transition-colors ${
              tab === t ? 'bg-[var(--brass-soft)] text-brass-strong' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'emoji' && onPickEmoji ? (
        <EmojiPicker onPick={onPickEmoji} autoFocus={!coarse} className="min-h-0 flex-1" />
      ) : (
        <>
          <div className="relative shrink-0 px-3 pt-2.5 pb-2">
            <span className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 pt-0.5 text-ink-faint" aria-hidden>
              <Icon name="search" size={15} />
            </span>
            <input
              type="search"
              // KLIPY krever nettopp denne plassholderen (docs.klipy.com/attribution).
              placeholder="Search KLIPY"
              aria-label={`Søk etter ${KIND_WORD[tab as ExternalMediaKind]} hos KLIPY`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={!coarse}
              enterKeyHint="search"
              className="field-input w-full !py-1.5 !pl-8 text-sm"
            />
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
            {config.status === 'loading' && <Skeleton />}
            {config.status === 'off' && (
              <p className="px-1 py-6 text-center text-sm text-ink-soft">
                GIF-søket er ikke slått på ennå.
                <br />
                <span className="text-ink-faint">Du kan fortsatt legge ved egne bilder og GIF-er med bildeknappen.</span>
              </p>
            )}
            {config.status === 'error' && <Failed onRetry={retry} />}
            {config.status === 'ready' &&
              (feed ? (
                <Feed
                  key={`${tab}:${JSON.stringify(feed)}`}
                  config={config.config}
                  kind={tab as ExternalMediaKind}
                  feed={feed}
                  title={title}
                  onBack={search ? () => setQuery('') : () => setView(null)}
                  busy={busy}
                  scroller={scroller}
                  onPick={(item) => onPickMedia(item, config.config, search)}
                />
              ) : (
                <Home key={tab} config={config.config} kind={tab as ExternalMediaKind} onOpen={setView} />
              ))}
          </div>
          <p className="shrink-0 border-t border-line px-3 py-1.5 text-right font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-faint">
            Powered by KLIPY
          </p>
        </>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-1.5" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-[8px] bg-paper-sunken" />
      ))}
    </div>
  )
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-1 py-6 text-center text-sm text-ink-soft">
      <p>Fikk ikke kontakt med KLIPY.</p>
      <button type="button" onClick={onRetry} className="link-brass mt-1 cursor-pointer text-sm">
        Prøv igjen
      </button>
    </div>
  )
}

/**
 * Startsiden i en fane: «Trending», «Nylig brukt» og KLIPYs kategorier som
 * fliser med en forhåndsvisning bak, som i Discord.
 */
function Home({ config, kind, onOpen }: { config: KlipyConfig; kind: ExternalMediaKind; onOpen: (view: { feed: KlipyFeed; title: string }) => void }) {
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; trending: KlipyItem | null; recent: KlipyItem | null; categories: KlipyCategory[] }
  >({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    Promise.all([
      fetchKlipyItems(config, kind, { op: 'trending' }, 1, ctrl.signal),
      // «Nylig brukt» er et tillegg — feiler det, vises bare resten.
      fetchKlipyItems(config, kind, { op: 'recent' }, 1, ctrl.signal).catch(() => ({ items: [] as KlipyItem[], hasNext: false })),
      fetchKlipyCategories(config, kind).catch(() => [] as KlipyCategory[]),
    ]).then(
      ([trending, recent, categories]) =>
        !ctrl.signal.aborted && setState({ status: 'ready', trending: trending.items[0] ?? null, recent: recent.items[0] ?? null, categories }),
      () => !ctrl.signal.aborted && setState({ status: 'error' }),
    )
    return () => ctrl.abort()
  }, [config, kind, attempt])

  if (state.status === 'loading') return <Skeleton />
  if (state.status === 'error') return <Failed onRetry={() => setAttempt((n) => n + 1)} />
  const still = (item: KlipyItem | null) => (item ? (reduced ? (item.still?.url ?? null) : item.preview.url) : null)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {state.recent && <Tile label="Nylig brukt" image={still(state.recent)} onClick={() => onOpen({ feed: { op: 'recent' }, title: 'Nylig brukt' })} />}
      <Tile label="Trending" image={still(state.trending)} onClick={() => onOpen({ feed: { op: 'trending' }, title: 'Trending' })} />
      {state.categories.map((c) => (
        <Tile
          key={c.query}
          label={c.label}
          // Kategoribildene er GIF-er uten stillbilde: ved redusert bevegelse vises bare navnet.
          image={reduced ? null : c.previewUrl}
          onClick={() => onOpen({ feed: { op: 'search', q: c.query }, title: c.label })}
        />
      ))}
    </div>
  )
}

function Tile({ label, image, onClick }: { label: string; image: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-20 cursor-pointer overflow-hidden rounded-[8px] bg-[var(--brass-soft)] text-left"
    >
      {image && (
        <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className={`absolute inset-0 ${image ? 'bg-black/45 group-hover:bg-black/30' : ''} transition-colors`} aria-hidden />
      <span
        className={`relative flex h-full items-center justify-center px-2 text-center text-sm font-semibold first-letter:uppercase ${
          image ? 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]' : 'text-brass-strong'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

/** Treffene i et søk, en kategori, Trending eller Nylig brukt — med flere sider når man ruller. */
function Feed({
  config,
  kind,
  feed,
  title,
  onBack,
  onPick,
  busy,
  scroller,
}: {
  config: KlipyConfig
  kind: ExternalMediaKind
  feed: KlipyFeed
  title: string
  onBack: () => void
  onPick: (item: KlipyItem) => void
  busy: boolean
  /** Rullefeltet i panelet — der neste side skal begynne å hentes litt før bunnen. */
  scroller: RefObject<HTMLDivElement | null>
}) {
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [items, setItems] = useState<KlipyItem[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(true)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const load = useCallback(
    async (p: number) => {
      if (loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      setFailed(false)
      try {
        const res = await fetchKlipyItems(config, kind, feed, p)
        // Samme treff kan komme igjen på neste side; KLIPYs rekkefølge beholdes.
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.slug))
          return [...prev, ...res.items.filter((i) => !seen.has(i.slug))]
        })
        setHasNext(res.hasNext && res.items.length > 0)
        setPage(p)
      } catch {
        setFailed(true)
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [config, kind, feed],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNext || failed) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load(page + 1)
      },
      { root: scroller.current, rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [load, page, hasNext, failed, items.length, scroller])

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <button type="button" onClick={onBack} className="cursor-pointer text-[0.78rem] text-ink-soft hover:text-ink">
          ← Tilbake
        </button>
        <span className="min-w-0 truncate text-[0.78rem] font-semibold text-ink first-letter:uppercase">{title}</span>
      </div>
      {items.length === 0 && loading && <Skeleton />}
      {items.length === 0 && !loading && !failed && <p className="px-1 py-6 text-center text-sm text-ink-soft">Ingen treff hos KLIPY.</p>}
      <div className={`columns-2 gap-1.5 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {items.map((item) => {
          const r = reduced && item.still ? item.still : item.preview
          return (
            <button
              key={item.slug}
              type="button"
              onClick={() => onPick(item)}
              title={item.title || undefined}
              aria-label={item.title || KIND_WORD[kind]}
              className="mb-1.5 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-[8px] bg-paper-sunken outline-offset-2 hover:ring-2 hover:ring-brass/60"
            >
              <img
                src={r.url}
                alt=""
                width={r.width}
                height={r.height}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className={`block h-auto w-full ${kind === 'sticker' ? 'object-contain p-1' : ''}`}
              />
            </button>
          )
        })}
      </div>
      {failed && <Failed onRetry={() => void load(items.length ? page + 1 : 1)} />}
      {hasNext && !failed && <div ref={sentinel} className="h-8" aria-hidden />}
    </div>
  )
}

/**
 * Knappen i skrivefeltet som åpner velgeren. Et valg fra KLIPY blir et utkast
 * (`addKlipyMedia`) og gis til `onAdd` — skrivefeltet legger det ved meldingen,
 * chatten sender det med en gang (som Discord). Emoji settes inn i teksten.
 */
export function PickerButton({
  tab = 'gif',
  onAdd,
  onEmoji,
  disabled = false,
  compact = false,
}: {
  tab?: PickerTab
  onAdd: (item: MessageMediaItem) => void | Promise<void>
  onEmoji?: (emoji: string) => void
  disabled?: boolean
  /** Bare ikonet/«GIF»-merket — i chatten, der plassen er knapp. */
  compact?: boolean
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async (item: KlipyItem, config: KlipyConfig, query: string) => {
    if (busy) return
    setBusy(true)
    try {
      const media = await addKlipyMedia({
        data: { kind: item.kind, slug: item.slug, title: item.title, url: item.full.url, width: item.full.width, height: item.full.height },
      })
      triggerKlipyShare(config, item, query)
      setOpen(false)
      await onAdd(media)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const label = tab === 'emoji' ? 'Sett inn emoji' : 'GIF, sticker eller meme'
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 ${
          open ? 'bg-paper-sunken text-ink' : ''
        } ${compact ? 'h-[42px] w-10 pointer-coarse:h-11 pointer-coarse:w-11' : 'px-2 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-3'}`}
      >
        {tab === 'emoji' ? (
          <Icon name="smile" size={compact ? 20 : 17} />
        ) : (
          <span className="rounded-[4px] border-[1.5px] border-current px-1 font-mono text-[0.62rem] leading-[1.15] font-bold tracking-wide">GIF</span>
        )}
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} label={label} width={380} height={440}>
        <MediaPicker
          initialTab={tab}
          busy={busy}
          onPickMedia={(item, config, query) => void pick(item, config, query)}
          onPickEmoji={
            onEmoji
              ? (emoji) => {
                  onEmoji(emoji)
                  setOpen(false)
                }
              : undefined
          }
        />
      </Popover>
    </>
  )
}

/**
 * Verktøyene i et skrivefelt: GIF-velgeren, emoji (bare med mus — telefonen har
 * emoji på tastaturet) og opplasting fra enheten. Et valg fra GIF-velgeren
 * legges ved meldingen (`onGif` overstyrer — chatten sender det med en gang).
 */
export function ComposerTools({
  media,
  onEmoji,
  onGif,
  disabled = false,
  compact = false,
}: {
  media: MediaDraft
  onEmoji?: (emoji: string) => void
  onGif?: (item: MessageMediaItem) => void | Promise<void>
  disabled?: boolean
  compact?: boolean
}) {
  const add = onGif ?? media.addReady
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <PickerButton tab="gif" onAdd={add} onEmoji={onEmoji} disabled={disabled || (!onGif && media.full)} compact={compact} />
      {onEmoji && (
        <span className="contents pointer-coarse:hidden">
          <PickerButton tab="emoji" onAdd={add} onEmoji={onEmoji} disabled={disabled} compact={compact} />
        </span>
      )}
      <MediaButton draft={media} disabled={disabled} compact={compact} />
    </div>
  )
}
