import { useCanGoBack, useRouter } from '@tanstack/react-router'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdfJs } from '../lib/pdf-loader'
import { type StandEntry, standEntries, startIndex } from '../lib/stand'
import { applyTheme, readThemeMode, resolveTheme } from '../lib/theme'
import type { ProjectWorkDetail } from '../server/projects'
import { Icon, type IconName } from './Icons'
import { useOfflineStand } from './OfflineStand'
import { ListenModal } from './Repertoire'

/** Bakgrunnen rundt arket. Alltid mørk: noten skal være det lyseste i rommet. */
const STAND_BG = '#15120f'
const NIGHT_KEY = 'tb-stand-night'

/**
 * Notestativet — PDF-visning i fullskjerm inne i appen.
 *
 * - Sidene i et stykke ligger under hverandre i full bredde; rull for å bla.
 * - Sveip sidelengs (eller pilene nederst) for neste/forrige stykke i programmet.
 * - Trykk på noten for å skjule eller vise verktøylinjene.
 * - Bladvendere (Bluetooth-pedaler) sender piltaster eller Page Up/Down: «neste»
 *   ruller en skjerm ned, og fra bunnen av et stykke videre til neste.
 * - Skjermen holdes våken (Screen Wake Lock) så lenge stativet er åpent.
 * - «Nattlys» inverterer arket til lys skrift på mørkt, for mørke scener.
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
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null)
  const [chrome, setChrome] = useState(true)
  const [night, setNight] = useState(false)
  const [listenOpen, setListenOpen] = useState(false)
  const [page, setPage] = useState({ current: 1, total: 0 })
  /** Den åpne PDF-en, til «Del» — bytene er allerede lastet, ingen ny henting. */
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // Offline lagres hele stativet slik det ser ut uten `?fil=` — det er den
  // siden som lagres og åpnes uten nett, og det samme som «Mine noter» teller.
  const [offlineIds] = useState(() => standEntries(repertoire, { hasParts }).map((e) => e.fileId))
  const offline = useOfflineStand(project, offlineIds, ownerId)

  const onPage = useCallback((current: number, total: number) => {
    setPage((prev) => (prev.current === current && prev.total === total ? prev : { current, total }))
  }, [])

  const entry: StandEntry | undefined = entries[index]
  const work = entry ? repertoire.find((w) => w.workId === entry.workId) : undefined

  useWakeLock()
  useStandStatusBar()

  useEffect(() => {
    try {
      setNight(window.localStorage.getItem(NIGHT_KEY) === '1')
    } catch {}
  }, [])

  const go = useCallback(
    (next: number, opts: { atEnd?: boolean } = {}) => {
      if (next < 0 || next >= entries.length || next === index) return
      setSlide(next > index ? 'next' : 'prev')
      setIndex(next)
      setPage({ current: 1, total: 0 })
      // Bakover med pedalen lander nederst i forrige stykke, som når man blar
      // tilbake i en perm; ellers starter et stykke øverst.
      requestAnimationFrame(() => {
        const el = scroller.current
        if (el) el.scrollTo({ top: opts.atEnd ? el.scrollHeight : 0 })
      })
    },
    [entries, index],
  )

  // Bladvendere og tastatur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (listenOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const el = scroller.current
      if (!el) return
      const step = el.clientHeight * 0.85
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      const atTop = el.scrollTop <= 4
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        if (atBottom) go(index + 1)
        else el.scrollBy({ top: step, behavior: 'smooth' })
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        if (atTop) go(index - 1, { atEnd: true })
        else el.scrollBy({ top: -step, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, listenOpen])

  // Sveip og trykk. `touch-action: pan-y pinch-zoom` på rulleflaten gjør at
  // sidelengs bevegelse kommer hit i stedet for å bli en rulling.
  const pointer = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return
    pointer.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointer.current
    pointer.current = null
    if (!start || start.id !== e.pointerId) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dt = performance.now() - start.t
    const zoomed = (window.visualViewport?.scale ?? 1) > 1.05
    if (!zoomed && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 700) {
      go(dx < 0 ? index + 1 : index - 1)
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 350) {
      setChrome((v) => !v)
    }
  }

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

  // Avgjøres etter hydrering: serveren vet ikke hva nettleseren støtter.
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  useEffect(() => setFullscreenSupported(!!document.fullscreenEnabled), [])

  return (
    <div className="fixed inset-0 flex flex-col text-[#ede4cf]" style={{ background: STAND_BG }}>
      {/* Topplinje */}
      <header
        className={`stand-bar pt-safe absolute inset-x-0 top-0 z-20 bg-[#15120f]/88 backdrop-blur-md transition-[opacity,transform] duration-200 ${
          chrome ? '' : 'pointer-events-none -translate-y-full opacity-0'
        }`}
      >
        <div className="px-safe flex h-14 items-center gap-2">
          <button
            type="button"
            onClick={back}
            className="-ml-2 flex min-h-11 cursor-pointer items-center gap-0.5 pr-2 text-[0.95rem] text-[#e7c468]"
          >
            <Icon name="chevronLeft" size={22} />
            Noter
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[0.95rem] font-semibold">{entry ? entry.title : project.name}</p>
            <p className="truncate font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#b5a98b]">
              {entry
                ? `${entry.label}${page.total ? ` · side ${page.current} av ${page.total}` : ''}`
                : project.name}
            </p>
          </div>
          {entry ? (
            <a
              href={`/api/files/${entry.fileId}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Del eller åpne PDF-en"
              title="Del eller åpne PDF-en"
              onClick={(e) => {
                // Med mus (desktop) åpnes PDF-en i ny fane som før.
                const doc = docRef.current
                if (!doc || !('canShare' in navigator) || !window.matchMedia('(pointer: coarse)').matches) return
                e.preventDefault()
                void sharePdf(doc, `${entry.title} – ${entry.label}.pdf`, e.currentTarget.href)
              }}
              className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-[#e7c468]"
            >
              <Icon name="share" size={21} />
            </a>
          ) : (
            <span className="w-9" />
          )}
        </div>
      </header>

      {/* Noten */}
      <div
        ref={scroller}
        data-no-pull
        className="flex-1 overflow-y-auto overscroll-contain [touch-action:pan-y_pinch-zoom]"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointer.current = null)}
      >
        <div className="mx-auto w-full max-w-5xl px-1.5 pb-[calc(env(safe-area-inset-bottom)+128px)] pt-[calc(env(safe-area-inset-top)+64px)] sm:px-4">
          {entry ? (
            <div key={entry.fileId} className={slide ? `stand-slide-${slide}` : ''}>
              <PdfDocument
                fileId={entry.fileId}
                night={night}
                scrollRoot={scroller}
                onPage={onPage}
                onDoc={(doc) => (docRef.current = doc)}
              />
            </div>
          ) : (
            <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
              <div>
                <p className="display-title text-xl font-semibold">Ingen noter på stativet ennå</p>
                <p className="mt-2 text-sm text-[#b5a98b]">
                  Når stemmene dine i «{project.name}» er lastet opp, ligger de her i programrekkefølge.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bunnlinje */}
      <footer
        className={`stand-bar pb-safe absolute inset-x-0 bottom-0 z-20 bg-[#15120f]/88 backdrop-blur-md transition-[opacity,transform] duration-200 ${
          chrome ? '' : 'pointer-events-none translate-y-full opacity-0'
        }`}
      >
        {entries.length > 1 && (
          <div className="px-safe flex items-center gap-2 border-b border-white/10 py-1">
            <button
              type="button"
              disabled={!prev}
              onClick={() => go(index - 1)}
              className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 text-left text-sm text-[#e7c468] disabled:invisible"
            >
              <Icon name="chevronLeft" size={18} />
              <span className="truncate">{prev ? `${prev.number} ${prev.title}` : ''}</span>
            </button>
            <span className="flex shrink-0 gap-1.5" aria-label={`Stykke ${index + 1} av ${entries.length}`}>
              {entries.length <= 12 &&
                entries.map((e, i) => (
                  <span
                    key={e.fileId}
                    className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-[#e7c468]' : 'bg-white/25'}`}
                    aria-hidden
                  />
                ))}
              {entries.length > 12 && (
                <span className="font-mono text-[0.66rem] text-[#b5a98b]">
                  {index + 1}/{entries.length}
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={!next}
              onClick={() => go(index + 1)}
              className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-end gap-1 text-right text-sm text-[#e7c468] disabled:invisible"
            >
              <span className="truncate">{next ? `${next.number} ${next.title}` : ''}</span>
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        )}
        <div className="px-safe grid grid-cols-4 py-1">
          <ToolButton
            icon="playCircle"
            label="Lytt"
            disabled={!entry?.canListen}
            onClick={() => setListenOpen(true)}
          />
          <ToolButton icon="moon" label="Nattlys" active={night} onClick={toggleNight} />
          <ToolButton
            icon="download"
            label={offline.progress ? `${offline.progress.done}/${offline.progress.total}` : offline.saved ? 'Lagret' : 'Offline'}
            active={!!offline.saved}
            busy={!!offline.progress}
            disabled={!offline.supported || offlineIds.length === 0}
            onClick={offline.toggle}
          />
          <ToolButton
            icon="fullscreen"
            label="Fullskjerm"
            disabled={!fullscreenSupported}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void document.documentElement.requestFullscreen().catch(() => {})
            }}
          />
        </div>
      </footer>

      {work && <ListenModal item={work} open={listenOpen} onClose={() => setListenOpen(false)} />}
    </div>
  )
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  busy,
}: {
  icon: IconName
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={active}
      className={`flex min-h-[52px] cursor-pointer flex-col items-center justify-center gap-1 text-[0.66rem] font-medium disabled:cursor-default disabled:opacity-35 ${
        active ? 'text-[#e7c468]' : 'text-[#d8cdb4]'
      }`}
    >
      {busy ? <span className="spinner" aria-hidden /> : <Icon name={icon} size={22} />}
      {label}
    </button>
  )
}

