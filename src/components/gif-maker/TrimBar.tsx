import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { type TrackWindow, type Trim, formatClipTime, formatSeconds, moveTrimEdge, shiftTrim } from '../../lib/gif-maker'
import { seekVideo, videoReady } from '../../lib/video-frames'

/**
 * Tidslinjen i «Lag GIF fra video»: småbilder fra videoen, klippet markert med
 * to håndtak, og en strek der avspillingen er. Dra et håndtak for å flytte
 * start eller slutt (forhåndsvisningen viser bildet der), dra i det markerte
 * for å flytte hele klippet, eller trykk utenfor for å flytte det dit.
 * Håndtakene er glidere for tastaturet (piltaster: 0,1 s; med Shift: 1 s).
 */

type Part = 'start' | 'end' | 'body' | 'track'

/** Trykkflaten på et håndtak; selve streken er smalere. */
const HANDLE = 14

export function TrimBar({
  url,
  videoAspect,
  track,
  trim,
  maxLen,
  onTrim,
  onScrub,
  getTime,
  disabled,
}: {
  /** Videoens blob-adresse — småbildene hentes med en egen, usynlig video. */
  url: string
  videoAspect: number
  track: TrackWindow
  trim: Trim
  maxLen: number
  onTrim: (trim: Trim) => void
  /** Et håndtak dras: vis bildet ved `t`. `null` når man slipper. */
  onScrub: (t: number | null) => void
  /** Hvor avspillingen er nå (for streken). */
  getTime: () => number
  disabled?: boolean
}) {
  const area = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLCanvasElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<{ part: Part; x0: number; trim0: Trim; moved: boolean } | null>(null)
  const span = Math.max(0.001, track.to - track.from)
  const x = (t: number) => ((t - track.from) / span) * width
  const timeAt = (clientX: number) => {
    const rect = area.current?.getBoundingClientRect()
    if (!rect) return track.from
    return track.from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span
  }

  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Streken følger avspillingen uten å tegne komponenten på nytt.
  const trackRef = useRef(track)
  trackRef.current = track
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = playhead.current
      const w = area.current?.clientWidth ?? 0
      if (el && w) {
        const { from, to } = trackRef.current
        const t = getTime()
        const inside = t >= from && t <= to
        el.style.opacity = inside ? '1' : '0'
        el.style.transform = `translateX(${((t - from) / Math.max(0.001, to - from)) * w}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getTime])

  // Småbildene: en egen video som spoles gjennom vinduet. Feiler det (eller
  // tar for lang tid), blir tidslinjen bare stående uten bilder.
  useEffect(() => {
    const canvas = strip.current
    if (!canvas || !width) return
    let alive = true
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const timer = window.setTimeout(async () => {
      try {
        video.src = url
        video.load()
        await videoReady(video, 8000)
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const h = canvas.clientHeight
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(h * dpr)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const n = Math.min(16, Math.max(3, Math.round(width / (h * videoAspect))))
        const cell = canvas.width / n
        for (let i = 0; i < n && alive; i++) {
          await seekVideo(video, track.from + ((i + 0.5) * span) / n, 4000)
          if (!alive) return
          // «cover»: fyll cellen, skjær bort det som stikker ut.
          const vw = video.videoWidth
          const vh = video.videoHeight
          const scale = Math.max(cell / vw, canvas.height / vh)
          const sw = cell / scale
          const sh = canvas.height / scale
          ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, Math.round(i * cell), 0, Math.ceil(cell), canvas.height)
        }
      } catch {
        // Uten småbilder går det fint.
      }
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
    }
  }, [url, width, track.from, span, videoAspect])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    const part = ((e.target as HTMLElement).closest('[data-part]') as HTMLElement | null)?.dataset.part as Part | undefined
    drag.current = { part: part ?? 'track', x0: e.clientX, trim0: trim, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (part === 'start' || part === 'end') onScrub(part === 'start' ? trim.start : trim.end)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !width) return
    const dx = e.clientX - d.x0
    if (Math.abs(dx) > 3) d.moved = true
    const dt = (dx / width) * span
    if (d.part === 'start' || d.part === 'end') {
      const next = moveTrimEdge(d.trim0, d.part, (d.part === 'start' ? d.trim0.start : d.trim0.end) + dt, track, maxLen)
      onTrim(next)
      onScrub(d.part === 'start' ? next.start : next.end)
    } else if (d.part === 'body' && d.moved) {
      const next = shiftTrim(d.trim0, dt, track)
      onTrim(next)
      onScrub(next.start)
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.part === 'track' && !d.moved) {
      // Trykk utenfor klippet: flytt klippet dit.
      const t = timeAt(e.clientX)
      if (t < trim.start) onTrim(shiftTrim(trim, t - trim.start, track))
      else if (t > trim.end) onTrim(shiftTrim(trim, t - trim.end, track))
    }
    onScrub(null)
  }

  const onHandleKey = (edge: 'start' | 'end') => (e: KeyboardEvent<HTMLDivElement>) => {
    const value = edge === 'start' ? trim.start : trim.end
    const step = e.shiftKey ? 1 : 0.1
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'PageDown') next = value - 1
    else if (e.key === 'PageUp') next = value + 1
    else if (e.key === 'Home') next = track.from
    else if (e.key === 'End') next = track.to
    if (next === null) return
    e.preventDefault()
    onTrim(moveTrimEdge(trim, edge, next, track, maxLen))
  }

  const startX = x(trim.start)
  const endX = x(trim.end)
  const len = trim.end - trim.start

  return (
    <div className={disabled ? 'pointer-events-none opacity-60' : ''}>
      <div
        className="relative select-none"
        style={{ paddingInline: HANDLE, touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={area} className="relative h-14 pointer-coarse:h-16">
          <canvas ref={strip} className="absolute inset-0 h-full w-full rounded-[6px] bg-paper-sunken" aria-hidden />
          {width > 0 && (
            <>
              <div className="absolute inset-y-0 left-0 rounded-l-[6px] bg-black/50" style={{ width: startX }} aria-hidden />
              <div className="absolute inset-y-0 right-0 rounded-r-[6px] bg-black/50" style={{ width: Math.max(0, width - endX) }} aria-hidden />
              <div
                data-part="body"
                className="absolute inset-y-0 cursor-grab border-y-[3px] border-brass active:cursor-grabbing"
                style={{ left: startX, width: Math.max(0, endX - startX) }}
                aria-hidden
              />
              <div
                ref={playhead}
                className="pointer-events-none absolute -top-1 -bottom-1 left-0 w-[2px] -translate-x-1/2 rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                aria-hidden
              />
              <Handle
                edge="start"
                left={startX}
                value={trim.start}
                min={track.from}
                max={track.to}
                onKeyDown={onHandleKey('start')}
              />
              <Handle edge="end" left={endX} value={trim.end} min={track.from} max={track.to} onKeyDown={onHandleKey('end')} />
            </>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between px-[14px] text-[0.75rem] text-ink-soft tabular-nums">
        <span>{formatClipTime(trim.start)}</span>
        <span className="font-semibold text-ink">{formatSeconds(len)}</span>
        <span>{formatClipTime(trim.end)}</span>
      </div>
    </div>
  )
}

function Handle({
  edge,
  left,
  value,
  min,
  max,
  onKeyDown,
}: {
  edge: 'start' | 'end'
  left: number
  value: number
  min: number
  max: number
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      data-part={edge}
      role="slider"
      tabIndex={0}
      aria-label={edge === 'start' ? 'Start på klippet' : 'Slutt på klippet'}
      aria-valuemin={Math.round(min * 10) / 10}
      aria-valuemax={Math.round(max * 10) / 10}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={formatClipTime(value)}
      onKeyDown={onKeyDown}
      // Trykkflaten er bredere enn streken (44 pt med finger), men streken
      // står alltid på utsiden av klippet, så den aldri dekker et bilde i det.
      className={`absolute inset-y-0 z-10 flex cursor-ew-resize touch-none items-center outline-offset-2 ${
        edge === 'start' ? 'justify-end' : 'justify-start'
      } w-7 pointer-coarse:w-11`}
      style={{ left, transform: edge === 'start' ? 'translateX(-100%)' : undefined }}
    >
      <span
        className={`flex h-full w-[14px] items-center justify-center bg-brass ${edge === 'start' ? 'rounded-l-[6px]' : 'rounded-r-[6px]'}`}
        aria-hidden
      >
        <span className="h-5 w-[3px] rounded-full bg-paper-raised/90" />
      </span>
    </div>
  )
}
