/**
 * PDF-laget i notestativet: lasting av dokumentet og de to måtene å vise det på.
 *
 * - `ScrollPages` («Tilpass bredde»): sidene under hverandre i full bredde.
 * - `PagedPages` («Hel side» / «To sider»): én eller to sider tilpasset boksen.
 *
 * pdf.js hentes KUN via `src/lib/pdf-loader.ts` (se AGENTS.md); her importeres
 * bare typer. Lerretene holdes små og få: rullevisningen tegner bare sider nær
 * skjermen, sidevisningen bare visningen man ser og naboene (så en vending er
 * umiddelbar), og ingen lerret er større enn `MAX_CANVAS_PIXELS`.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdfJs } from '../../lib/pdf-loader'
import { fitHeight, viewPages, viewsToRender } from '../../lib/stand-view'

// ---------- Lasting ----------

export type PdfErrorKind = 'forbidden' | 'missing' | 'offline' | 'failed'
export type PdfState =
  | { doc: PDFDocumentProxy; error: null }
  | { doc: null; error: PdfErrorKind | null }

/** Tilstanden huskes sammen med fila den gjelder: et nytt stykke viser aldri det forrige. */
type LoadState = PdfState & { fileId: string | null }

/**
 * Laster PDF-en for `fileId`. `retry()` prøver på nytt på stedet — og et
 * stativ som feilet fordi nettet var borte, prøver selv igjen når nettet er
 * tilbake.
 */
export function usePdfDocument(fileId: string | null): PdfState & { retry: () => void } {
  const [state, setState] = useState<LoadState>({ doc: null, error: null, fileId: null })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    let destroy: (() => void) | null = null
    setState({ doc: null, error: null, fileId })
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
        setState({ doc, error: null, fileId })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const status = (err as { status?: number })?.status
        const error: PdfErrorKind =
          status === 401 || status === 403
            ? 'forbidden'
            : status === 404
              ? 'missing'
              : typeof navigator !== 'undefined' && !navigator.onLine
                ? 'offline'
                : 'failed'
        setState({ doc: null, error, fileId })
      })
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [fileId, attempt])

  const current: PdfState =
    state.fileId === fileId && fileId ? state : { doc: null, error: null }

  // Uten nett: prøv igjen av seg selv i det nettet kommer tilbake.
  const error = current.error
  useEffect(() => {
    if (error !== 'offline' && error !== 'failed') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [error, retry])

  return { ...current, retry }
}

// ---------- Tegning ----------

/** Største lerret vi lager (piksler). iOS gir opp rundt 16,7 millioner. */
export const MAX_CANVAS_PIXELS = 12_000_000

