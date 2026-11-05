import { useCanGoBack, useRouter } from '@tanstack/react-router'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type StandEntry,
  parseStandPosition,
  resolveStart,
  resumeLabel,
  serializeStandPosition,
  standEntries,
  standPositionKey,
  startIndex,
} from '../lib/stand'
import {
  type GestureMode,
  HINT_SEEN,
  LAST_PAGE,
  type Orientation,
  type StandView,
  canSpread,
  clampViewStart,
  gestureModeOf,
  hintStorageKey,
  lastViewStart,
  nextTurn,
  orientationOf,
  pageLabel,
  pagesPerView,
  prevTurn,
  resolveView,
  shouldShowHint,
  tapZone,
  viewStartFor,
  viewStorageKey,
} from '../lib/stand-view'
import { applyTheme, readThemeMode, resolveTheme } from '../lib/theme'
import type { ProjectWorkDetail } from '../server/projects'
import { Icon } from './Icons'
import { useOfflineStand } from './OfflineStand'
import { ListenModal } from './Repertoire'
import { type PdfErrorKind, PagedPages, ScrollPages, Spinner, usePdfDocument } from './stand/StandPdf'
import { GestureHelp, ResumeNotice } from './stand/StandHelp'
import { ProgramSheet, ViewSheet } from './stand/StandSheets'

const NIGHT_KEY = 'tb-stand-night'
/** Hvor lenge menyene står fremme i en sidevisning før de trekker seg unna noten. */
const CHROME_HIDE_MS = 4000
/** Lastes et stykke lenger enn dette, kommer menyene frem — man skal aldri stå uten vei ut. */
const SLOW_LOAD_MS = 3000
/** Hvor lenge «Fortsatt fra …» står før den forsvinner av seg selv. */
const RESUME_NOTICE_MS = 7000

type Sheet = 'program' | 'view' | 'listen'

/**
 * Notestativet — PDF-visning i fullskjerm inne i appen.
 *
 * Tre visninger (`src/lib/stand-view.ts`), valgt per retning og husket i
 * localStorage: «Tilpass bredde» (rull, standard på telefon), «Hel side»
 * (standard på iPad stående) og «To sider» (standard på iPad liggende).
 *
 * - Tilpass bredde: sidene under hverandre; rull for å lese, sveip sidelengs
 *   for neste/forrige stykke. Bladvendere ruller en skjerm, og fra bunnen
 *   videre til neste stykke.
 * - Hel side / To sider: trykk i høyre eller venstre tredjedel, sveip, eller
 *   bruk bladvenderen for å bla en side (et oppslag). Fra siste side går det
 *   videre til neste stykke, og bakover lander man på forrige stykkes siste side.
 * - Trykk midt på noten for å vise eller skjule menyene. I sidevisningene
 *   trekker de seg unna av seg selv, så ingenting ligger over noten.
 * - Menyene står fremme så lenge noten lastes, ikke kan åpnes eller stativet er
 *   tomt — de trekker seg bare unna når noten faktisk vises.
 * - «Program» hopper rett til et stykke; «Visning» har visningsvalget, Nattlys,
 *   Lytt, Offline, Del, hjelpen for bladingen og Fullskjerm (bare der
 *   nettleseren støtter det).
 * - Stativet husker hvor man var (stykke og side, per bruker og prosjekt, i
 *   localStorage) og fortsetter der, med «Fra starten» i en liten beskjed og i
 *   Program. `?fil=` vinner over den lagrede posisjonen.
 * - Første gang man bruker en visning, viser en hjelp trykkfeltene og hva et
 *   sveip gjør (`gestureHint` i `src/lib/stand-view.ts`).
 * - Skjermen holdes våken (Screen Wake Lock) så lenge stativet er åpent.
 *
 * Adressen endres aldri mens man blar (se ruta): hver endring ville vært en
 * navigasjon som sjekker innloggingen mot serveren — og stativet skal virke
 * uten nett.
 */
