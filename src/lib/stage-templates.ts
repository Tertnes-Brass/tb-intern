/**
 * Ferdige utgangspunkt for et nytt sceneoppsett. Malen bygges på serveren når
 * oppsettet opprettes (rene data, se `stage-elements.ts`), og er bare en start
 * — alt kan flyttes, slettes og legges til i editoren etterpå.
 *
 * Koordinater: scenekanten mot salen er y = 0, scenen strekker seg oppover
 * (negativ y), og x = 0 er midt på scenen. Alt måles i meter og ganges med
 * {@link STAGE_SCALE}.
 */
import {
  type StageSection,
  audienceMarker,
  buildStageComponent,
  chairWithStand,
  scaleBar,
  stageOutline,
  timpaniSet,
} from './stage-components'
import { type ElementContext, type SceneElement, STAGE_SCALE, elementContext } from './stage-elements'

export const STAGE_TEMPLATES = [
  {
    id: 'brass-band',
    label: 'Brass band',
    hint: 'Full besetning i vanlig brass band-oppstilling, med slagverket bak',
    title: 'Korpsoppsett',
    size: { width: 12, depth: 8 },
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
    hint: 'Bare scenen, dirigenten og publikum',
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

type Seat = [label: string, section: StageSection, x: number, y: number]

/**
 * Vanlig brass band-oppstilling sett ovenfra, publikum nederst: solokornettene
 * på første rad til venstre med førstekornett nærmest dirigenten, resten av
 * kornettene bak dem, horn og barytoner i midten, eufoniene foran til høyre,
 * tromboner til høyre, bassene bak i midten og slagverket bakerst.
 */
const BRASS_BAND_SEATS: Seat[] = [
  // Første rad
  ['Solo 4', 'cornet', -3.4, -1.7],
  ['Solo 3', 'cornet', -2.55, -1.7],
  ['Solo 2', 'cornet', -1.7, -1.7],
  ['Solo 1', 'cornet', -0.85, -1.7],
  ['Euf 1', 'euph-bari', 0.85, -1.7],
  ['Euf 2', 'euph-bari', 1.7, -1.7],
  // Andre rad
  ['2. kor', 'cornet', -3.4, -2.6],
  ['Repiano', 'cornet', -2.55, -2.6],
  ['Sopran', 'cornet', -1.7, -2.6],
  ['Solohorn', 'horn', -0.85, -2.6],
  ['1. horn', 'horn', 0, -2.6],
  ['2. horn', 'horn', 0.85, -2.6],
  ['1. trb', 'trombone', 1.7, -2.6],
  ['2. trb', 'trombone', 2.55, -2.6],
  ['B.trb', 'trombone', 3.4, -2.6],
  // Tredje rad
  ['3. kor', 'cornet', -3.4, -3.5],
  ['2. kor', 'cornet', -2.55, -3.5],
  ['Flygel', 'horn', -1.7, -3.5],
  ['1. bar', 'euph-bari', -0.45, -3.5],
  ['2. bar', 'euph-bari', 0.45, -3.5],
  // Fjerde rad
  ['3. kor', 'cornet', -3.4, -4.4],
  ['Eb-bass', 'tuba', -1.3, -4.4],
  ['Eb-bass', 'tuba', -0.45, -4.4],
  ['Bb-bass', 'tuba', 0.45, -4.4],
  ['Bb-bass', 'tuba', 1.3, -4.4],
]

function place(id: string, x: number, y: number, ctx: ElementContext) {
  return buildStageComponent(id, { x: m(x), y: m(y) }, ctx)
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

function brassBand(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  const seats = BRASS_BAND_SEATS.flatMap(([text, section, x, y]) =>
    chairWithStand(ctx, { cx: m(x), cy: m(y), label: text, section, facing: CONDUCTOR }),
  )
  const percussion = [
    ...timpaniSet(ctx, { cx: m(-3.0), cy: m(-7.0), sizes: [32, 29, 26, 23] }),
    ...place('bass-drum', -0.9, -6.3, ctx),
    ...place('cymbal', -0.9, -7.2, ctx),
    ...place('snare', 0.05, -6.3, ctx),
    ...place('drum-kit', 1.35, -6.7, ctx),
    ...place('xylophone', 3.4, -6.0, ctx),
    ...place('glockenspiel', 3.4, -6.75, ctx),
    ...place('tubular-bells', 5.0, -6.4, ctx),
    ...place('trap-table', 3.4, -7.45, ctx),
  ]
  return [...frame(ctx, width, depth), ...conductor(ctx), ...seats, ...percussion]
}

function percussion(ctx: ElementContext, width: number, depth: number): SceneElement[] {
  return [
    ...frame(ctx, width, depth),
    ...place('marimba', -2.5, -3.3, ctx),
    ...place('tubular-bells', -0.2, -3.45, ctx),
    ...place('tam-tam', 1.0, -3.3, ctx),
    ...place('drum-kit', 2.85, -2.95, ctx),
    ...timpaniSet(ctx, { cx: m(-2.4), cy: m(-2.15), sizes: [32, 29, 26, 23] }),
    ...place('bass-drum', -0.35, -1.35, ctx),
    ...place('snare', 0.6, -1.3, ctx),
    ...place('cymbal', 0.6, -2.15, ctx),
    ...place('trap-table', -0.35, -2.3, ctx),
    ...place('xylophone', 1.85, -1.05, ctx),
    ...place('glockenspiel', 3.35, -1.05, ctx),
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
    case 'brass-band':
      return brassBand(ctx, width, depth)
    case 'percussion':
      return percussion(ctx, width, depth)
    case 'empty':
      return empty(ctx, width, depth)
  }
}
