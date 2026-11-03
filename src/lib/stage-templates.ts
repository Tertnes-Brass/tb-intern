/**
 * Ferdige utgangspunkt for et nytt sceneoppsett. Malen bygges på serveren når
 * oppsettet opprettes (rene data, se `stage-elements.ts`), og er bare en start
 * — alt kan flyttes, slettes og legges til i editoren etterpå. Et oppsett som
 * ikke ligner noen av malene, lages fra «Tom scene» eller ved å kopiere et
 * tidligere oppsett.
 *
 * Koordinater: scenekanten mot salen er y = 0, scenen strekker seg oppover
 * (negativ y), og x = 0 er midt på scenen. Alt måles i meter og ganges med
 * {@link STAGE_SCALE}.
 */
import { faceConductor } from './stage-arrange'
import {
  type MalletKind,
  type StageSection,
  audienceMarker,
  buildStageComponent,
  chairWithStand,
  drumKit,
  malletInstrument,
  scaleBar,
  stageOutline,
  timpaniSet,
} from './stage-components'
import { type ElementContext, type SceneElement, STAGE_SCALE, elementContext } from './stage-elements'

export const STAGE_TEMPLATES = [
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Brass band i hestesko med slagverket rundt — slik korpset vanligvis står',
    title: 'Korpsoppsett',
    size: { width: 14, depth: 9 },
  },
  {
    id: 'big-band',
    label: 'Storband',
    hint: 'Trommesettet i midten, kornettene på bakerste rad',
    title: 'Storbandoppsett',
    size: { width: 12, depth: 6 },
  },
  {
    id: 'percussion',
    label: 'Slagverk',
    hint: 'Slagverksriggen med de vanligste instrumentene',
    title: 'Slagverksoppsett',
    size: { width: 8, depth: 4 },
  },
  {
    id: 'empty',
    label: 'Tom scene',
    hint: 'Bare scenen, dirigenten og publikum — for alt som ikke ligner de andre',
    title: 'Sceneoppsett',
    size: { width: 12, depth: 8 },
  },
] as const

export type StageTemplateId = (typeof STAGE_TEMPLATES)[number]['id']

export const STAGE_TEMPLATE_IDS = STAGE_TEMPLATES.map((t) => t.id) as [StageTemplateId, ...StageTemplateId[]]

/** Grenser for scenestørrelsen i opprettelsesdialogen, i meter. */
export const STAGE_SIZE_LIMITS = { min: 2, max: 40 } as const

export function findStageTemplate(id: string) {
  return STAGE_TEMPLATES.find((t) => t.id === id)
}

const m = (meters: number) => meters * STAGE_SCALE

/** Dirigenten står her, og musikerne ser hit. */
const CONDUCTOR = { x: 0, y: m(-1.0) }

/**
 * Plassene som får en dobbel stol — en ekstra stol til instrument og dempere.
 * Regelen er Kim Systads fra standardoppsettet: sopran, repiano, 2. og 3.
 * kornett, bassene og trombonene.
 */
const DOUBLE_CHAIR = new Set(['Sopran', 'Repiano', '2. kor', '3. kor', 'Eb-bass', 'Bb-bass', '1. trb', '2. trb', 'B.trb'])

type Seat = [label: string, section: StageSection, x: number, y: number]

function seats(ctx: ElementContext, list: Seat[]): SceneElement[] {
  return list.flatMap(([text, section, x, y]) =>
    chairWithStand(ctx, {
      cx: m(x),
      cy: m(y),
      label: text,
      section,
      facing: CONDUCTOR,
      chairs: DOUBLE_CHAIR.has(text) ? 2 : 1,
    }),
  )
}

/**
 * Standardoppsettet sett ovenfra, publikum nederst — Kim Systads hestesko:
 * kornettene i to rekker langs venstre side (solokornettene innerst),
 * eufonier og barytoner innerst til høyre med trombonene utenfor, hornene
 * tvers over bak med flygelhornet i hjørnet, og bassene bak dem. Rekkene går
 * fra dirigenten og bakover.
 */