export function Notestativ({
  project,
  repertoire,
  hasParts,
  initialFileId,
  ownerId,
}: {
  project: { id: string; name: string }
  repertoire: ProjectWorkDetail[]
  hasParts: boolean
  initialFileId: string | null
  /** Innlogget bruker — offline-kopien merkes med hvem som lagret den. */
  ownerId: string
}) {
  // Lista bygges én gang: en fil man åpnet stativet fra (f.eks. partituret)
  // skal bli liggende mens man blar.
  const [entries] = useState(() => standEntries(repertoire, { hasParts, focusFileId: initialFileId }))
  const [index, setIndex] = useState(() => startIndex(entries, initialFileId))
  /** Den lagrede posisjonen er lest (etter hydrering — serveren har ingen localStorage). */
  const [ready, setReady] = useState(false)
  /** «Fortsatt fra II. Benedictus, side 3» — til den forsvinner eller man blar. */
  const [resume, setResume] = useState<string | null>(null)
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null)
  const [chrome, setChrome] = useState(true)
  const [night, setNight] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  /** Rullevisningen: siden som synes mest. */
  const [scrollPage, setScrollPage] = useState({ current: 1, total: 0 })
  /** Rullevisningen: siden man skal rulle til (etter bytte fra sidevisning). */
  const [scrollTarget, setScrollTarget] = useState<number | undefined>()
  /** Sidevisningene: første side i visningen, eller `LAST_PAGE`. */
  const [viewStart, setViewStart] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // Offline lagres hele stativet slik det ser ut uten `?fil=` — det er den
  // siden som lagres og åpnes uten nett, og det samme som «Mine noter» teller.
  const [offlineIds] = useState(() => standEntries(repertoire, { hasParts }).map((e) => e.fileId))
  const offline = useOfflineStand(project, offlineIds, ownerId)

  const entry: StandEntry | undefined = entries[index]
  const work = entry ? repertoire.find((w) => w.workId === entry.workId) : undefined
  // Vent med å hente til den lagrede posisjonen er lest, så vi ikke henter
  // første stykke bare for å kaste det.
  const pdf = usePdfDocument(ready ? (entry?.fileId ?? null) : null)
  const total = pdf.doc?.numPages ?? 0

  // ---------- Visning ----------

  const screen = useScreenSize()
  const orientation: Orientation | null = screen ? orientationOf(screen.width, screen.height) : null
  const [storedViews, setStoredViews] = useState<Record<Orientation, string | null>>({
    portrait: null,
    landscape: null,
  })
  useEffect(() => {
    const read = (o: Orientation) => {
      try {
        return window.localStorage.getItem(viewStorageKey(o))
      } catch {
        return null
      }
    }
    setStoredViews({ portrait: read('portrait'), landscape: read('landscape') })
  }, [])
  /** `null` til skjermen er målt (SSR og første tegning). */
  const view: StandView | null =
    screen && orientation ? resolveView(storedViews[orientation], screen.width, screen.height) : null
  const paged = view === 'page' || view === 'spread'
  const perView = pagesPerView(view ?? 'scroll')
  const start = clampViewStart(viewStart, total, perView)
  const spreadOk = screen ? canSpread(screen.width, screen.height) : false

  const chooseView = (next: StandView) => {
    if (!orientation) return
    try {
      window.localStorage.setItem(viewStorageKey(orientation), next)
    } catch {}
    setStoredViews((prev) => ({ ...prev, [orientation]: next }))
  }

  // Bytter man visning (selv, eller ved å snu iPad-en), skal man stå på samme side.
  const currentPage = view === 'scroll' ? scrollPage.current : start
  const lastPage = useRef(1)
  const prevView = useRef<StandView | null>(null)
  useEffect(() => {
    const before = prevView.current
    prevView.current = view
    if (!before || !view || before === view) return
    if (view === 'scroll') {
      setScrollTarget(lastPage.current)
      setScrollPage({ current: lastPage.current, total })
    } else {
      setViewStart(viewStartFor(lastPage.current, pagesPerView(view)))
    }
    // Kjøres bare når visningen byttes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  useEffect(() => {
    lastPage.current = currentPage
  }, [currentPage])

  // ---------- Hvor man var ----------

  const positionKey = standPositionKey(ownerId, project.id)
  useEffect(() => {
    let saved = null
    try {
      saved = parseStandPosition(window.localStorage.getItem(positionKey))
    } catch {}
    const at = resolveStart(entries, { requestedFileId: initialFileId, saved, now: Date.now() })
    setIndex(at.index)
    if (at.page > 1) {
      setViewStart(at.page)
      setScrollTarget(at.page)
      setScrollPage({ current: at.page, total: 0 })
    }
    const resumedEntry = entries[at.index]
    if (at.resumed && resumedEntry) setResume(resumeLabel(resumedEntry, at.page))
    setReady(true)
    // Bare ved åpning: posisjonen leses én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Noten vises — ikke lastes, ikke feilet, ikke tomt. */
  const settled = !!entry && !!pdf.doc && !!view
  useEffect(() => {
    if (!ready || !settled || !entry) return
    try {
      window.localStorage.setItem(
        positionKey,
        serializeStandPosition({ fileId: entry.fileId, page: currentPage, savedAt: Date.now() }),
      )
    } catch {}
  }, [ready, settled, entry, currentPage, positionKey])

  useWakeLock()
  useStandStatusBar()

  useEffect(() => {
    try {
      setNight(window.localStorage.getItem(NIGHT_KEY) === '1')
    } catch {}
  }, [])

  const onScrollPage = useCallback((current: number, total: number) => {
    setScrollPage((prev) => (prev.current === current && prev.total === total ? prev : { current, total }))
  }, [])

  // ---------- Bla ----------

  const go = useCallback(
    (next: number, opts: { atEnd?: boolean } = {}) => {
      if (next < 0 || next >= entries.length || next === index) return
      setResume(null)
      setSlide(next > index ? 'next' : 'prev')
      setIndex(next)
      setScrollPage({ current: 1, total: 0 })
      setScrollTarget(undefined)
      // Bakover med pedalen lander på slutten av forrige stykke, som når man
      // blar tilbake i en perm; ellers starter et stykke på første side.
      setViewStart(opts.atEnd ? LAST_PAGE : 1)
      requestAnimationFrame(() => {
        const el = scroller.current
        if (el) el.scrollTo({ top: opts.atEnd ? el.scrollHeight : 0 })
      })
    },
    [entries, index],
  )

  /** Én side (ett oppslag) frem eller tilbake i sidevisningene, og videre til neste stykke. */
  const turn = useCallback(
    (direction: 'next' | 'prev', opts: { keepChrome?: boolean } = {}) => {
      // Mens noten lastes vet vi ikke hvor mange sider den har; et stykke som
      // ikke kan åpnes, skal man likevel kunne bla forbi.
      if (!pdf.doc && !pdf.error) return
      const t = direction === 'next' ? nextTurn(start, total, perView) : prevTurn(start, perView)
      // Man spiller: menyene skal ikke ligge over noten. (Pillens egne knapper
      // lar dem stå, så man kan trykke flere ganger.)
      if (!opts.keepChrome) setChrome(false)
      setResume(null)
      if (t.kind === 'page') setViewStart(t.start)
      else if (direction === 'next') go(index + 1)
      else go(index - 1, { atEnd: true })
    },
    [pdf.doc, pdf.error, start, total, perView, go, index],
  )

  /** «Fra starten»: første side i første stykke. */
  const atStart = index === 0 && currentPage <= 1
  const restart = useCallback(() => {
    setResume(null)
    setSheet(null)
    if (index !== 0) {
      go(0)
      return
    }
    setViewStart(1)
    setScrollTarget(undefined)
    setScrollPage((prev) => ({ current: 1, total: prev.total }))
    scroller.current?.scrollTo({ top: 0 })
  }, [index, go])

  // ---------- Hjelp for bladingen ----------

  const gestureMode: GestureMode | null = view ? gestureModeOf(view) : null
  /** Sett før? Antar «ja» til localStorage er lest, så hjelpen aldri blinker forbi. */
  const [hintSeen, setHintSeen] = useState<Record<GestureMode, boolean>>({ scroll: true, paged: true })
  /** Åpnet fra «Visning». */
  const [hintRequested, setHintRequested] = useState(false)
  useEffect(() => {
    const seen = (mode: GestureMode) => {
      try {
        return !shouldShowHint(window.localStorage.getItem(hintStorageKey(mode)))
      } catch {
        return false
      }
    }
    setHintSeen({ scroll: seen('scroll'), paged: seen('paged') })
  }, [])
  // Av seg selv bare når noten faktisk vises: hjelpen forklarer noten, ikke en feilmelding.
  const hintOpen = !!gestureMode && !sheet && (hintRequested || (settled && !hintSeen[gestureMode]))
  const dismissHint = useCallback(() => {
    setHintRequested(false)
    if (!gestureMode) return
    setHintSeen((prev) => ({ ...prev, [gestureMode]: true }))
    try {
      window.localStorage.setItem(hintStorageKey(gestureMode), HINT_SEEN)
    } catch {}
  }, [gestureMode])

  // Bladvendere (Bluetooth-pedaler sender piltaster eller Page Up/Down) og tastatur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || !view || e.metaKey || e.ctrlKey || e.altKey) return
      const forward = ['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)
      const backward = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)
      if (!forward && !backward) return
      e.preventDefault()
      // En pedal mens hjelpen står fremme: den som bruker pedal, vet hvordan man blar.
      if (hintOpen) dismissHint()
      if (paged) {
        turn(forward ? 'next' : 'prev')
        return
      }
      const el = scroller.current
      if (!el) return
      const step = el.clientHeight * 0.85
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      const atTop = el.scrollTop <= 4
      if (forward) {
        if (atBottom) go(index + 1)
        else el.scrollBy({ top: step, behavior: 'smooth' })
      } else {
        if (atTop) go(index - 1, { atEnd: true })
        else el.scrollBy({ top: -step, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, turn, index, sheet, view, paged, hintOpen, dismissHint])

  // Sveip og trykk. I rullevisningen gjør `touch-action: pan-y pinch-zoom` at
  // sidelengs bevegelse kommer hit i stedet for å bli en rulling; i
  // sidevisningene er det ingenting å rulle før man har zoomet inn.
  const zoomed = useZoomed()
  const pointer = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || (e.target as Element).closest('button, a')) return
    pointer.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
  }
  const gesture = (e: React.PointerEvent) => {
    const start = pointer.current
    pointer.current = null
    if (!start || start.id !== e.pointerId) return null
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dt = performance.now() - start.t
    const isZoomed = (window.visualViewport?.scale ?? 1) > 1.05
    if (!isZoomed && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 700) {
      return { kind: 'swipe' as const, direction: dx < 0 ? ('next' as const) : ('prev' as const) }
    }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 350) return { kind: 'tap' as const, zoomed: isZoomed }
    return null
  }
  const onScrollPointerUp = (e: React.PointerEvent) => {
    const g = gesture(e)
    if (g?.kind === 'swipe') go(g.direction === 'next' ? index + 1 : index - 1)
    else if (g?.kind === 'tap') setChrome((v) => !v)
  }
  const onPagedPointerUp = (e: React.PointerEvent) => {
    const g = gesture(e)
    if (g?.kind === 'swipe') turn(g.direction)
    else if (g?.kind === 'tap') {
      // Innzoomet blar et trykk aldri: man leser en detalj, og bommer lett.
      const rect = e.currentTarget.getBoundingClientRect()
      const zone = g.zoomed ? 'center' : tapZone(e.clientX - rect.left, rect.width)
      if (zone === 'center') setChrome((v) => !v)
      else turn(zone)
    }
  }

  // I sidevisningene ligger menyene over noten: de trekker seg unna av seg selv —
  // men bare når noten faktisk vises. Mens den lastes, ikke kan åpnes eller
  // stativet er tomt, er menyene den eneste veien videre.
  useEffect(() => {
    if (!paged || !chrome || sheet || !settled || hintOpen) return
    const timer = window.setTimeout(() => setChrome(false), CHROME_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [paged, chrome, sheet, settled, hintOpen, index, start])

  // En feil henter menyene frem (de står også fremme så lenge feilen vises), og
  // det gjør en lasting som drar ut — et trykk midt på er ikke opplagt da.
  const loading = !!entry && ready && !pdf.doc && !pdf.error
  useEffect(() => {
    if (pdf.error) setChrome(true)
  }, [pdf.error])
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setChrome(true), SLOW_LOAD_MS)
    return () => window.clearTimeout(timer)
  }, [loading, entry?.fileId])
  const showChrome = chrome || !entry || !!pdf.error

  // «Fortsatt fra …» står en stund når noten vises, og forsvinner ved første bla.
  const resumeVisible = !!resume && settled && !hintOpen && !sheet
  useEffect(() => {
    if (!resumeVisible) return
    const timer = window.setTimeout(() => setResume(null), RESUME_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [resumeVisible])

  // ---------- Verktøy ----------

  const prev = entries[index - 1]
  const next = entries[index + 1]

  const toggleNight = () => {
    setNight((v) => {
      try {
        window.localStorage.setItem(NIGHT_KEY, v ? '0' : '1')
      } catch {}
      return !v
    })
  }

  const back = () => {
    // Uten nett kan ingen annen side lastes; en vanlig sidelasting gir
    // offline-siden med lista over lagrede stativ (public/offline.html).
    if (!navigator.onLine) window.location.assign('/')
    else if (canGoBack) router.history.back()
    else router.navigate({ to: '/noter' })
  }

  const fullscreen = useFullscreen()
  const closeSheet = (which: Sheet) => () => setSheet((s) => (s === which ? null : s))

  const share = () => {
    if (!entry) return
    const href = `/api/files/${entry.fileId}`
    setSheet(null)
    // Med mus (desktop) åpnes PDF-en i ny fane som før.
    const doc = pdf.doc
    if (doc && 'canShare' in navigator && window.matchMedia('(pointer: coarse)').matches) {
      void sharePdf(doc, `${entry.title} – ${entry.label}.pdf`, href)
    } else {
      window.open(href, '_blank', 'noreferrer')
    }
  }

  const position = view === 'scroll'
    ? scrollPage.total
      ? `side ${scrollPage.current} av ${scrollPage.total}`
      : ''
    : pageLabel(start, total, perView)
  const atLastView = paged && total > 0 && start >= lastViewStart(total, perView)
  const atFirstView = paged && start <= 1

  // ---------- Noten ----------

  const content = !entry ? (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
      <div>
        <p className="display-title text-xl font-semibold">Ingen noter på stativet ennå</p>
        <p className="mt-2 text-sm text-(--stand-muted)">
          Når stemmene dine i «{project.name}» er lastet opp, ligger de her i programrekkefølge.
        </p>
      </div>
    </div>
  ) : pdf.error ? (
    <StandError kind={pdf.error} fileId={entry.fileId} savedOffline={!!offline.saved} onRetry={pdf.retry} />
  ) : !pdf.doc || !view ? (
    <Spinner onRetry={ready ? pdf.retry : undefined} />
  ) : view === 'scroll' ? (
    <ScrollPages doc={pdf.doc} scrollRoot={scroller} onPage={onScrollPage} initialPage={scrollTarget} />
  ) : (
    <PagedPages doc={pdf.doc} start={start} perView={perView} />
  )

  const animated = (
    <div
      key={entry?.fileId ?? 'tom'}
      className={`${slide ? `stand-slide-${slide}` : ''} ${night ? 'stand-night' : ''} ${paged ? 'h-full' : ''}`}
    >
      {content}
    </div>
  )

  return (
    <div className="stand fixed inset-0 flex flex-col bg-(--stand-bg) text-(--stand-ink)">
      {/* Topplinje */}
      <header
        className={`stand-bar pt-safe absolute inset-x-0 top-0 z-20 transition-[opacity,transform] duration-200 ${
          showChrome ? '' : 'pointer-events-none -translate-y-full opacity-0'
        }`}
      >
        <div className="px-safe flex h-14 items-center gap-1">
          <button
            type="button"
            onClick={back}
            className="-ml-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center gap-0.5 pr-2 text-[0.95rem] text-(--stand-accent)"
          >
            <Icon name="chevronLeft" size={22} />
            {/* På telefon trenger tittelen plassen; pilen alene er tydelig nok. */}
            <span className="max-sm:sr-only">Noter</span>
          </button>
          <div className="min-w-0 flex-1 px-1 text-center">
            <p className="truncate text-[0.95rem] font-semibold">{entry ? entry.title : project.name}</p>
            <p className="truncate font-mono text-[0.62rem] uppercase tracking-[0.14em] text-(--stand-muted)">
              {entry ? `${entry.label}${position ? ` · ${position}` : ''}` : project.name}
            </p>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setSheet('program')}
              aria-label={`Program, stykke ${index + 1} av ${entries.length}`}
              className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-(--stand-accent) transition-colors hover:bg-(--stand-hover)"
            >
              <Icon name="list" size={21} />
              <span className="font-mono text-[0.78rem] tabular-nums tracking-wider">
                {index + 1}/{entries.length}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSheet('view')}
            aria-label="Visning og verktøy"
            className="-mr-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-(--stand-accent) transition-colors hover:bg-(--stand-hover)"
          >
            <Icon name="more" size={22} />
          </button>
        </div>
      </header>

      {/* Noten */}
      {view === 'scroll' || !view ? (
        <div
          ref={scroller}
          data-no-pull
          className="flex-1 overflow-y-auto overscroll-contain [touch-action:pan-y_pinch-zoom]"
          onPointerDown={onPointerDown}
          onPointerUp={onScrollPointerUp}
          onPointerCancel={() => (pointer.current = null)}
        >
          <div
            className={`mx-auto w-full max-w-5xl px-1.5 pt-[calc(env(safe-area-inset-top)+64px)] sm:px-4 ${
              entries.length > 1 ? 'pb-[calc(env(safe-area-inset-bottom)+76px)]' : 'pb-[calc(env(safe-area-inset-bottom)+16px)]'
            }`}
          >
            {animated}
          </div>
        </div>
      ) : (
        <div
          data-no-pull
          className="stand-stage flex-1 overflow-hidden"
          style={{ touchAction: zoomed ? 'pan-x pan-y pinch-zoom' : 'pinch-zoom' }}
          onPointerDown={onPointerDown}
          onPointerUp={onPagedPointerUp}
          onPointerCancel={() => (pointer.current = null)}
        >
          {animated}
        </div>
      )}

      {/* Bunnen. Rullevisningen: forrige/neste stykke (hvor man er i programmet
          står på Program-knappen øverst). Sidevisningene: en liten pille som
          følger menyene, så ingen fast linje ligger over noten. */}
      {view === 'scroll' && entries.length > 1 && (
        <footer
          className={`stand-bar pb-safe absolute inset-x-0 bottom-0 z-20 transition-[opacity,transform] duration-200 ${
            showChrome ? '' : 'pointer-events-none translate-y-full opacity-0'
          }`}
        >
          <div className="px-safe flex items-center gap-2 py-1">
            <PieceButton entry={prev} direction="prev" onClick={() => go(index - 1)} />
            <PieceButton entry={next} direction="next" onClick={() => go(index + 1)} />
          </div>
        </footer>
      )}
      {paged && entry && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] transition-[opacity,transform] duration-200 ${
            showChrome ? '' : 'translate-y-4 opacity-0'
          }`}
        >
          <div
            className={`stand-pill flex max-w-full items-center gap-1 rounded-full p-1 ${showChrome ? 'pointer-events-auto' : ''}`}
          >
            <button
              type="button"
              onClick={() => turn('prev', { keepChrome: true })}
              disabled={atFirstView && !prev}
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full px-2 text-sm text-(--stand-accent) transition-colors hover:bg-(--stand-hover) disabled:opacity-30"
              aria-label={atFirstView && prev ? `Forrige stykke: ${prev.title}` : 'Forrige side'}
            >
              <Icon name="chevronLeft" size={20} />
              {atFirstView && prev && <span className="max-w-[28vw] truncate pr-1">{prev.title}</span>}
            </button>
            {position && (
              <span className="shrink-0 px-2 font-mono text-[0.68rem] uppercase tabular-nums tracking-[0.12em] text-(--stand-muted)">
                {position}
              </span>
            )}
            <button
              type="button"
              onClick={() => turn('next', { keepChrome: true })}
              disabled={atLastView && !next}
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-full px-2 text-sm text-(--stand-accent) transition-colors hover:bg-(--stand-hover) disabled:opacity-30"
              aria-label={atLastView && next ? `Neste stykke: ${next.title}` : 'Neste side'}
            >
              {atLastView && next && <span className="max-w-[28vw] truncate pl-1">{next.title}</span>}
              <Icon name="chevronRight" size={20} />
            </button>
          </div>
        </div>
      )}

      <ProgramSheet
        open={sheet === 'program'}
        onClose={closeSheet('program')}
        projectName={project.name}
        entries={entries}
        index={index}
        onPick={(i) => {
          setSheet(null)
          go(i)
        }}
        onRestart={atStart ? null : restart}
      />
      <ViewSheet
        open={sheet === 'view'}
        onClose={closeSheet('view')}
        view={view ?? 'scroll'}
        views={spreadOk ? ['scroll', 'page', 'spread'] : ['scroll', 'page']}
        spreadHint={!spreadOk && orientation === 'portrait' && !!screen && Math.min(screen.width, screen.height) >= 700}
        onView={chooseView}
        night={night}
        onNight={toggleNight}
        listen={entry?.canListen && work ? { title: entry.title, onOpen: () => setSheet('listen') } : null}
        offline={
          offline.supported && offlineIds.length > 0
            ? { saved: offline.saved, progress: offline.progress, count: offlineIds.length, onToggle: offline.toggle }
            : null
        }
        onShare={entry ? share : null}
        fullscreen={fullscreen}
        onHelp={() => {
          setSheet(null)
          setHintRequested(true)
        }}
      />
      {work && <ListenModal item={work} open={sheet === 'listen'} onClose={closeSheet('listen')} />}
      {resumeVisible && resume && <ResumeNotice label={resume} onRestart={restart} onDismiss={() => setResume(null)} />}
      {hintOpen && gestureMode && <GestureHelp mode={gestureMode} onClose={dismissHint} />}
    </div>
  )
}

function PieceButton({
  entry,
  direction,
  onClick,
}: {
  entry: StandEntry | undefined
  direction: 'prev' | 'next'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={!entry}
      onClick={onClick}
      className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 text-sm text-(--stand-accent) disabled:invisible ${
        direction === 'next' ? 'justify-end text-right' : 'text-left'
      }`}
    >
      {direction === 'prev' && <Icon name="chevronLeft" size={18} />}
      <span className="truncate">{entry ? `${entry.number} ${entry.title}` : ''}</span>
      {direction === 'next' && <Icon name="chevronRight" size={18} />}
    </button>
  )
}

