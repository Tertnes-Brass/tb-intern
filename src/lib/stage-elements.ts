/**
 * En liten fabrikk for Excalidraw-elementer — uten Excalidraw.
 *
 * Komponentene og malene i sceneoppsettet (`stage-components.ts`,
 * `stage-templates.ts`) bygges her, som rene data. Det gjør at serveren kan
 * lage et oppsett fra en mal uten å laste editoren (~2 MB, kun nettleser), at
 * paletten kan tegne små forhåndsvisninger uten den, og at alt kan testes i
 * Vitest.
 *
 * Elementene har alle feltene Excalidraw 0.18 forventer. Det eneste som er
 * anslått, er bredden på tekst: den måles egentlig med canvas og fonten. Det er
 * ufarlig fordi all tekst her er sentrert — midtpunktet er riktig uansett, og
 * Excalidraw måler på nytt så snart noen redigerer teksten.
 */

/** 1 meter på scenen = 100 piksler i tegningen. Rutenettet har en hovedlinje per meter. */
export const STAGE_SCALE = 100

/** Nunito — «Normal» i Excalidraw sin fontvelger. Ren og lesbar på en utskrift. */
export const STAGE_FONT_FAMILY = 6
/** Linjehøyden Excalidraw bruker for Nunito (fontens egne metrikker). */
export const STAGE_LINE_HEIGHT = 1.35

export const INK = '#1e1e1e'

/**
 * Et element slik det lagres. Bevisst løst typet: Excalidraw eier formatet, og
 * editoren kaster til sine egne typer ved grensen.
 */
export type SceneElement = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  groupIds: string[]
  isDeleted?: boolean
  locked?: boolean
  customData?: Record<string, unknown>
  [key: string]: unknown
}

/** Kilde til id-er og tilfeldige tall. Testene sender inn en deterministisk. */
export type ElementContext = {
  id: () => string
  int: () => number
  now: number
}

/** 64 tegn — `byte & 63` gir da hvert tegn like ofte (en `%` ville ikke det). */
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'

export function randomElementId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(21))
  let out = ''
  for (const b of bytes) out += ID_ALPHABET[b & 63]
  return out
}

export function elementContext(): ElementContext {
  return {
    id: randomElementId,
    int: () => crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
    now: Date.now(),
  }
}

type Common = {
  groupIds?: string[]
  customData?: Record<string, unknown>
  locked?: boolean
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch'
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  opacity?: number
}

