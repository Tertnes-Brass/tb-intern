import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { type CropView, cropRect, panView, zoomView } from '../../lib/gif-maker'
import { drawCrop } from '../../lib/video-frames'

/**
 * Forhåndsvisningen i «Lag GIF fra video»: et lerret med akkurat utsnittet
 * GIF-en får, tegnet fra videoen hvert bilde. Rammen står stille og videoen
 * flyttes under den, som når man beskjærer et profilbilde: dra for å flytte,
 * knip (eller rull/knip på styreflaten) for å zoome. Med tastaturet: piltaster
 * flytter, + og − zoomer.
 *
 * Det som tegnes her, tegnes med samme `drawCrop` som henter bildene til GIF-en.
 */
export function CropStage({
  videoRef,
  videoWidth,
  videoHeight,
  view,
  onView,
  disabled,
  overlay,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  videoWidth: number
  videoHeight: number
  view: CropView
  onView: (view: CropView) => void
  disabled?: boolean
  /** Over bildet, f.eks. fremdriften mens bildene hentes. */
  overlay?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const crop = cropRect(view, videoWidth, videoHeight)
  const aspect = crop.w / crop.h

  // Siste utsnitt i en ref: flere fingerbevegelser kan komme før neste tegning.
  const viewRef = useRef(view)
  viewRef.current = view
  const dirty = useRef(true)
  const grid = useRef(false)
  useEffect(() => {
    dirty.current = true
  }, [view])

  // Størrelsen: hele bredden, men aldri høyere enn ~en tredel av skjermen —
  // resten av editoren skal få plass under, også på telefon.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const maxH = Math.max(160, Math.min(420, Math.round(window.innerHeight * 0.36)))
      const w = Math.min(el.clientWidth, maxH * aspect)
      setSize({ w: Math.round(w), h: Math.round(w / aspect) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [aspect])

  useEffect(() => {
    const c = canvas.current
    if (!c || !size.w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    dirty.current = true
  }, [size])

  // Tegnes når videoen spiller, spoler eller utsnittet er endret.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const markDirty = () => {
      dirty.current = true
    }
    video.addEventListener('seeked', markDirty)
    video.addEventListener('loadeddata', markDirty)
    let raf = 0
    const tick = () => {
      const c = canvas.current
      const ctx = c?.getContext('2d', { alpha: false })
      if (c && ctx && c.width && video.readyState >= 2 && (dirty.current || !video.paused)) {
        dirty.current = false
        drawCrop(ctx, video, cropRect(viewRef.current, videoWidth, videoHeight), c.width, c.height)
        if (grid.current) drawThirds(ctx, c.width, c.height)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('seeked', markDirty)
      video.removeEventListener('loadeddata', markDirty)
    }
  }, [videoRef, videoWidth, videoHeight])

  const apply = (next: CropView) => {
    viewRef.current = next
    dirty.current = true
    onView(next)
  }

  // ---------- Fingre og mus ----------

  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const local = (x: number, y: number) => {
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect || !rect.width) return { u: 0.5, v: 0.5 }
    return { u: (x - rect.left) / rect.width, v: (y - rect.top) / rect.height }
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    grid.current = true
    dirty.current = true
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const map = pointers.current
    const prev = map.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    map.set(e.pointerId, next)
    const w = size.w || 1
    if (map.size === 1) {
      apply(panView(viewRef.current, next.x - prev.x, next.y - prev.y, w, videoWidth, videoHeight))
      return
    }
    // To fingre: zoom rundt midtpunktet, og flytt med det.
    const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1]
    if (!other) return
    const before = Math.hypot(prev.x - other.x, prev.y - other.y)
    const after = Math.hypot(next.x - other.x, next.y - other.y)
    if (before < 1) return
    const midBefore = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
    const midAfter = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }
    const { u, v } = local(midBefore.x, midBefore.y)
    const zoomed = zoomView(viewRef.current, viewRef.current.zoom * (after / before), u, v, videoWidth, videoHeight)
    apply(panView(zoomed, midAfter.x - midBefore.x, midAfter.y - midBefore.y, w, videoWidth, videoHeight))
  }

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      grid.current = false
      dirty.current = true
    }
  }

  // Hjul og knip på styreflaten (som kommer som hjul med Ctrl). Må være
  // ikke-passiv for å kunne hindre at siden ruller eller zoomer.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      if (disabled) return
      e.preventDefault()
      const { u, v } = local(e.clientX, e.clientY)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      apply(zoomView(viewRef.current, viewRef.current.zoom * factor, u, v, videoWidth, videoHeight))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  })

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const step = e.shiftKey ? 40 : 10
    const w = size.w || 1
    const pan = (dx: number, dy: number) => apply(panView(viewRef.current, dx, dy, w, videoWidth, videoHeight))
    const zoom = (f: number) => apply(zoomView(viewRef.current, viewRef.current.zoom * f, 0.5, 0.5, videoWidth, videoHeight))
    const keys: Record<string, () => void> = {
      // Piltastene flytter bildet, slik en finger ville gjort.
      ArrowLeft: () => pan(step, 0),
      ArrowRight: () => pan(-step, 0),
      ArrowUp: () => pan(0, step),
      ArrowDown: () => pan(0, -step),
      '+': () => zoom(1.1),
      '=': () => zoom(1.1),
      '-': () => zoom(1 / 1.1),
    }
    const action = keys[e.key]
    if (!action) return
    e.preventDefault()
    action()
  }

  return (
    <div ref={box} className="relative flex justify-center">
      <div className="relative overflow-hidden rounded-[10px] bg-black" style={{ width: size.w || '100%', height: size.h || 200 }}>
        <canvas
          ref={canvas}
          tabIndex={disabled ? -1 : 0}
          aria-label="Utsnittet. Dra for å flytte bildet, knip eller bruk + og − for å zoome."
          className={`block h-full w-full touch-none outline-offset-2 ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
        {overlay}
      </div>
    </div>
  )
}

/** Tredjedelslinjer mens man drar — hjelp til å plassere det viktige. */
function drawThirds(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = Math.max(1, Math.round(w / 400))
  ctx.beginPath()
  for (const f of [1 / 3, 2 / 3]) {
    ctx.moveTo(Math.round(w * f), 0)
    ctx.lineTo(Math.round(w * f), h)
    ctx.moveTo(0, Math.round(h * f))
    ctx.lineTo(w, Math.round(h * f))
  }
  ctx.stroke()
  ctx.restore()
}
