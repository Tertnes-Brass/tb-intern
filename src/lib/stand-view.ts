/**
 * Notestativets visning: hvordan sidene i ett stykke legges ut på skjermen, og
 * hvordan man blar. Rene regler, testet i `stand-view.test.ts`.
 *
 * Tre visninger:
 * - `scroll` «Tilpass bredde»: sidene under hverandre i full bredde; rull for å
 *   lese videre. Best på telefon, der en hel side ville blitt for liten.
 * - `page` «Hel side»: én side tilpasset skjermen; man blar i stedet for å
 *   rulle. Standard på iPad stående, der en hel A4 fyller nesten hele bredden
 *   uansett — og en bladvending treffer alltid en hel side, aldri et halvt
 *   system slik en rulling på 85 % av skjermen kan gjøre.
 * - `spread` «To sider»: to sider ved siden av hverandre, som en oppslått perm.
 *   Bare når skjermen ligger og er stor nok (iPad liggende, desktop).
 *
 * Et oppslag starter alltid på en odde side (1–2, 3–4, …), slik en perm gjør.
 */

export type StandView = 'scroll' | 'page' | 'spread'
export type Orientation = 'portrait' | 'landscape'

export const VIEW_LABELS: Record<StandView, string> = {
  scroll: 'Tilpass bredde',
  page: 'Hel side',
  spread: 'To sider',
}

/** Minste skjerm (CSS-piksler) der to sider ved siden av hverandre er lesbare. */
const SPREAD_MIN_WIDTH = 900
const SPREAD_MIN_HEIGHT = 600
/** Korteste side fra og med denne regnes som nettbrett (iPad mini: 744). */
const TABLET_MIN_SIDE = 700

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait'
}

/** Er det plass til «To sider»? Liggende, og stort nok til at noten er lesbar. */
export function canSpread(width: number, height: number): boolean {
  return width > height && width >= SPREAD_MIN_WIDTH && height >= SPREAD_MIN_HEIGHT
}

/** Visningen et stativ åpner i når brukeren ikke har valgt noe for denne retningen. */
export function defaultView(width: number, height: number): StandView {
  if (canSpread(width, height)) return 'spread'
  if (orientationOf(width, height) === 'portrait' && Math.min(width, height) >= TABLET_MIN_SIDE) return 'page'
  return 'scroll'
}

/**
 * Visningen som faktisk brukes: brukerens lagrede valg for retningen, ellers
 * standarden. «To sider» faller tilbake til «Hel side» der det ikke er plass.
 */
export function resolveView(stored: string | null | undefined, width: number, height: number): StandView {
  const choice = isStandView(stored) ? stored : defaultView(width, height)
  return choice === 'spread' && !canSpread(width, height) ? 'page' : choice
}

export function isStandView(value: unknown): value is StandView {
  return value === 'scroll' || value === 'page' || value === 'spread'
}

export function viewStorageKey(orientation: Orientation): string {
  return `tb-stand-view-${orientation}`
}

export function pagesPerView(view: StandView): 1 | 2 {
  return view === 'spread' ? 2 : 1
}

/** Sentinel: «siste side i stykket», før vi vet hvor mange sider det har. */
export const LAST_PAGE = Number.POSITIVE_INFINITY

/** Første side i visningen som inneholder `page`. */
export function viewStartFor(page: number, perView: 1 | 2): number {
  const p = Math.max(1, Math.floor(page))
  return perView === 2 ? p - ((p - 1) % 2) : p
}

/** Starten på siste visning i et stykke på `total` sider. */
export function lastViewStart(total: number, perView: 1 | 2): number {
  return viewStartFor(Math.max(1, total), perView)
}

/** Gjør en ønsket start (også `LAST_PAGE`) om til en gyldig start for stykket. */
export function clampViewStart(start: number, total: number, perView: 1 | 2): number {
  if (total <= 0) return 1
  if (start >= total) return lastViewStart(total, perView)
  return viewStartFor(start, perView)
}

/** Sidene som vises fra `start`: én, eller to i et oppslag (én om det er siste side). */
export function viewPages(start: number, total: number, perView: 1 | 2): number[] {
  const pages = [start]
  if (perView === 2 && start + 1 <= total) pages.push(start + 1)
  return pages
}

