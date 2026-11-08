/**
 * Koder bildene fra «Lag GIF fra video» (src/lib/gif-maker.ts) til en GIF.
 * Ingen DOM: bildene kommer inn som RGBA via `getFrame`, så dette kan testes i
 * node og flyttes til en Web Worker om det trengs. Selve GIF-formatet (LZW,
 * blokker) er `gifenc`; paletten, ditheringen og «står stille»-pikslene er her.
 *
 * Tre valg som holder filen liten og bildet rolig:
 * - **Én felles palett** for hele GIF-en, laget av et utvalg av bildene. Egen
 *   palett per bilde gir flimring i flater som skulle stått stille.
 * - **Ordnet dithering** (Bayer 4×4) i stedet for feilspredning: mønsteret står
 *   stille fra bilde til bilde, så det verken «kryper» eller sprenger filen.
 * - **Piksler som står stille, sendes ikke på nytt.** En piksel som (nesten) har
 *   samme farge som den som allerede vises, blir gjennomsiktig og lar forrige
 *   bilde skinne gjennom. Lange rekker av samme verdi pakker LZW godt.
 */

import { type Palette, GIFEncoder, quantize } from 'gifenc'

export type RgbaPixels = Uint8Array | Uint8ClampedArray

/** Hvor mange bilder paletten lages av, og hvor tett de prøves (hver n-te piksel i hver retning). */
const PALETTE_FRAMES = 12
const PALETTE_STRIDE = 2
/** Styrken på ditheringen, i fargetrinn (0–255). */
const DITHER = 14
/**
 * En piksel som er nærmere enn dette (avstand i RGB) fargen som allerede vises,
 * regnes som uendret. Tar videostøy og dither som vipper uten at man ser det.
 */
const STILL_DISTANCE = 10

/** Bayer 4×4, verdier 0–15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export type EncodeOptions = {
  /** Antall ulike bilder. */
  count: number
  width: number
  height: number
  /** RGBA for bilde `i` (width × height × 4). Kalles høyst to ganger per bilde. */
  getFrame: (i: number) => Promise<RgbaPixels>
  /** Rekkefølgen bildene vises i (`frameOrder`); samme bilde kan stå flere ganger. */
  order: number[]
  /** Tid per bilde i hundredels sekunder. */
  delayCs: number
  /** 0–1. */
  onProgress?: (done: number) => void
  signal?: AbortSignal
}

/** Lar nettleseren tegne og svare mellom bildene. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Avbrutt', 'AbortError')
}

/** Én palett (høyst 255 farger — den siste plassen er gjennomsiktig) fra et utvalg av bildene. */
export function buildPalette(frames: RgbaPixels[], width: number, height: number): Palette {
  const perFrame = Math.ceil(width / PALETTE_STRIDE) * Math.ceil(height / PALETTE_STRIDE)
  const sample = new Uint8Array(perFrame * frames.length * 4)
  let o = 0
  for (const rgba of frames) {
    for (let y = 0; y < height; y += PALETTE_STRIDE) {
      for (let x = 0; x < width; x += PALETTE_STRIDE) {
        const p = (y * width + x) * 4
        sample[o] = rgba[p]
        sample[o + 1] = rgba[p + 1]
        sample[o + 2] = rgba[p + 2]
        sample[o + 3] = 255
        o += 4
      }
    }
  }
  return quantize(sample.subarray(0, o), 255, { format: 'rgb565' })
}

function nearest(r: number, g: number, b: number, palette: Palette): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]
    const dr = c[0] - r
    const dg = c[1] - g
    const db = c[2] - b
    const d = dr * dr + dg * dg + db * db
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** Et oppslag per RGB565-verdi: samme farge slås bare opp én gang for hele GIF-en. */
export function createColorCache(): Int16Array {
  return new Int16Array(65536).fill(-1)
}