// ---------- Feil ----------

function errorCopy(kind: PdfErrorKind, savedOffline: boolean): { title: string; detail: string } {
  switch (kind) {
    case 'forbidden':
      return {
        title: 'Du har ikke tilgang til denne noten lenger',
        detail: 'Stemmefordelingen kan ha endret seg. Spør notearkivaren om du mener det er feil.',
      }
    case 'missing':
      return {
        title: 'Fant ikke noten',
        detail: 'Fila kan ha blitt byttet ut med en ny versjon. Gå tilbake og åpne stativet på nytt.',
      }
    case 'offline':
      return savedOffline
        ? {
            title: 'Denne noten mangler i den lagrede kopien',
            detail: 'Stativet er lagret på enheten, men akkurat denne fila kom ikke med. Den hentes når du har nett igjen.',
          }
        : {
            title: 'Du er uten nett, og stativet er ikke lagret på enheten',
            detail: 'Slå på «Tilgjengelig offline» under Visning neste gang du har nett, så kan du bla uten dekning.',
          }
    default:
      return { title: 'Kunne ikke åpne noten', detail: 'Det kan være et kortvarig problem med nettet eller serveren.' }
  }
}

function StandError({
  kind,
  fileId,
  savedOffline,
  onRetry,
}: {
  kind: PdfErrorKind
  fileId: string
  savedOffline: boolean
  onRetry: () => void
}) {
  const copy = errorCopy(kind, savedOffline)
  return (
    <div className="grid min-h-[60dvh] h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-(--stand-sunken) text-(--stand-accent)">
          <Icon name={kind === 'offline' ? 'wifiOff' : 'notes'} size={22} />
        </span>
        <p className="display-title text-xl font-semibold">{copy.title}</p>
        <p className="mt-2 text-sm text-(--stand-muted)">{copy.detail}</p>
        <div className="mt-6 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-(--stand-accent) px-5 text-sm font-semibold text-(--stand-bg) transition-transform active:scale-[0.97]"
          >
            <Icon name="refresh" size={18} />
            Prøv igjen
          </button>
          {/* Uten nett hjelper ikke en direkte lenke heller. */}
          {kind !== 'offline' && (
            <a
              href={`/api/files/${fileId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-sm text-(--stand-accent) underline underline-offset-4"
            >
              Åpne PDF-en direkte
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Del ----------

/**
 * «Del» åpner delingsarket med selve PDF-en (lagre i Filer, skrive ut, AirDrop).
 * I en installert iOS-app åpner en lenke i ny fane en nettleser som ikke deler
 * appens innlogging, så fil-gaten ville svart «Krever innlogging». Bytene
 * kommer fra pdf.js, som allerede har dem — ingen ny henting som kunne latt
 * trykket «gå ut på dato» før delingsarket åpnes. Uten støtte: vanlig lenke.
 */
async function sharePdf(doc: PDFDocumentProxy, name: string, fallbackHref: string) {
  try {
    const bytes = new Uint8Array(await doc.getData())
    const file = new File([bytes], name.replace(/[\\/:*?"<>|]+/g, ' '), { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name })
      return
    }
  } catch (err) {
    // Avbrutt av brukeren: ikke noe mer å gjøre.
    if ((err as Error)?.name === 'AbortError') return
  }
  window.open(fallbackHref, '_blank', 'noreferrer')
}

// ---------- Skjerm og statuslinje ----------

/** Visningsområdets størrelse, `null` før første måling (SSR). */
function useScreenSize(): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const measure = () =>
      setSize((prev) => {
        const width = window.innerWidth
        const height = window.innerHeight
        return prev && prev.width === width && prev.height === height ? prev : { width, height }
      })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return size
}

/** Er siden zoomet inn med to fingre? */
function useZoomed(): boolean {
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setZoomed(vv.scale > 1.05)
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])
  return zoomed
}

/** Fullskjerm der nettleseren støtter det; `null` ellers (iPhone, installert iOS-app). */
function useFullscreen(): { active: boolean; onToggle: () => void } | null {
  // Avgjøres etter hydrering: serveren vet ikke hva nettleseren støtter.
  const [supported, setSupported] = useState(false)
  const [active, setActive] = useState(false)
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled)
    const sync = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  if (!supported) return null
  return {
    active,
    onToggle: () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen().catch(() => {})
    },
  }
}

/** Hold skjermen våken mens stativet er åpent. Stilltiende uten støtte. */
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> }
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock
    if (!wakeLock) return
    let sentinel: Sentinel | null = null
    let active = true
    const request = async () => {
      try {
        const next = await wakeLock.request('screen')
        if (active) sentinel = next
        else void next.release()
      } catch {}
    }
    void request()
    // Låsen slippes når appen går i bakgrunnen; be om den igjen når den er tilbake.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [])
}

/**
 * Mørk statuslinje over det mørke stativet; temaets farge tilbake etterpå.
 * Sidens bakgrunn følger med, for det er den iOS viser bak klokka og når man
 * drar forbi kanten — ellers en lys stripe over notene i lyst tema. (Et fast
 * element over toppen av skjermen ville ikke hjulpet: WebKit klipper det.)
 * Fargen er `--stand-bg` (styles.css), lest her fordi meta-taggen trenger en
 * ferdig farge.
 */
function useStandStatusBar() {
  useEffect(() => {
    const root = document.documentElement
    const bg = getComputedStyle(root).getPropertyValue('--stand-bg').trim()
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = bg
    root.style.backgroundColor = bg
    return () => {
      root.style.backgroundColor = ''
      applyTheme(resolveTheme(readThemeMode()))
    }
  }, [])
}