// ---------- PDF ----------

type DocState = { doc: PDFDocumentProxy; error: null } | { doc: null; error: string | null }

function PdfDocument({
  fileId,
  night,
  scrollRoot,
  onPage,
  onDoc,
}: {
  fileId: string
  night: boolean
  scrollRoot: React.RefObject<HTMLDivElement | null>
  onPage: (current: number, total: number) => void
  onDoc: (doc: PDFDocumentProxy | null) => void
}) {
  const [state, setState] = useState<DocState>({ doc: null, error: null })
  const [width, setWidth] = useState(0)
  const onDocRef = useRef(onDoc)
  onDocRef.current = onDoc
  const wrap = useRef<HTMLDivElement>(null)
  const visible = useRef(new Map<number, number>())

  useEffect(() => {
    let cancelled = false
    let destroy: (() => void) | null = null
    setState({ doc: null, error: null })
    onDocRef.current(null)
    loadPdfJs()
      .then((lib) => {
        if (cancelled) return null
        // Hele fila i én GET: fil-gaten svarer ikke på Range, og service
        // workeren har bare hele kopien når man er uten nett.
        const task = lib.getDocument({
          url: `/api/files/${fileId}`,
          disableRange: true,
          disableStream: true,
        })
        destroy = () => void task.destroy()
        return task.promise
      })
      .then((doc) => {
        if (!doc) return
        if (cancelled) {
          void doc.loadingTask.destroy()
          return
        }
        setState({ doc, error: null })
        onDocRef.current(doc)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const status = (err as { status?: number })?.status
        const message =
          status === 403
            ? 'Du har ikke tilgang til denne noten lenger.'
            : status === 404
              ? 'Fant ikke noten.'
              : typeof navigator !== 'undefined' && !navigator.onLine
                ? 'Du er uten nett, og denne noten er ikke lagret offline.'
                : 'Kunne ikke åpne noten.'
        setState({ doc: null, error: message })
      })
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [fileId])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      // Rund av: små endringer (rullefelt) skal ikke tegne alt på nytt.
      setWidth(Math.round((entry?.contentRect.width ?? 0) / 8) * 8)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Referanser, så sidene ikke må abonnere på nytt hver gang forelderen tegnes.
  const total = state.doc?.numPages ?? 0
  const totalRef = useRef(total)
  totalRef.current = total
  const onPageRef = useRef(onPage)
  onPageRef.current = onPage
  const reportVisible = useCallback((pageNumber: number, ratio: number) => {
    visible.current.set(pageNumber, ratio)
    let best = 1
    let bestRatio = -1
    for (const [n, r] of visible.current) {
      if (r > bestRatio) {
        best = n
        bestRatio = r
      }
    }
    onPageRef.current(best, totalRef.current)
  }, [])

  useEffect(() => {
    visible.current.clear()
    if (total) onPageRef.current(1, total)
  }, [total])

  return (
    <div ref={wrap} className={night ? 'stand-night' : ''}>
      {state.error ? (
        <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
          <div>
            <p className="display-title text-xl font-semibold">{state.error}</p>
            <a href={`/api/files/${fileId}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-[#e7c468] underline underline-offset-4">
              Prøv å åpne PDF-en direkte
            </a>
          </div>
        </div>
      ) : !state.doc || width === 0 ? (
        <div className="grid min-h-[60dvh] place-items-center">
          <span className="spinner text-[#e7c468]" aria-label="Laster noten" />
        </div>
      ) : (
        <div className="space-y-2 sm:space-y-4">
          {Array.from({ length: state.doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              doc={state.doc!}
              pageNumber={i + 1}
              width={width}
              scrollRoot={scrollRoot}
              onVisible={reportVisible}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Største lerret vi lager (piksler). iOS gir opp rundt 16,7 millioner. */
const MAX_CANVAS_PIXELS = 12_000_000

function PdfPage({
  doc,
  pageNumber,
  width,
  scrollRoot,
  onVisible,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  scrollRoot: React.RefObject<HTMLDivElement | null>
  onVisible: (pageNumber: number, ratio: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [near, setNear] = useState(pageNumber <= 2)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNumber).then((p) => !cancelled && setPage(p))
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  // Tegn først når siden er i nærheten av skjermen, og slipp lerretet igjen når
  // den er langt unna — et langt partitur på en iPad ville ellers brukt opp
  // minnet Safari gir lerreter. Rapporter også hvor mye som synes («side 2 av 3»).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const near = new IntersectionObserver(([e]) => e && setNear(e.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '150% 0px',
    })
    const seen = new IntersectionObserver(([e]) => e && onVisible(pageNumber, e.intersectionRatio), {
      root: scrollRoot.current,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    })
    near.observe(el)
    seen.observe(el)
    return () => {
      near.disconnect()
      seen.disconnect()
    }
  }, [pageNumber, scrollRoot, onVisible])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (!near) {
      // 0×0 frigjør lerretets minne; siden beholder plassen sin (høyden står på boksen).
      el.width = 0
      el.height = 0
      setRendered(false)
      return
    }
    if (!page || width === 0) return
    const base = page.getViewport({ scale: 1 })
    let scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 3)
    const pixels = base.width * base.height * scale * scale
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
    const viewport = page.getViewport({ scale })
    el.width = Math.floor(viewport.width)
    el.height = Math.floor(viewport.height)
    let task: RenderTask | null = page.render({ canvas: el, viewport })
    task.promise.then(
      () => setRendered(true),
      () => {},
    )
    return () => {
      task?.cancel()
      task = null
    }
  }, [page, near, width])

  const aspect = page ? page.getViewport({ scale: 1 }).height / page.getViewport({ scale: 1 }).width : Math.SQRT2

  return (
    <div
      ref={box}
      className="relative mx-auto overflow-hidden rounded-[3px] bg-white shadow-[0_2px_18px_rgba(0,0,0,0.45)]"
      style={{ width, height: Math.round(width * aspect) }}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Side ${pageNumber}`} />
      {!rendered && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="spinner text-[#8e8468]" aria-hidden />
        </span>
      )}
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
 */
function useStandStatusBar() {
  useEffect(() => {
    const root = document.documentElement
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = STAND_BG
    root.style.backgroundColor = STAND_BG
    return () => {
      root.style.backgroundColor = ''
      applyTheme(resolveTheme(readThemeMode()))
    }
  }, [])
}
