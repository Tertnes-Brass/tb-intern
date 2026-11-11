import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  NO_ZOOM,
  type Point,
  type Size,
  type Zoom,
  clampZoom,
  dismissDim,
  dragAxis,
  isDoubleTap,
  isZoomed,
  pinch,
  settleZoom,
  shouldDismiss,
  swipeOffset,
  swipeTarget,
  toggleZoom,
  viewerCounter,
  zoomAround,
} from '../lib/image-viewer'
import { Icon } from './Icons'

/**
 * Bildeviseren: et bilde i full størrelse OVER siden, aldri en navigasjon til
 * selve bildefila. I installert app på iPhone finnes det ingen tilbakeknapp,
 * så en lenke til `/api/post-images/…` ble en blindvei man bare kom ut av ved
 * å lukke appen.
 *
 * Sveip (eller ‹ ›, piltastene) blar, knip og dobbelttrykk (dobbeltklikk,
 * ctrl+hjul) zoomer, og et drag opp eller ned (eller ×, Esc) lukker. Det er en
 * native `<dialog>` som `Modal`: øverste lag over fanelinja, fokus fanget, og
 * fokus tilbake på bildet man åpnet fra. Alltid mørk, uansett tema.
 * Geometrien bor i `src/lib/image-viewer.ts`.
 */

export type ViewerImage = {
  key: string
  src: string
  alt: string
  /** Fra KLIPYs CDN: ingen referrer, som i galleriet. */
  external?: boolean
}

/** Åpen/lukket og hvilket bilde, for den som viser en rad med bilder. */
export function useImageViewer(images: readonly ViewerImage[]) {
  const [index, setIndex] = useState<number | null>(null)
  const viewer =
    index === null || images.length === 0 ? null : (
      <ImageViewer images={images} index={Math.min(index, images.length - 1)} onIndexChange={setIndex} onClose={() => setIndex(null)} />
    )
  return { open: setIndex, viewer }
}

const GAP = 16
const EASE = 'cubic-bezier(0.2, 0.65, 0.25, 1)'

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type Gesture =
  | { kind: 'pending'; x0: number; y0: number; t0: number; onImage: boolean }
  | { kind: 'swipe'; x0: number; t0: number }
  | { kind: 'dismiss'; y0: number; t0: number }
  | { kind: 'pan'; x0: number; y0: number; start: Zoom }
  | { kind: 'pinch'; from: Point; d0: number; start: Zoom }

