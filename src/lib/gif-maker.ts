/**
 * «Lag GIF fra video» i Tertnes-fanen: reglene for utsnitt, zoom, klipp, fart
 * og loop. Rene funksjoner uten DOM, testet i gif-maker.test.ts.
 *
 * Videoen forlater aldri enheten. Nettleseren spiller den av, henter bildene
 * (src/lib/video-frames.ts) og koder GIF-en (src/lib/gif-encode.ts). Bare den
 * ferdige GIF-en lastes opp, som en vanlig GIF i samlingen.
 *
 * Alle tider er sekunder i videoen. Utsnittet er et rektangel i videoens egne
 * piksler (`videoWidth` × `videoHeight`, etter rotasjon).
 */

/** Formen på GIF-en. «Original» er videoens egen. */
export const CROP_ASPECTS = ['original', '1:1', '4:5', '4:3', '16:9'] as const
export type CropAspect = (typeof CROP_ASPECTS)[number]
export const CROP_ASPECT_LABEL: Record<CropAspect, string> = {
  original: 'Original',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
  '16:9': '16:9',
}

export const MAX_ZOOM = 4

/** Fart: avspillingen av klippet i GIF-en. */
export const SPEEDS = ['0.5', '1', '2'] as const
export type Speed = (typeof SPEEDS)[number]
export const SPEED_LABEL: Record<Speed, string> = { '0.5': '½×', '1': '1×', '2': '2×' }
export const speedValue = (speed: Speed): number => Number(speed)

/** Hvordan klippet går rundt. */
export const LOOP_MODES = ['forward', 'pingpong', 'reverse'] as const
export type LoopMode = (typeof LOOP_MODES)[number]
export const LOOP_MODE_LABEL: Record<LoopMode, string> = {
  forward: 'Vanlig',
  pingpong: 'Frem og tilbake',
  reverse: 'Baklengs',
}

/** Størrelsen på GIF-en: lengste side i piksler. Aldri større enn utsnittet. */
export const GIF_SIZES = ['small', 'medium', 'large'] as const
export type GifSize = (typeof GIF_SIZES)[number]
export const GIF_SIZE_LABEL: Record<GifSize, string> = { small: 'Liten', medium: 'Middels', large: 'Stor' }
export const GIF_SIZE_SIDE: Record<GifSize, number> = { small: 320, medium: 480, large: 640 }
/** Bildene hentes i største størrelse, så størrelsen kan velges etterpå uten å hente på nytt. */
export const CAPTURE_MAX_SIDE = GIF_SIZE_SIDE.large

/** Korteste klipp. */
export const MIN_CLIP_SECONDS = 0.3
/**
 * Lengste GIF slik den spilles av (etter fart, før «frem og tilbake»). Lenger
 * enn dette blir sjelden under 10 MB-taket, og en GIF er en replikk, ikke en film.
 */
export const MAX_GIF_SECONDS = 8
/** Hvor mye av videoen tidslinjen viser om gangen; en lengre video får en glider for «hvor i videoen». */
export const TRACK_SPAN_SECONDS = 30
/**
 * Tiden mellom bildene i GIF-en, i hundredels sekunder (GIF regner i dem):
 * 7 gir ~14 bilder i sekundet — mykt nok, og halvparten av filen til 30 bilder.
 */
export const FRAME_DELAY_CS = 7

export type Rect = { x: number; y: number; w: number; h: number }
export type Trim = { start: number; end: number }
/** Hva som er valgt i utsnittet: form, zoom og midtpunktet (0–1 av videoens bredde/høyde). */
export type CropView = { aspect: CropAspect; zoom: number; cx: number; cy: number }

