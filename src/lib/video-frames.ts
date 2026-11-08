/**
 * Bildene i «Lag GIF fra video», hentet i nettleseren. Bare nettleser-API-er:
 * videoen spilles av lokalt, og ingenting her rører nettet.
 *
 * Bildene hentes ved å spole til hvert tidspunkt og tegne utsnittet på et
 * lerret. Det er tregere enn å ta bilder mens videoen spiller, men det gir
 * nøyaktig de tidspunktene `frameTimes` ba om, også når telefonen er travel.
 * Hvert bilde lagres som JPEG i minnet (noen titalls kB) i stedet for rå piksler
 * (~1 MB): to hundre bilder i full størrelse er for mye for en eldre iPhone.
 */

import type { Rect } from './gif-maker'

/** Venter til videoen har et bilde å vise. Kaster når nettleseren ikke kan spille den av. */
export function videoReady(video: HTMLVideoElement, timeoutMs = 15000): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('unplayable'))
    }
    const timer = window.setTimeout(fail, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('loadeddata', done)
    video.addEventListener('error', fail)
  })
}

/** Spoler til `t` og venter til bildet der er klart. */
export function seekVideo(video: HTMLVideoElement, t: number, timeoutMs = 8000): Promise<void> {
  if (Math.abs(video.currentTime - t) < 0.0005 && !video.seeking && video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('seek'))
    }
    const timer = window.setTimeout(fail, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('seeked', done)
    video.addEventListener('error', fail)
    video.currentTime = t
  })
}

/** Tegner utsnittet av det videoen viser nå, skalert til lerretet. */
export function drawCrop(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, crop: Rect, width: number, height: number): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height)
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.92))
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Avbrutt', 'AbortError')
}

/**
 * Henter bildene: spoler til hvert tidspunkt, tegner utsnittet i `width` ×
 * `height` og lagrer det som JPEG. `onFrame` får hvert bilde mens det kommer.
 */
export async function captureFrames({
  video,
  times,
  crop,
  width,
  height,
  onFrame,
  signal,
}: {
  video: HTMLVideoElement
  times: number[]
  crop: Rect
  width: number
  height: number
  onFrame?: (index: number, canvas: HTMLCanvasElement) => void
  signal?: AbortSignal
}): Promise<Blob[]> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('canvas')
  const frames: Blob[] = []
  for (let i = 0; i < times.length; i++) {
    throwIfAborted(signal)
    await seekVideo(video, times[i])
    throwIfAborted(signal)
    drawCrop(ctx, video, crop, width, height)
    onFrame?.(i, canvas)
    frames.push(await toJpeg(canvas))
  }
  return frames
}

/**
 * Pakker opp ett lagret bilde i ønsket størrelse. Ett lerret gjenbrukes for
 * alle bildene; `willReadFrequently` holder det i vanlig minne, der
 * `getImageData` er raskt.
 */
export function createFrameReader(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return async (frame: Blob): Promise<Uint8ClampedArray> => {
    const bitmap = await createImageBitmap(frame)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return ctx.getImageData(0, 0, width, height).data
  }
}