/** Tegn `page` i `cssWidth` CSS-piksler bredt, skarpt på skjermen, men innenfor taket. */
function renderToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number): RenderTask {
  const base = page.getViewport({ scale: 1 })
  let scale = (cssWidth / base.width) * Math.min(window.devicePixelRatio || 1, 3)
  const pixels = base.width * base.height * scale * scale
  if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
  const viewport = page.getViewport({ scale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  return page.render({ canvas, viewport })
}

/** 0×0 frigjør lerretets minne; boksen rundt beholder plassen. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

function aspectOf(page: PDFPageProxy | null | undefined): number {
  if (!page) return 1 / Math.SQRT2
  const vp = page.getViewport({ scale: 1 })
  return vp.width / vp.height
}

function usePage(doc: PDFDocumentProxy, pageNumber: number): PDFPageProxy | null {
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  useEffect(() => {
    let cancelled = false
    setPage(null)
    doc.getPage(pageNumber).then(
      (p) => !cancelled && setPage(p),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])
  return page
}

// ---------- Tilpass bredde (rull) ----------

/**
 * Sidene under hverandre i full bredde. Uendret fra før visningsvalget kom:
 * rapporterer hvilken side som synes mest («side 2 av 3»), og tegner bare
 * sidene nær skjermen. `initialPage` ruller dit når man bytter fra en
 * sidevisning, så man står på samme side.
 */
export function ScrollPages({
  doc,
  scrollRoot,
  onPage,
  initialPage,
}: {
  doc: PDFDocumentProxy
  scrollRoot: React.RefObject<HTMLDivElement | null>
  onPage: (current: number, total: number) => void
  initialPage?: number
}) {
  const [width, setWidth] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const visible = useRef(new Map<number, number>())

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
  const total = doc.numPages
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
    if (total) onPageRef.current(initialPage && initialPage <= total ? initialPage : 1, total)
    // initialPage gjelder bare første tegning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  return (
    <div ref={wrap}>
      {width === 0 ? (
        <Spinner />
      ) : (
        <div className="space-y-2 sm:space-y-4">
          {Array.from({ length: total }, (_, i) => (
            <ScrollPage
              key={i}
              doc={doc}
              pageNumber={i + 1}
              width={width}
              scrollRoot={scrollRoot}
              onVisible={reportVisible}
              scrollIntoView={initialPage === i + 1 && i > 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScrollPage({
  doc,
  pageNumber,
  width,
  scrollRoot,
  onVisible,
  scrollIntoView,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  scrollRoot: React.RefObject<HTMLDivElement | null>
  onVisible: (pageNumber: number, ratio: number) => void
  scrollIntoView: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const page = usePage(doc, pageNumber)
  const [near, setNear] = useState(pageNumber <= 2)
  const [rendered, setRendered] = useState(false)

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

  // Bytte fra sidevisning: rull hit når sidens høyde er kjent.
  const scrolled = useRef(false)
  useEffect(() => {
    if (!scrollIntoView || !page || scrolled.current) return
    scrolled.current = true
    requestAnimationFrame(() => box.current?.scrollIntoView({ block: 'start' }))
  }, [scrollIntoView, page])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (!near) {
      releaseCanvas(el)
      setRendered(false)
      return
    }
    if (!page || width === 0) return
    let task: RenderTask | null = renderToCanvas(page, el, width)
    task.promise.then(
      () => setRendered(true),
      () => {},
    )
    return () => {
      task?.cancel()
      task = null
    }
  }, [page, near, width])

  return (
    <div
      ref={box}
      className="stand-paper relative mx-auto overflow-hidden rounded-[3px] shadow-[0_2px_18px_rgba(0,0,0,0.45)]"
      style={{
        width,
        height: Math.round(width / aspectOf(page)),
        scrollMarginTop: 'calc(env(safe-area-inset-top) + 64px)',
      }}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Side ${pageNumber}`} />
      {!rendered && <PageSpinner />}
    </div>
  )
}

// ---------- Hel side / To sider ----------

/** Mellomrommet mellom to sider i et oppslag — som ryggen i en perm. */
const SPREAD_GAP = 10

/**
 * Én eller to sider tilpasset boksen, sentrert. Visningen man ser og naboene
 * tegnes (de andre er usynlige), så en bladvending bytter bare hvilken som
 * vises. Hver visning har nøkkelen til første side, så lerretet til «neste»
 * blir det samme lerretet når den blir «nå» — ingenting tegnes på nytt.
 */
export function PagedPages({ doc, start, perView }: { doc: PDFDocumentProxy; start: number; perView: 1 | 2 }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (!rect) return
      const width = Math.round(rect.width / 4) * 4
      const height = Math.round(rect.height / 4) * 4
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const total = doc.numPages
  return (
    <div ref={box} className="relative h-full w-full">
      {size.width > 0 &&
        viewsToRender(start, total, perView).map((viewStart) => (
          <PagedView
            key={viewStart}
            doc={doc}
            pages={viewPages(viewStart, total, perView)}
            box={size}
            current={viewStart === start}
          />
        ))}
    </div>
  )
}

function PagedView({
  doc,
  pages,
  box,
  current,
}: {
  doc: PDFDocumentProxy
  pages: number[]
  box: { width: number; height: number }
  current: boolean
}) {
  const first = usePage(doc, pages[0]!)
  const second = usePage(doc, pages[1] ?? pages[0]!)
  const proxies = pages.length === 2 ? [first, second] : [first]
  const height = fitHeight(
    proxies.map((p) => aspectOf(p)),
    box.width,
    box.height,
    SPREAD_GAP,
  )
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ gap: SPREAD_GAP, visibility: current ? 'visible' : 'hidden' }}
      aria-hidden={!current}
    >
      {proxies.map((p, i) => (
        <FittedPage key={pages[i]} page={p} pageNumber={pages[i]!} height={height} />
      ))}
    </div>
  )
}

function FittedPage({ page, pageNumber, height }: { page: PDFPageProxy | null; pageNumber: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  const width = Math.round(height * aspectOf(page))

  useEffect(() => {
    const el = canvas.current
    if (!el || !page || width === 0) return
    let task: RenderTask | null = renderToCanvas(page, el, width)
    task.promise.then(
      () => setRendered(true),
      () => {},
    )
    return () => {
      task?.cancel()
      task = null
    }
  }, [page, width])

  // Visningen faller ut av nabolaget: slipp lerretet med en gang.
  useEffect(() => {
    const el = canvas.current
    return () => {
      if (el) releaseCanvas(el)
    }
  }, [])

  return (
    <div
      className="stand-paper relative shrink-0 overflow-hidden rounded-[2px] shadow-[0_2px_24px_rgba(0,0,0,0.5)]"
      style={{ width, height }}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Side ${pageNumber}`} />
      {!rendered && <PageSpinner />}
    </div>
  )
}

// ---------- Små ting ----------

export function Spinner() {
  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <span className="spinner text-(--stand-accent)" aria-label="Laster noten" />
    </div>
  )
}

function PageSpinner() {
  return (
    <span className="absolute inset-0 grid place-items-center">
      <span className="spinner text-(--stand-paper-ink)" aria-hidden />
    </span>
  )
}