const STANDARD_SEATS: Seat[] = [
  // Venstre, ytterst
  ['Sopran', 'cornet', -3.4, -1.6],
  ['Repiano', 'cornet', -3.4, -2.4],
  ['2. kor', 'cornet', -3.4, -3.2],
  ['2. kor', 'cornet', -3.4, -4.0],
  ['3. kor', 'cornet', -3.4, -4.8],
  ['3. kor', 'cornet', -3.15, -5.6],
  // Venstre, innerst
  ['Solo 1', 'cornet', -2.3, -1.6],
  ['Solo 2', 'cornet', -2.3, -2.4],
  ['Solo 3', 'cornet', -2.3, -3.2],
  ['Solo 4', 'cornet', -2.3, -4.0],
  ['Solo 5', 'cornet', -2.3, -4.8],
  // Bak: hornene, og bassene bak dem
  ['2. horn', 'horn', -1.15, -5.0],
  ['1. horn', 'horn', 0, -5.0],
  ['Solohorn', 'horn', 1.15, -5.0],
  ['Flygel', 'horn', 2.3, -5.0],
  ['Bb-bass', 'tuba', -1.15, -5.8],
  ['Bb-bass', 'tuba', 0, -5.8],
  ['Eb-bass', 'tuba', 1.15, -5.8],
  ['Eb-bass', 'tuba', 2.3, -5.8],
  // Høyre, innerst
  ['1. euf', 'euph-bari', 2.3, -1.6],
  ['2. euf', 'euph-bari', 2.3, -2.45],
  ['1. bar', 'euph-bari', 2.3, -3.3],
  ['2. bar', 'euph-bari', 2.3, -4.15],
  // Høyre, ytterst
  ['1. trb', 'trombone', 3.4, -1.6],
  ['2. trb', 'trombone', 3.4, -2.7],
  ['B.trb', 'trombone', 3.4, -3.8],
]

/**
 * Storband: blåserne på tre rader med trommesettet midt i den midterste,
 * trombonene og bassene på hver sin side av det, og kornettene bakerst.
 */
const BIG_BAND_SEATS: Seat[] = [
  // Første rad
  ['Solohorn', 'horn', -2.7, -2.3],
  ['1. horn', 'horn', -1.8, -2.3],
  ['2. horn', 'horn', -0.9, -2.3],
  ['1. bar', 'euph-bari', 0, -2.3],
  ['2. bar', 'euph-bari', 0.9, -2.3],
  ['1. euf', 'euph-bari', 1.8, -2.3],
  ['2. euf', 'euph-bari', 2.7, -2.3],
  // Andre rad, rundt trommesettet
  ['B.trb', 'trombone', -3.3, -3.4],
  ['2. trb', 'trombone', -2.4, -3.4],
  ['1. trb', 'trombone', -1.5, -3.4],
  ['Eb-bass', 'tuba', 1.5, -3.4],
  ['Eb-bass', 'tuba', 2.4, -3.4],
  ['Bb-bass', 'tuba', 3.3, -3.4],
  ['Bb-bass', 'tuba', 4.2, -3.4],
  // Bakerste rad
  ...(
    ['Flygel', '3. kor', '3. kor', '2. kor', '2. kor', 'Repiano', 'Solo 1', 'Solo 2', 'Solo 3', 'Solo 4', 'Solo 5', 'Sopran'] as const
  ).map((text, i): Seat => [text, text === 'Flygel' ? 'horn' : 'cornet', -4.675 + i * 0.85, -5.0]),
]

function place(id: string, x: number, y: number, ctx: ElementContext) {
  return buildStageComponent(id, { x: m(x), y: m(y) }, ctx)
}

function mallet(kind: MalletKind, x: number, y: number, ctx: ElementContext) {
  return malletInstrument(ctx, kind, { cx: m(x), cy: m(y), upright: true, facing: CONDUCTOR })
}

function frame(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  return [
    ...stageOutline(ctx, { x: m(-width / 2), y: m(-depth), width: m(width), height: m(depth), locked: true }),
    ...audienceMarker(ctx, { cx: 0, cy: m(0.55), locked: true }),
    ...scaleBar(ctx, { x: m(-width / 2), y: m(0.6) }),
  ]
}

