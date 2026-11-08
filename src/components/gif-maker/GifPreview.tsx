import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icons'

/**
 * Den ferdige GIF-en slik den vil gå: bildene i loop-rekkefølgen, med GIF-ens
 * bildetid. Tegnes fra de lagrede bildene (ett om gangen pakkes opp), ikke fra
 * den kodede filen — fargene blir litt rikere her enn i GIF-en, men loopen,
 * farten og utsnittet er nøyaktig de samme.
 *
 * Står stille ved redusert bevegelse til man trykker «Spill av».
 */
export function GifPreview({
  frames,
  order,
  width,
  height,
  delayMs,
}: {
  frames: Blob[]
  order: number[]
  width: number
  height: number
  delayMs: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d', { alpha: false })
    if (!c || !ctx || order.length === 0) return
    let alive = true
    let timer = 0
    let k = 0
    const show = async (index: number) => {
      const bitmap = await createImageBitmap(frames[index])
      if (alive) ctx.drawImage(bitmap, 0, 0, c.width, c.height)
      bitmap.close()
    }
    const tick = async () => {
      const started = performance.now()
      try {
        await show(order[k])
      } catch {
        return
      }
      if (!alive) return
      k = (k + 1) % order.length
      timer = window.setTimeout(tick, Math.max(0, delayMs - (performance.now() - started)))
    }
    if (playing) void tick()
    else void show(order[0]).catch(() => {})
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [frames, order, delayMs, playing])

  return (
    <div className="flex justify-center rounded-[10px] bg-paper-sunken p-2">
      <div className="relative">
        <canvas
          ref={canvas}
          width={width}
          height={height}
          role="img"
          aria-label="Forhåndsvisning av GIF-en"
          className="block h-auto max-h-[42dvh] w-auto max-w-full rounded-[6px]"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Stopp forhåndsvisningen' : 'Spill av forhåndsvisningen'}
          className="absolute right-2 bottom-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          {playing ? <PauseGlyph /> : <Icon name="play" size={16} />}
        </button>
      </div>
    </div>
  )
}

export function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="2.5" y="2" width="3" height="10" rx="0.8" fill="currentColor" />
      <rect x="8.5" y="2" width="3" height="10" rx="0.8" fill="currentColor" />
    </svg>
  )
}