export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: readonly ViewerImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  /** Zoom-laget rundt bildet som vises nå. */
  const current = useRef<HTMLDivElement>(null)

  const count = images.length
  const indexRef = useRef(index)
  const zoom = useRef<Zoom>(NO_ZOOM)
  /** Hvor langt flaten er dratt sidelengs (sveip). */
  const offset = useRef(0)
  /** Hvor langt bildet er dratt opp/ned (lukk). */
  const lift = useRef(0)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const animateNext = useRef(false)
  const closing = useRef(false)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())

  // ---------- Geometri ----------

  const box = (): Size => ({ w: stage.current?.clientWidth ?? 0, h: stage.current?.clientHeight ?? 0 })
  // Visningsstørrelsen ved skala 1: offsetWidth/-Height påvirkes ikke av transform.
  const content = (): Size => {
    const img = current.current?.querySelector('img')
    return img ? { w: img.offsetWidth, h: img.offsetHeight } : { w: 0, h: 0 }
  }
  /** Fra skjermkoordinater til koordinater med origo midt på flaten. */
  const local = (p: Point): Point => {
    const r = stage.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 }
  }

  // ---------- Tegning (rett på stilen, ikke via React: ett bilde per finger-flytt) ----------

  const transition = (ms: number) => (reducedMotion() ? 'none' : `transform ${ms}ms ${EASE}`)

  const paintTrack = (animate: boolean) => {
    const el = track.current
    if (!el) return
    el.style.transition = animate ? transition(280) : 'none'
    el.style.transform = `translate3d(${-indexRef.current * (box().w + GAP) + offset.current}px, 0, 0)`
  }

  const paintZoom = (animate: boolean) => {
    const el = current.current
    if (!el) return
    const z = zoom.current
    el.style.transition = animate ? transition(240) : 'none'
    el.style.transform = `translate3d(${z.x}px, ${z.y + lift.current}px, 0) scale(${z.s})`
    stage.current?.toggleAttribute('data-zoomed', isZoomed(z))
  }

  const paintDim = (animate: boolean) => {
    const el = backdrop.current
    if (!el) return
    el.style.transition = animate && !reducedMotion() ? `opacity 240ms ${EASE}` : 'none'
    el.style.opacity = String(dismissDim(lift.current))
    dialog.current?.toggleAttribute('data-hide-chrome', lift.current !== 0)
  }

  // ---------- Åpne, bla, lukke ----------

  useLayoutEffect(() => {
    const dlg = dialog.current
    if (!dlg || dlg.open) return
    // Fokus på selve dialogen (som i Modal), så piltastene virker med en gang
    // og Safari ikke tegner en fokusring rundt ×.
    dlg.setAttribute('autofocus', '')
    dlg.showModal()
  }, [])

  useLayoutEffect(() => {
    indexRef.current = index
    zoom.current = NO_ZOOM
    offset.current = 0
    paintTrack(animateNext.current)
    animateNext.current = false
    paintZoom(false)
    // paintTrack/paintZoom leser bare refs.
  }, [index])

  useEffect(() => {
    const onResize = () => {
      paintTrack(false)
      zoom.current = clampZoom(zoom.current, content(), box())
      paintZoom(false)
    }
    // Ctrl+hjul er knipebevegelsen på en styreflate (og ctrl+hjul med mus).
    // Må være ikke-passiv for å kunne stoppe zoom av hele siden.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const at = local({ x: e.clientX, y: e.clientY })
      zoom.current = clampZoom(zoomAround(zoom.current, at, zoom.current.s * Math.exp(-e.deltaY * 0.01)), content(), box())
      paintZoom(false)
    }
    // Safari sine egne knipehendelser: uten denne kan iOS zoome hele siden
    // i stedet for bildet (touch-action: none dekker det ikke alltid).
    const onGesture = (e: Event) => e.preventDefault()
    const el = stage.current
    window.addEventListener('resize', onResize)
    el?.addEventListener('wheel', onWheel, { passive: false })
    el?.addEventListener('gesturestart', onGesture)
    el?.addEventListener('gesturechange', onGesture)
    return () => {
      window.removeEventListener('resize', onResize)
      el?.removeEventListener('wheel', onWheel)
      el?.removeEventListener('gesturestart', onGesture)
      el?.removeEventListener('gesturechange', onGesture)
    }
    // Lytterne leser bare refs.
  }, [])

  const go = (next: number) => {
    const target = Math.min(count - 1, Math.max(0, next))
    offset.current = 0
    if (target === indexRef.current) {
      paintTrack(true)
      return
    }
    // Bildet man forlater skal stå uzoomet om man blar tilbake til det.
    zoom.current = NO_ZOOM
    lift.current = 0
    paintZoom(false)
    animateNext.current = true
    onIndexChange(target)
  }

  const close = () => dialog.current?.close()

  /** Dratt langt nok: bildet glir ut av skjermen, så lukkes viseren. */
  const dismiss = (dy: number) => {
    closing.current = true
    lift.current = (dy < 0 ? -1 : 1) * box().h
    paintZoom(true)
    const el = backdrop.current
    if (el) {
      el.style.transition = reducedMotion() ? 'none' : `opacity 200ms ${EASE}`
      el.style.opacity = '0'
    }
    window.setTimeout(close, reducedMotion() ? 0 : 200)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(indexRef.current - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(indexRef.current + 1)
    }
  }

  // ---------- Fingre og mus ----------

  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()]
    return { mid: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closing.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      gesture.current = {
        kind: 'pending',
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        // Med pekerfangst er målet ved slipp flaten selv — derfor her.
        onImage: !!(e.target as HTMLElement).closest('img'),
      }
    } else if (pointers.current.size === 2) {
      // Et sveip eller drag som var i gang, viker for knipingen.
      if (offset.current) {
        offset.current = 0
        paintTrack(true)
      }
      if (lift.current) {
        lift.current = 0
        paintZoom(true)
        paintDim(true)
      }
      lastTap.current = null
      const { mid, dist } = twoFingers()
      gesture.current = { kind: 'pinch', from: mid, d0: dist, start: zoom.current }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    const g = gesture.current
    if (!g) return

    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return
      const { mid, dist } = twoFingers()
      zoom.current = pinch(g.start, g.from, mid, dist / g.d0)
      paintZoom(false)
      return
    }
    if (pointers.current.size !== 1) return

    if (g.kind === 'pending') {
      const axis = dragAxis(e.clientX - g.x0, e.clientY - g.y0)
      if (!axis) return
      lastTap.current = null
      gesture.current = isZoomed(zoom.current)
        ? { kind: 'pan', x0: g.x0, y0: g.y0, start: zoom.current }
        : axis === 'x'
          ? { kind: 'swipe', x0: g.x0, t0: g.t0 }
          : { kind: 'dismiss', y0: g.y0, t0: g.t0 }
    }

    const h = gesture.current
    if (h?.kind === 'pan') {
      zoom.current = clampZoom({ s: h.start.s, x: h.start.x + e.clientX - h.x0, y: h.start.y + e.clientY - h.y0 }, content(), box())
      paintZoom(false)
    } else if (h?.kind === 'swipe') {
      offset.current = swipeOffset(e.clientX - h.x0, indexRef.current, count)
      paintTrack(false)
    } else if (h?.kind === 'dismiss') {
      lift.current = e.clientY - h.y0
      paintZoom(false)
      paintDim(false)
    }
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    const g = gesture.current
    const cancelled = e.type === 'pointercancel'
    const now = performance.now()

    if (g?.kind === 'pinch') {
      zoom.current = settleZoom(zoom.current, content(), box())
      paintZoom(true)
      const [rest] = [...pointers.current.values()]
      // Én finger igjen: den panorerer videre fra der bildet landet.
      gesture.current = rest && pointers.current.size === 1 ? { kind: 'pan', x0: rest.x, y0: rest.y, start: zoom.current } : null
      return
    }
    if (pointers.current.size > 0) return
    gesture.current = null
    if (!g) return

    if (g.kind === 'swipe') {
      go(cancelled ? indexRef.current : swipeTarget(e.clientX - g.x0, now - g.t0, box().w, indexRef.current, count))
    } else if (g.kind === 'dismiss') {
      const dy = e.clientY - g.y0
      if (!cancelled && shouldDismiss(dy, now - g.t0)) {
        dismiss(dy)
      } else {
        lift.current = 0
        paintZoom(true)
        paintDim(true)
      }
    } else if (g.kind === 'pending' && !cancelled) {
      const tap = { t: now, x: e.clientX, y: e.clientY }
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null
        zoom.current = toggleZoom(zoom.current, local(tap), content(), box())
        paintZoom(true)
      } else {
        lastTap.current = tap
        // Med mus lukker et klikk ved siden av bildet, som bakgrunnen i Modal.
        // På berøring er det for lett å treffe i forbifarten.
        if (e.pointerType === 'mouse' && !g.onImage && !isZoomed(zoom.current)) close()
      }
    }
  }

  // Viseren står i <body> (portal), så den verken arver stilen til en
  // chatboble eller ligger inni noe med overflow. Men React-hendelser bobler
  // gjennom KOMPONENTtreet også fra en portal: uten stoppen ville et rolig
  // trykk i viseren nådd chatmeldingens «langt trykk»-meny rundt galleriet.
  const stop = (e: SyntheticEvent) => e.stopPropagation()

  return createPortal(
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label={count > 1 ? `Bilde ${viewerCounter(index, count)}` : 'Bilde'}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
    >
      <div ref={backdrop} className="image-viewer-backdrop" aria-hidden />
      <div
        ref={stage}
        className="image-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div ref={track} className="image-viewer-track">
          {images.map((image, i) => (
            <div
              key={image.key}
              className="image-viewer-slide"
              style={{ left: `calc(${i} * (100% + ${GAP}px))` }}
              aria-hidden={i !== index || undefined}
            >
              <div ref={i === index ? current : undefined} className="image-viewer-zoom">
                {/* Bare bildet og naboene lastes; resten når man blar dit. */}
                {Math.abs(i - index) <= 1 &&
                  (failed.has(image.key) ? (
                    <p className="image-viewer-error">Kunne ikke vise bildet.</p>
                  ) : (
                    <img
                      src={image.src}
                      alt={image.alt}
                      draggable={false}
                      decoding="async"
                      referrerPolicy={image.external ? 'no-referrer' : undefined}
                      onError={() => setFailed((prev) => new Set(prev).add(image.key))}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="image-viewer-bar image-viewer-top">
        {count > 1 ? (
          <span className="image-viewer-count" aria-live="polite">
            {viewerCounter(index, count)}
          </span>
        ) : (
          <span />
        )}
        <button type="button" className="image-viewer-button" onClick={close} aria-label="Lukk">
          <Icon name="close" size={22} />
        </button>
      </div>

      {count > 1 && (
        <div className="image-viewer-bar image-viewer-bottom">
          <button
            type="button"
            className="image-viewer-button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Forrige bilde"
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          {count <= 12 && (
            <span className="image-viewer-dots" aria-hidden>
              {images.map((image, i) => (
                <span key={image.key} data-current={i === index || undefined} />
              ))}
            </span>
          )}
          <button
            type="button"
            className="image-viewer-button"
            onClick={() => go(index + 1)}
            disabled={index === count - 1}
            aria-label="Neste bilde"
          >
            <Icon name="chevronRight" size={22} />
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  )
}