/** RGBA → palettindekser, med ordnet dithering. */
export function indexFrame(rgba: RgbaPixels, width: number, height: number, palette: Palette, cache: Int16Array): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = (y & 3) * 4
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * 4
      const offset = ((BAYER4[row + (x & 3)] + 0.5) / 16 - 0.5) * DITHER
      const r = Math.min(255, Math.max(0, Math.round(rgba[p] + offset)))
      const g = Math.min(255, Math.max(0, Math.round(rgba[p + 1] + offset)))
      const b = Math.min(255, Math.max(0, Math.round(rgba[p + 2] + offset)))
      const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
      let idx = cache[key]
      if (idx < 0) {
        idx = nearest(r, g, b, palette)
        cache[key] = idx
      }
      out[i] = idx
    }
  }
  return out
}

/**
 * Det som faktisk skrives for ett bilde: pikslene som har endret seg, og
 * `transparent` der det som vises allerede er (nesten) riktig. `shown` er det
 * som vises nå, og oppdateres.
 */
export function changedPixels(frame: Uint8Array, shown: Uint8Array, palette: Palette, transparent: number): Uint8Array {
  const out = new Uint8Array(frame.length)
  const limit = STILL_DISTANCE * STILL_DISTANCE
  for (let i = 0; i < frame.length; i++) {
    const next = frame[i]
    const now = shown[i]
    if (next === now) {
      out[i] = transparent
      continue
    }
    const a = palette[next]
    const b = palette[now]
    const dr = a[0] - b[0]
    const dg = a[1] - b[1]
    const db = a[2] - b[2]
    if (dr * dr + dg * dg + db * db <= limit) {
      out[i] = transparent
    } else {
      out[i] = next
      shown[i] = next
    }
  }
  return out
}

/** Bildene i paletten, så GIF-en. Kaster `AbortError` når `signal` avbryter. */
export async function encodeGif({ count, width, height, getFrame, order, delayCs, onProgress, signal }: EncodeOptions): Promise<Uint8Array<ArrayBuffer>> {
  if (count < 1 || order.length < 1) throw new Error('Ingen bilder å lage GIF av')

  // 1. Paletten, fra et jevnt utvalg av bildene.
  const n = Math.min(PALETTE_FRAMES, count)
  const picks = [...new Set(Array.from({ length: n }, (_, k) => (n === 1 ? 0 : Math.round((k * (count - 1)) / (n - 1)))))]
  const samples: RgbaPixels[] = []
  for (const i of picks) {
    throwIfAborted(signal)
    samples.push(await getFrame(i))
  }
  const colors = buildPalette(samples, width, height)
  samples.length = 0
  const transparent = colors.length
  const palette: Palette = [...colors, [0, 0, 0]]
  const cache = createColorCache()

  // 2. Hvert bilde til indekser (holdes, for «frem og tilbake» og «baklengs» bruker dem igjen).
  const indexed: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    throwIfAborted(signal)
    indexed.push(indexFrame(await getFrame(i), width, height, palette, cache))
    onProgress?.(((i + 1) / count) * 0.8)
    await breathe()
  }

  // 3. Skriv i visningsrekkefølge. Første bilde er helt; resten bare det som endrer seg.
  const encoder = GIFEncoder()
  const shown = new Uint8Array(indexed[order[0]])
  for (let k = 0; k < order.length; k++) {
    throwIfAborted(signal)
    const frame = indexed[order[k]]
    if (k === 0) {
      encoder.writeFrame(frame, width, height, { palette, delay: delayCs * 10, repeat: 0, dispose: 1 })
    } else {
      encoder.writeFrame(changedPixels(frame, shown, palette, transparent), width, height, {
        delay: delayCs * 10,
        transparent: true,
        transparentIndex: transparent,
        dispose: 1,
      })
    }
    if (k % 8 === 7) {
      onProgress?.(0.8 + ((k + 1) / order.length) * 0.2)
      await breathe()
    }
  }
  encoder.finish()
  onProgress?.(1)
  return encoder.bytes()
}