export type Turn = { kind: 'page'; start: number } | { kind: 'piece'; direction: 'next' | 'prev' }

/** Neste visning, eller videre til neste stykke fra siste side. */
export function nextTurn(start: number, total: number, perView: 1 | 2): Turn {
  const next = start + perView
  return next <= total ? { kind: 'page', start: next } : { kind: 'piece', direction: 'next' }
}

/** Forrige visning, eller tilbake til forrige stykke (dets siste side) fra første. */
export function prevTurn(start: number, perView: 1 | 2): Turn {
  return start > 1 ? { kind: 'page', start: Math.max(1, start - perView) } : { kind: 'piece', direction: 'prev' }
}

/** De visningene som tegnes: den man ser, og naboene, så en vending er umiddelbar. */
export function viewsToRender(start: number, total: number, perView: 1 | 2): number[] {
  const views = [start]
  if (start + perView <= total) views.push(start + perView)
  if (start > 1) views.push(Math.max(1, start - perView))
  return views
}

/**
 * Felles høyde for sidene i en visning, så de fyller boksen uten å gå utenfor.
 * `aspects` er bredde/høyde per side; `gap` er mellomrommet mellom to sider.
 */
export function fitHeight(aspects: number[], boxWidth: number, boxHeight: number, gap = 0): number {
  if (aspects.length === 0 || boxWidth <= 0 || boxHeight <= 0) return 0
  const totalAspect = aspects.reduce((sum, a) => sum + a, 0)
  const byWidth = (boxWidth - gap * (aspects.length - 1)) / totalAspect
  return Math.max(0, Math.floor(Math.min(boxHeight, byWidth)))
}

/** Trykk på noten: venstre tredjedel blar tilbake, høyre fremover, midten viser menyene. */
export function tapZone(x: number, width: number): 'prev' | 'next' | 'center' {
  if (width <= 0) return 'center'
  if (x < width / 3) return 'prev'
  if (x > (width * 2) / 3) return 'next'
  return 'center'
}

/** «side 3 av 4», «side 3–4 av 4». */
export function pageLabel(start: number, total: number, perView: 1 | 2): string {
  if (total <= 0) return ''
  const pages = viewPages(Math.min(start, total), total, perView)
  return pages.length === 2 ? `side ${pages[0]}–${pages[1]} av ${total}` : `side ${pages[0]} av ${total}`
}

// ---------- Hjelp for bladingen ----------

/**
 * To måter å bla på: rullevisningen (sveip = neste stykke) og sidevisningene
 * «Hel side» og «To sider» (trykk/sveip = neste side). Hjelpen vises én gang
 * per måte — de to sidevisningene blar likt og deler den.
 */
export type GestureMode = 'scroll' | 'paged'

export function gestureModeOf(view: StandView): GestureMode {
  return view === 'scroll' ? 'scroll' : 'paged'
}

export function hintStorageKey(mode: GestureMode): string {
  return `tb-stand-hint-${mode}`
}

/** Verdien som lagres når hjelpen er sett. */
export const HINT_SEEN = '1'

/** Skal hjelpen vises av seg selv? Bare om den aldri er sett (eller lagringen er tom). */
export function shouldShowHint(stored: string | null | undefined): boolean {
  return stored !== HINT_SEEN
}

export type GestureHint = {
  /** Trykkfeltene fra venstre mot høyre; rullevisningen har bare ett. */
  zones: Array<{ zone: 'prev' | 'center' | 'next'; label: string }>
  swipe: string
  more: string
}

export function gestureHint(mode: GestureMode): GestureHint {
  return mode === 'paged'
    ? {
        zones: [
          { zone: 'prev', label: 'Forrige side' },
          { zone: 'center', label: 'Vis menyene' },
          { zone: 'next', label: 'Neste side' },
        ],
        swipe: 'Sveip sidelengs for å bla en side.',
        more: 'Fra siste side går du videre til neste stykke. Menyene trekker seg unna etter noen sekunder.',
      }
    : {
        zones: [{ zone: 'center', label: 'Trykk for å vise eller skjule menyene' }],
        swipe: 'Sveip sidelengs for neste eller forrige stykke.',
        more: 'Rull opp og ned for å lese. Bladvendere ruller en skjerm om gangen.',
      }
}