export const INITIAL_VIEW: CropView = { aspect: 'original', zoom: 1, cx: 0.5, cy: 0.5 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Bredde/høyde for formen. */
export function aspectValue(aspect: CropAspect, videoWidth: number, videoHeight: number): number {
  if (aspect === 'original') return videoWidth / videoHeight
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}

/** Det største rektangelet med formen som får plass i videoen (zoom 1). */
function baseSize(aspect: CropAspect, vw: number, vh: number): { w: number; h: number } {
  const a = aspectValue(aspect, vw, vh)
  return a > vw / vh ? { w: vw, h: vw / a } : { w: vh * a, h: vh }
}

/** Utsnittet i videoens piksler — alltid helt innenfor videoen. */
export function cropRect(view: CropView, vw: number, vh: number): Rect {
  const base = baseSize(view.aspect, vw, vh)
  const zoom = clamp(view.zoom, 1, MAX_ZOOM)
  const w = base.w / zoom
  const h = base.h / zoom
  return {
    x: clamp(view.cx * vw - w / 2, 0, vw - w),
    y: clamp(view.cy * vh - h / 2, 0, vh - h),
    w,
    h,
  }
}

/**
 * Samme utsnitt, med midtpunktet flyttet dit utsnittet faktisk står. Lagres
 * alltid slik: ellers ville et drag forbi kanten blitt en «død sone» man
 * måtte dra tilbake gjennom før bildet flyttet seg.
 */
export function clampView(view: CropView, vw: number, vh: number): CropView {
  const r = cropRect(view, vw, vh)
  return { aspect: view.aspect, zoom: clamp(view.zoom, 1, MAX_ZOOM), cx: (r.x + r.w / 2) / vw, cy: (r.y + r.h / 2) / vh }
}

/**
 * Dra i bildet: innholdet følger fingeren. `dx`/`dy` er skjermpiksler, og
 * `displayWidth` er hvor bredt utsnittet vises på skjermen.
 */
export function panView(view: CropView, dx: number, dy: number, displayWidth: number, vw: number, vh: number): CropView {
  const r = cropRect(view, vw, vh)
  const k = r.w / Math.max(1, displayWidth)
  return clampView({ ...view, cx: view.cx - (dx * k) / vw, cy: view.cy - (dy * k) / vh }, vw, vh)
}

/**
 * Zoom med et fast punkt — fingrene, musepekeren eller midten. `u`/`v` er
 * punktets plass i utsnittet (0–1); det samme stedet i videoen blir stående under det.
 */
export function zoomView(view: CropView, zoom: number, u: number, v: number, vw: number, vh: number): CropView {
  const r = cropRect(view, vw, vh)
  const px = r.x + u * r.w
  const py = r.y + v * r.h
  const z = clamp(zoom, 1, MAX_ZOOM)
  const base = baseSize(view.aspect, vw, vh)
  const w = base.w / z
  const h = base.h / z
  return clampView({ aspect: view.aspect, zoom: z, cx: (px - u * w + w / 2) / vw, cy: (py - v * h + h / 2) / vh }, vw, vh)
}

/** Ny form; zoom og midtpunkt beholdes så langt det går. */
export function withAspect(view: CropView, aspect: CropAspect, vw: number, vh: number): CropView {
  return clampView({ ...view, aspect }, vw, vh)
}

/** Pikselstørrelsen på et utsnitt med lengste side høyst `maxSide`. Forstørrer aldri. */
export function outputSize(crop: Pick<Rect, 'w' | 'h'>, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(crop.w, crop.h))
  return { width: Math.max(2, Math.round(crop.w * scale)), height: Math.max(2, Math.round(crop.h * scale)) }
}

/** Neste størrelse ned, eller null når det er den minste. */
export function smallerSize(size: GifSize): GifSize | null {
  const i = GIF_SIZES.indexOf(size)
  return i > 0 ? GIF_SIZES[i - 1] : null
}

// ---------- Klipp ----------

/** Lengste klipp i videoen for en fart: ved 2× rekker man dobbelt så mye på samme GIF-lengde. */
export function maxClipSeconds(speed: Speed): number {
  return MAX_GIF_SECONDS * speedValue(speed)
}

/** Korteste klipp — eller hele videoen, når den er kortere enn det. */
const minClip = (lo: number, hi: number) => Math.min(MIN_CLIP_SECONDS, hi - lo)

/**
 * Det tidslinjen viser: hele videoen, eller `TRACK_SPAN_SECONDS` av den fra `from`.
 * Klippet holdes alltid innenfor.
 */