function base(ctx: ElementContext, type: string, opts: Common) {
  const el: SceneElement = {
    id: ctx.id(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: opts.strokeColor ?? INK,
    backgroundColor: opts.backgroundColor ?? 'transparent',
    fillStyle: opts.fillStyle ?? 'solid',
    strokeWidth: opts.strokeWidth ?? 1,
    strokeStyle: opts.strokeStyle ?? 'solid',
    // 0 = «arkitekt»: rette streker. En arrangør skal lese en plan, ikke en skisse.
    roughness: 0,
    opacity: opts.opacity ?? 100,
    groupIds: [...(opts.groupIds ?? [])],
    frameId: null,
    index: null,
    roundness: null,
    seed: ctx.int(),
    version: 1,
    versionNonce: ctx.int(),
    isDeleted: false,
    boundElements: null,
    updated: ctx.now,
    link: null,
    locked: opts.locked ?? false,
  }
  if (opts.customData) el.customData = { ...opts.customData }
  return el
}

const round = (n: number) => Math.round(n * 100) / 100

export function rect(
  ctx: ElementContext,
  o: Common & { x: number; y: number; width: number; height: number; rounded?: boolean },
): SceneElement {
  const el = base(ctx, 'rectangle', o)
  el.x = round(o.x)
  el.y = round(o.y)
  el.width = round(o.width)
  el.height = round(o.height)
  // 3 = ADAPTIVE_RADIUS, samme som «avrundede hjørner» i editoren.
  if (o.rounded) el.roundness = { type: 3 }
  return el
}

export function ellipse(
  ctx: ElementContext,
  o: Common & { cx: number; cy: number; width: number; height?: number },
): SceneElement {
  const el = base(ctx, 'ellipse', o)
  const h = o.height ?? o.width
  el.x = round(o.cx - o.width / 2)
  el.y = round(o.cy - h / 2)
  el.width = round(o.width)
  el.height = round(h)
  return el
}

/** Linje gjennom punktene (absolutte koordinater). */
export function line(
  ctx: ElementContext,
  o: Common & { points: Array<[number, number]>; arrow?: boolean },
): SceneElement {
  const el = base(ctx, o.arrow ? 'arrow' : 'line', o)
  const [x0, y0] = o.points[0]!
  const rel = o.points.map(([x, y]) => [round(x - x0), round(y - y0)] as [number, number])
  const xs = rel.map((p) => p[0])
  const ys = rel.map((p) => p[1])
  el.x = round(x0)
  el.y = round(y0)
  el.width = round(Math.max(...xs) - Math.min(...xs))
  el.height = round(Math.max(...ys) - Math.min(...ys))
  el.points = rel
  el.lastCommittedPoint = null
  el.startBinding = null
  el.endBinding = null
  el.startArrowhead = null
  el.endArrowhead = o.arrow ? 'arrow' : null
  if (o.arrow) el.elbowed = false
  el.roundness = null
  return el
}

/**
 * Anslått bredde for Nunito. Godt nok til seleksjonsrammen; selve tegningen
 * sentreres uansett riktig.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let widest = 0
  for (const lineText of text.split('\n')) {
    let w = 0
    for (const ch of lineText) {
      if (' .,:;\'!|iljIf1()[]'.includes(ch)) w += 0.3
      else if ('mwMW'.includes(ch)) w += 0.85
      else if (ch >= 'A' && ch <= 'Z') w += 0.66
      else if ('ÆØÅ'.includes(ch)) w += 0.7
      else w += 0.55
    }
    widest = Math.max(widest, w)
  }
  return round(widest * fontSize)
}

function textHeight(text: string, fontSize: number) {
  return round(text.split('\n').length * fontSize * STAGE_LINE_HEIGHT)
}

function textElement(ctx: ElementContext, text: string, fontSize: number, opts: Common) {
  const el = base(ctx, 'text', { ...opts, backgroundColor: 'transparent' })
  el.width = estimateTextWidth(text, fontSize)
  el.height = textHeight(text, fontSize)
  el.fontSize = fontSize
  el.fontFamily = STAGE_FONT_FAMILY
  el.text = text
  el.originalText = text
  el.textAlign = 'center'
  el.verticalAlign = 'middle'
  el.containerId = null
  el.autoResize = true
  el.lineHeight = STAGE_LINE_HEIGHT
  return el
}

/** Frittstående tekst, sentrert om (cx, cy). */
export function text(
  ctx: ElementContext,
  o: Common & { text: string; cx: number; cy: number; fontSize: number },
): SceneElement {
  const el = textElement(ctx, o.text, o.fontSize, o)
  el.x = round(o.cx - el.width / 2)
  el.y = round(o.cy - el.height / 2)
  return el
}

/**
 * Tekst bundet til en form: dobbeltklikk på formen redigerer teksten, og
 * teksten følger med når formen flyttes. Muterer `container` (koblingen må stå
 * på begge sider).
 */
export function label(
  ctx: ElementContext,
  container: SceneElement,
  o: Common & { text: string; fontSize: number },
): SceneElement {
  const el = textElement(ctx, o.text, o.fontSize, { ...o, groupIds: container.groupIds, locked: container.locked })
  el.containerId = container.id
  el.x = round(container.x + container.width / 2 - el.width / 2)
  el.y = round(container.y + container.height / 2 - el.height / 2)
  container.boundElements = [...((container.boundElements as unknown[]) ?? []), { type: 'text', id: el.id }]
  return el
}

/** Omsluttende rektangel for synlige elementer. */
export function bounds(elements: readonly SceneElement[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    if (el.isDeleted) continue
    // Linjer: x/y er første punkt, og de andre punktene kan ligge til venstre/over.
    const points = Array.isArray(el.points) ? (el.points as Array<[number, number]>) : null
    let xs = points ? points.map((p) => el.x + p[0]) : [el.x, el.x + el.width]
    let ys = points ? points.map((p) => el.y + p[1]) : [el.y, el.y + el.height]
    const angle = typeof el.angle === 'number' ? el.angle : 0
    if (!points && angle) {
      // En dreid form: hjørnene dreies om midten.
      const cx = el.x + el.width / 2
      const cy = el.y + el.height / 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const corners = [
        [-el.width / 2, -el.height / 2],
        [el.width / 2, -el.height / 2],
        [el.width / 2, el.height / 2],
        [-el.width / 2, el.height / 2],
      ].map(([dx, dy]) => [cx + dx! * cos - dy! * sin, cy + dx! * sin + dy! * cos] as const)
      xs = corners.map((c) => c[0])
      ys = corners.map((c) => c[1])
    }
    minX = Math.min(minX, ...xs)
    minY = Math.min(minY, ...ys)
    maxX = Math.max(maxX, ...xs)
    maxY = Math.max(maxY, ...ys)
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** Flytter elementene (nye objekter) — linjepunktene er relative og står. */
export function translate(elements: readonly SceneElement[], dx: number, dy: number): SceneElement[] {
  return elements.map((el) => ({ ...el, x: round(el.x + dx), y: round(el.y + dy) }))
}
