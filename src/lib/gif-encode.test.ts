import { describe, expect, it } from 'vitest'
import { changedPixels, encodeGif, indexFrame, createColorCache } from './gif-encode'
import { sniffImage } from './message-media'

/** Går gjennom blokkene i en GIF og teller bildene — feiler hvis strukturen er ødelagt. */
function readGif(bytes: Uint8Array) {
  const ascii = String.fromCharCode(...bytes.subarray(0, 6))
  expect(ascii).toBe('GIF89a')
  const packed = bytes[10]
  let p = 13
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1))
  let frames = 0
  let loops = false
  const transparentFrames: boolean[] = []
  const skipSubBlocks = () => {
    while (bytes[p] !== 0) p += bytes[p] + 1
    p += 1
  }
  for (;;) {
    const block = bytes[p]
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = bytes[p + 1]
      if (label === 0xff && String.fromCharCode(...bytes.subarray(p + 3, p + 14)) === 'NETSCAPE2.0') loops = true
      if (label === 0xf9) transparentFrames.push((bytes[p + 3] & 1) === 1)
      p += 2
      skipSubBlocks()
    } else if (block === 0x2c) {
      frames++
      const local = bytes[p + 9]
      p += 10
      if (local & 0x80) p += 3 * (1 << ((local & 7) + 1))
      p += 1 // LZW minste kodelengde
      skipSubBlocks()
    } else {
      throw new Error(`Ukjent blokk 0x${block.toString(16)} ved ${p}`)
    }
  }
  return { frames, loops, transparentFrames }
}

/** Et lite bilde med en gradient som flytter seg `shift` piksler. */
function gradient(width: number, height: number, shift: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      px[p] = ((x + shift) * 16) % 256
      px[p + 1] = y * 20
      px[p + 2] = 128
      px[p + 3] = 255
    }
  }
  return px
}

describe('GIF-koderen', () => {
  const width = 16
  const height = 8
  const frames = [0, 1, 2, 3].map((s) => gradient(width, height, s))

  it('lager en gyldig GIF som looper, med riktige mål og ett bilde per plass i rekkefølgen', async () => {
    const bytes = await encodeGif({
      count: 4,
      width,
      height,
      getFrame: async (i) => frames[i],
      order: [0, 1, 2, 3, 2, 1],
      delayCs: 7,
    })
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/gif', width, height })
    const gif = readGif(bytes)
    expect(gif.frames).toBe(6)
    expect(gif.loops).toBe(true)
    // Første bilde er helt; resten tegnes oppå med gjennomsiktige «uendret»-piksler.
    expect(gif.transparentFrames).toEqual([false, true, true, true, true, true])
  })

  it('avbrytes', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      encodeGif({ count: 4, width, height, getFrame: async (i) => frames[i], order: [0, 1, 2, 3], delayCs: 7, signal: ctrl.signal }),
    ).rejects.toThrow(/Avbrutt/)
  })

  it('melder fremdrift helt til 1', async () => {
    const seen: number[] = []
    await encodeGif({ count: 2, width, height, getFrame: async (i) => frames[i], order: [0, 1], delayCs: 7, onProgress: (d) => seen.push(d) })
    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('like farger i like piksler gir like indekser (ditheringen står stille)', () => {
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
      [128, 128, 128],
    ]
    const cache = createColorCache()
    const a = indexFrame(frames[0], width, height, palette, cache)
    const b = indexFrame(frames[0], width, height, palette, cache)
    expect(b).toEqual(a)
  })

  it('bare piksler som faktisk endrer seg, sendes', () => {
    const palette = [
      [0, 0, 0],
      [4, 4, 4], // nesten svart: regnes som uendret
      [255, 255, 255],
      [0, 0, 0], // gjennomsiktig plass
    ]
    const shown = new Uint8Array([0, 0, 0, 2])
    const out = changedPixels(new Uint8Array([0, 1, 2, 2]), shown, palette, 3)
    expect([...out]).toEqual([3, 3, 2, 3])
    expect([...shown]).toEqual([0, 0, 2, 2])
  })
})