export type TrackWindow = { from: number; to: number }

export function trackWindow(from: number, duration: number): TrackWindow {
  if (duration <= TRACK_SPAN_SECONDS) return { from: 0, to: duration }
  const start = clamp(from, 0, duration - TRACK_SPAN_SECONDS)
  return { from: start, to: start + TRACK_SPAN_SECONDS }
}

/** Utgangspunktet: de første fire sekundene (eller hele videoen, når den er kortere). */
export function initialTrim(duration: number, speed: Speed): Trim {
  return { start: 0, end: Math.min(duration, 4, maxClipSeconds(speed)) }
}

/**
 * Flytt én kant. Den andre kanten følger med når klippet ellers ville blitt
 * for kort eller for langt — man kan alltid dra dit man vil.
 */
export function moveTrimEdge(trim: Trim, edge: 'start' | 'end', t: number, track: TrackWindow, maxLen: number): Trim {
  const min = minClip(track.from, track.to)
  if (edge === 'start') {
    const start = clamp(t, track.from, track.to - min)
    const end = clamp(trim.end, start + min, Math.min(track.to, start + maxLen))
    return { start, end }
  }
  const end = clamp(t, track.from + min, track.to)
  const start = clamp(trim.start, Math.max(track.from, end - maxLen), end - min)
  return { start, end }
}

/** Flytt hele klippet like langt, innenfor tidslinjen. */
export function shiftTrim(trim: Trim, delta: number, track: TrackWindow): Trim {
  const len = trim.end - trim.start
  const start = clamp(trim.start + delta, track.from, track.to - len)
  return { start, end: start + len }
}

/** Gjør et klipp gyldig igjen etter at farten (og dermed lengste klipp) eller tidslinjen er endret. */
export function fitTrim(trim: Trim, track: TrackWindow, maxLen: number): Trim {
  const min = minClip(track.from, track.to)
  const len = clamp(trim.end - trim.start, min, Math.min(maxLen, track.to - track.from))
  const start = clamp(trim.start, track.from, track.to - len)
  return { start, end: start + len }
}

// ---------- Bildene ----------

/**
 * Tidspunktene i videoen som blir bilder i GIF-en, jevnt fordelt over klippet.
 * Antallet følger lengden, farten og bildetiden; minst to.
 */
export function frameTimes(trim: Trim, speed: Speed, delayCs = FRAME_DELAY_CS): number[] {
  const len = Math.max(0, trim.end - trim.start)
  const n = Math.max(2, Math.round(len / ((delayCs / 100) * speedValue(speed))))
  const step = len / n
  return Array.from({ length: n }, (_, i) => trim.start + i * step)
}

/** Rekkefølgen bildene vises i. «Frem og tilbake» gjentar ikke endene, så loopen ikke hakker. */
export function frameOrder(count: number, mode: LoopMode): number[] {
  const forward = Array.from({ length: count }, (_, i) => i)
  if (mode === 'reverse') return forward.reverse()
  if (mode === 'pingpong' && count > 2) return [...forward, ...forward.slice(1, -1).reverse()]
  return forward
}

/** Hvor lenge én runde av GIF-en varer, i sekunder. */
export function gifSeconds(frames: number, delayCs = FRAME_DELAY_CS): number {
  return (frames * delayCs) / 100
}

// ---------- Visning ----------

/** «0:04,2» — minutter, sekunder og tideler, med komma. */
export function formatClipTime(t: number): string {
  const tenths = Math.max(0, Math.round(t * 10))
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')},${tenths % 10}`
}

/** «2,8 s». */
export function formatSeconds(t: number): string {
  return `${(Math.round(t * 10) / 10).toFixed(1).replace('.', ',')} s`
}

/** Er dette en video? iPhone sender `video/quicktime`; noen nettlesere gir tom type, da avgjør endelsen. */
export function isVideoFile(file: { type: string; name: string }): boolean {
  if (file.type) return file.type.toLowerCase().startsWith('video/')
  return /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name)
}