function conductor(ctx: ElementContext) {
  // Podiet ser mot korpset (oppover i tegningen).
  return place('podium', CONDUCTOR.x / STAGE_SCALE, CONDUCTOR.y / STAGE_SCALE, ctx)
}

/** Alle stativ mot dirigenten — samme regel som knappen i editoren. */
function facingConductor(ctx: ElementContext, elements: SceneElement[]): SceneElement[] {
  return faceConductor(elements, ctx).elements
}

function standard(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  const percussion = [
    // Stavspillene langs venstre side, marimbaen fremst.
    ...mallet('marimba', -5.2, -2.4, ctx),
    ...mallet('xylophone', -5.2, -4.6, ctx),
    ...mallet('vibraphone', -5.2, -6.3, ctx),
    ...mallet('glockenspiel', -5.2, -7.75, ctx),
    // Bakerste rad, med tam-tam bak cymbalene.
    ...place('snare', -1.9, -7.0, ctx),
    ...place('clash-cymbals', -0.45, -7.0, ctx),
    ...place('cymbal', 0.95, -7.0, ctx),
    ...place('bass-drum', 2.45, -7.0, ctx),
    ...place('tam-tam', 0.95, -8.2, ctx),
    // Trommesett og pauker til høyre.
    ...drumKit(ctx, { cx: m(3.9), cy: m(-6.6), facing: CONDUCTOR }),
    ...timpaniSet(ctx, { cx: m(6.2), cy: m(-4.6), sizes: [32, 29, 26, 23], facing: CONDUCTOR }),
  ]
  return facingConductor(ctx, [...frame(ctx, width, depth), ...conductor(ctx), ...seats(ctx, STANDARD_SEATS), ...percussion])
}

function bigBand(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  return facingConductor(ctx, [
    ...frame(ctx, width, depth),
    ...conductor(ctx),
    ...seats(ctx, BIG_BAND_SEATS),
    ...drumKit(ctx, { cx: 0, cy: m(-3.55), facing: CONDUCTOR }),
  ])
}

function percussion(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  return [
    ...frame(ctx, width, depth),
    ...place('marimba', -2.5, -3.3, ctx),
    ...place('tubular-bells', -0.2, -3.45, ctx),
    ...place('tam-tam', 1.0, -3.3, ctx),
    ...place('drum-kit', 2.85, -2.85, ctx),
    ...timpaniSet(ctx, { cx: m(-2.4), cy: m(-2.15), sizes: [32, 29, 26, 23] }),
    ...place('bass-drum', -0.35, -1.35, ctx),
    ...place('snare', 0.6, -1.3, ctx),
    ...place('cymbal', 0.6, -2.35, ctx),
    ...place('trap-table', -0.35, -2.4, ctx),
    ...place('xylophone', 1.85, -1.0, ctx),
    ...place('glockenspiel', 3.35, -1.0, ctx),
  ]
}

function empty(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  return [...frame(ctx, width, depth), ...conductor(ctx)]
}

export function clampStageSize(meters: number | undefined, fallback: number): number {
  if (meters == null || !Number.isFinite(meters)) return fallback
  const rounded = Math.round(meters * 10) / 10
  return Math.min(STAGE_SIZE_LIMITS.max, Math.max(STAGE_SIZE_LIMITS.min, rounded))
}

/** Bygger malen. Scenestørrelsen er i meter og klemmes innenfor {@link STAGE_SIZE_LIMITS}. */
export function buildStageTemplate(
  id: StageTemplateId,
  size: { width?: number; depth?: number } = {},
  ctx: ElementContext = elementContext(),
): SceneElement[] {
  const template = findStageTemplate(id)
  if (!template) throw new Error(`Ukjent mal: ${id}`)
  const width = clampStageSize(size.width, template.size.width)
  const depth = clampStageSize(size.depth, template.size.depth)
  switch (id) {
    case 'standard':
      return standard(ctx, width, depth)
    case 'big-band':
      return bigBand(ctx, width, depth)
    case 'percussion':
      return percussion(ctx, width, depth)
    case 'empty':
      return empty(ctx, width, depth)
  }
}
