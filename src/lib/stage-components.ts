/**
 * Komponentbiblioteket i sceneoppsettet: stoler med notestativ, slagverk,
 * podier og scene — ferdige grupper av Excalidraw-elementer som kan settes inn
 * med ett trykk og flyttes som én ting.
 *
 * Hver komponent merker sitt hovedelement med `customData.tb` (f.eks.
 * `'chair'`, `'timpani'`). Merket overlever kopiering, lim inn og duplisering i
 * Excalidraw, og det er det `equipmentList` teller: utstyrslisten til
 * arrangøren lages fra tegningen, ikke fra en liste noen må holde i takt med
 * den.
 *
 * Målestokk: {@link STAGE_SCALE} px per meter, og instrumentene er tegnet i
 * omtrent riktig størrelse sett ovenfra.
 */
import {
  type ElementContext,
  type SceneElement,
  STAGE_SCALE,
  bounds,
  elementContext,
  ellipse,
  label,
  line,
  rect,
  text,
  translate,
} from './stage-elements'

// ---------- Seksjoner og farger ----------

/** Samme seksjons-id-er som `SECTION_ORDER` i `taxonomy.ts`, pluss `other`. */
export type StageSection = 'cornet' | 'horn' | 'euph-bari' | 'trombone' | 'tuba' | 'perc' | 'other'

/** Lyse toner fra Excalidraw sin egen fargevelger, så de kan velges igjen der. */
export const SECTION_FILL: Record<StageSection, string> = {
  cornet: '#ffec99',
  horn: '#ffd8a8',
  'euph-bari': '#b2f2bb',
  trombone: '#a5d8ff',
  tuba: '#d0bfff',
  perc: '#ffc9c9',
  other: '#ffffff',
}

const NEUTRAL_FILL = '#e9ecef'
const CYMBAL_FILL = '#fff3bf'

// ---------- Det som telles ----------

export type StageItemKind =
  | 'chair'
  | 'stand'
  | 'stool'
  | 'podium'
  | 'riser'
  | 'timpani'
  | 'bass-drum'
  | 'snare'
  | 'drum-kit'
  | 'xylophone'
  | 'marimba'
  | 'vibraphone'
  | 'glockenspiel'
  | 'tubular-bells'
  | 'tam-tam'
  | 'cymbal'
  | 'trap-table'
  | 'power'
  | 'microphone'
  // Merket, men ikke utstyr som skal telles:
  | 'stage'
  | 'audience'
  | 'scale'

/** Utstyrslisten, i den rekkefølgen en arrangør vil lese den. */
export const COUNTED_ITEMS: ReadonlyArray<{ kind: StageItemKind; one: string; many: string }> = [
  { kind: 'chair', one: 'Stol', many: 'Stoler' },
  { kind: 'stand', one: 'Notestativ', many: 'Notestativ' },
  { kind: 'stool', one: 'Krakk', many: 'Krakker' },
  { kind: 'podium', one: 'Dirigentpodium', many: 'Dirigentpodier' },
  { kind: 'riser', one: 'Praktikabel', many: 'Praktikabler' },
  { kind: 'timpani', one: 'Pauke', many: 'Pauker' },
  { kind: 'bass-drum', one: 'Stortromme', many: 'Stortrommer' },
  { kind: 'snare', one: 'Skarptromme', many: 'Skarptrommer' },
  { kind: 'drum-kit', one: 'Trommesett', many: 'Trommesett' },
  { kind: 'xylophone', one: 'Xylofon', many: 'Xylofoner' },
  { kind: 'marimba', one: 'Marimba', many: 'Marimbaer' },
  { kind: 'vibraphone', one: 'Vibrafon', many: 'Vibrafoner' },
  { kind: 'glockenspiel', one: 'Klokkespill', many: 'Klokkespill' },
  { kind: 'tubular-bells', one: 'Rørklokker (sett)', many: 'Rørklokker (sett)' },
  { kind: 'tam-tam', one: 'Tam-tam', many: 'Tam-tam' },
  { kind: 'cymbal', one: 'Hengende cymbal', many: 'Hengende cymbaler' },
  { kind: 'trap-table', one: 'Slagverksbord', many: 'Slagverksbord' },
  { kind: 'power', one: 'Strømuttak', many: 'Strømuttak' },
  { kind: 'microphone', one: 'Mikrofon', many: 'Mikrofoner' },
]

export type EquipmentLine = { key: string; label: string; count: number }

type Countable = {
  isDeleted?: boolean
  width: number
  height: number
  customData?: unknown
}

export function stageKind(el: Countable): string | null {
  const data = el.customData
  if (!data || typeof data !== 'object') return null
  const tb = (data as Record<string, unknown>).tb
  return typeof tb === 'string' ? tb : null
}

/** «2 × 1 m» — lengste side først, så en dreid praktikabel teller som samme størrelse. */
export function formatMeters(width: number, height: number): string {
  const fmt = (px: number) => {
    const m = Math.round((px / STAGE_SCALE) * 10) / 10
    return String(m).replace('.', ',')
  }
  const [a, b] = width >= height ? [width, height] : [height, width]
  return `${fmt(a)} × ${fmt(b)} m`
}

/**
 * Teller utstyret i tegningen. Praktikabler telles per størrelse, siden «4
 * praktikabler» ikke sier en arrangør nok. Slettede elementer telles ikke.
 */
export function equipmentList(elements: readonly Countable[]): EquipmentLine[] {
  const counts = new Map<string, number>()
  const risers = new Map<string, number>()
  for (const el of elements) {
    if (el.isDeleted) continue
    const kind = stageKind(el)
    if (!kind) continue
    if (kind === 'riser') {
      const size = formatMeters(el.width, el.height)
      risers.set(size, (risers.get(size) ?? 0) + 1)
    } else {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  }
  const out: EquipmentLine[] = []
  for (const item of COUNTED_ITEMS) {
    if (item.kind === 'riser') {
      for (const [size, count] of [...risers].sort(([a], [b]) => a.localeCompare(b, 'nb'))) {
        out.push({ key: `riser:${size}`, label: `${count === 1 ? item.one : item.many} ${size}`, count })
      }
      continue
    }
    const count = counts.get(item.kind)
    if (count) out.push({ key: item.kind, label: count === 1 ? item.one : item.many, count })
  }
  return out
}

/** Størrelsen på scenen (det første scenerektangelet), eller null. */
export function stageSize(elements: readonly (Countable & { type?: string })[]): string | null {
  const stage = elements.find((el) => !el.isDeleted && stageKind(el) === 'stage')
  return stage ? formatMeters(stage.width, stage.height) : null
}

// ---------- Byggeklosser ----------

const CHAIR_W = 76
const CHAIR_H = 46
const STAND_LENGTH = 36

type Point = { x: number; y: number }

/**
 * Stol med notestativ. Stolen dreies aldri (teksten skal kunne leses); det er
 * stativet som viser hvilken vei musikeren ser — mot `facing`.
 */
export function chairWithStand(
  ctx: ElementContext,
  o: { cx: number; cy: number; label: string; section: StageSection; facing: Point; groupIds?: string[] },
): SceneElement[] {
  const groupIds = o.groupIds ?? [ctx.id()]
  const chair = rect(ctx, {
    x: o.cx - CHAIR_W / 2,
    y: o.cy - CHAIR_H / 2,
    width: CHAIR_W,
    height: CHAIR_H,
    rounded: true,
    backgroundColor: SECTION_FILL[o.section],
    groupIds,
    customData: { tb: 'chair', section: o.section },
  })
  const name = label(ctx, chair, { text: o.label, fontSize: 13 })
  return [chair, name, standToward(ctx, { x: o.cx, y: o.cy }, CHAIR_W, CHAIR_H, o.facing, groupIds)]
}

/** Et notestativ (tykk strek) like utenfor en form, på siden mot `facing`. */
function standToward(
  ctx: ElementContext,
  center: Point,
  width: number,
  height: number,
  facing: Point,
  groupIds: string[],
): SceneElement {
  let dx = facing.x - center.x
  let dy = facing.y - center.y
  const len = Math.hypot(dx, dy)
  if (len < 1) {
    dx = 0
    dy = 1
  } else {
    dx /= len
    dy /= len
  }
  // Avstanden fra midten til kanten av formen i retning (dx, dy).
  const edge = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : width / 2 / Math.abs(dx),
    Math.abs(dy) < 1e-6 ? Infinity : height / 2 / Math.abs(dy),
  )
  const sx = center.x + dx * (edge + 12)
  const sy = center.y + dy * (edge + 12)
  const px = -dy * (STAND_LENGTH / 2)
  const py = dx * (STAND_LENGTH / 2)
  return line(ctx, {
    points: [
      [sx - px, sy - py],
      [sx + px, sy + py],
    ],
    strokeWidth: 3,
    groupIds,
    customData: { tb: 'stand' },
  })
}

/** Liten tekst rett under en form, i samme gruppe. */
function caption(ctx: ElementContext, shape: SceneElement, value: string, fontSize = 12): SceneElement {
  return text(ctx, {
    text: value,
    cx: shape.x + shape.width / 2,
    cy: shape.y + shape.height + 6 + fontSize * 0.7,
    fontSize,
    groupIds: shape.groupIds,
  })
}

function labeledBox(
  ctx: ElementContext,
  o: { kind: StageItemKind; width: number; height: number; text: string; fill: string; fontSize?: number },
): SceneElement[] {
  const groupIds = [ctx.id()]
  const box = rect(ctx, {
    x: -o.width / 2,
    y: -o.height / 2,
    width: o.width,
    height: o.height,
    rounded: true,
    backgroundColor: o.fill,
    groupIds,
    customData: { tb: o.kind },
  })
  return [box, label(ctx, box, { text: o.text, fontSize: o.fontSize ?? 13 })]
}

function circleWithCaption(
  ctx: ElementContext,
  o: { kind: StageItemKind; size: number; text: string; fill: string },
): SceneElement[] {
  const groupIds = [ctx.id()]
  const shape = ellipse(ctx, { cx: 0, cy: 0, width: o.size, backgroundColor: o.fill, groupIds, customData: { tb: o.kind } })
  return [shape, caption(ctx, shape, o.text)]
}

/** Paukesett i en bue foran pauker-krakken. Største pauke til høyre sett fra salen. */
export function timpaniSet(ctx: ElementContext, o: { cx: number; cy: number; sizes: number[]; groupIds?: string[] }) {
  const groupIds = o.groupIds ?? [ctx.id()]
  // Tommer → cm: 23" = 58 cm, 26" = 66, 29" = 74, 32" = 81.
  const cm = (inch: number) => Math.round(inch * 2.54)
  const angles: Record<number, number[]> = { 1: [90], 2: [120, 60], 3: [150, 90, 30], 4: [160, 120, 60, 20], 5: [170, 135, 90, 45, 10] }
  const sorted = [...o.sizes].sort((a, b) => a - b)
  const radius = sorted.length > 2 ? 120 : 100
  const out: SceneElement[] = [
    ellipse(ctx, { cx: o.cx, cy: o.cy, width: 36, backgroundColor: NEUTRAL_FILL, groupIds, customData: { tb: 'stool' } }),
  ]
  sorted.forEach((inch, i) => {
    const angle = ((angles[sorted.length] ?? angles[4]!)[i]! * Math.PI) / 180
    const drum = ellipse(ctx, {
      cx: o.cx + Math.cos(angle) * radius,
      cy: o.cy + Math.sin(angle) * radius,
      width: cm(inch),
      backgroundColor: SECTION_FILL.perc,
      groupIds,
      customData: { tb: 'timpani' },
    })
    out.push(drum, label(ctx, drum, { text: `${inch}"`, fontSize: 12 }))
  })
  return out
}

function drumKit(ctx: ElementContext): SceneElement[] {
  const groupIds = [ctx.id()]
  const g = { groupIds }
  const perc = SECTION_FILL.perc
  const area = rect(ctx, {
    x: -80,
    y: -70,
    width: 160,
    height: 140,
    rounded: true,
    strokeStyle: 'dashed',
    groupIds,
    customData: { tb: 'drum-kit' },
  })
  const parts = [
    ellipse(ctx, { cx: 0, cy: -46, width: 32, backgroundColor: NEUTRAL_FILL, ...g }), // krakk
    rect(ctx, { x: -28, y: 4, width: 56, height: 38, rounded: true, backgroundColor: perc, ...g }), // stortromme
    ellipse(ctx, { cx: -16, cy: 4, width: 26, backgroundColor: perc, ...g }), // tom
    ellipse(ctx, { cx: 16, cy: 4, width: 28, backgroundColor: perc, ...g }), // tom
    ellipse(ctx, { cx: 28, cy: -18, width: 34, backgroundColor: perc, ...g }), // skarptromme
    ellipse(ctx, { cx: -48, cy: -16, width: 40, backgroundColor: perc, ...g }), // gulvtom
    ellipse(ctx, { cx: 58, cy: -26, width: 32, backgroundColor: CYMBAL_FILL, ...g }), // hi-hat
    ellipse(ctx, { cx: -52, cy: 36, width: 44, backgroundColor: CYMBAL_FILL, opacity: 85, ...g }), // ride
    ellipse(ctx, { cx: 46, cy: 42, width: 40, backgroundColor: CYMBAL_FILL, opacity: 85, ...g }), // crash
  ]
  return [area, ...parts, caption(ctx, area, 'Trommesett', 13)]
}

function podium(ctx: ElementContext, o: { cx: number; cy: number; facing: Point; groupIds?: string[] }) {
  const groupIds = o.groupIds ?? [ctx.id()]
  const box = rect(ctx, {
    x: o.cx - 40,
    y: o.cy - 40,
    width: 80,
    height: 80,
    rounded: true,
    backgroundColor: NEUTRAL_FILL,
    groupIds,
    customData: { tb: 'podium' },
  })
  return [
    box,
    label(ctx, box, { text: 'Dirigent', fontSize: 13 }),
    standToward(ctx, { x: o.cx, y: o.cy }, 80, 80, o.facing, groupIds),
  ]
}

/** Scenekanten. Publikum er alltid nederst i tegningen. */
export function stageOutline(
  ctx: ElementContext,
  o: { x: number; y: number; width: number; height: number; locked?: boolean },
): SceneElement[] {
  const groupIds = [ctx.id()]
  return [
    rect(ctx, {
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      strokeWidth: 2,
      groupIds,
      locked: o.locked,
      customData: { tb: 'stage' },
    }),
  ]
}

export function audienceMarker(ctx: ElementContext, o: { cx: number; cy: number; locked?: boolean }): SceneElement[] {
  return [
    text(ctx, {
      text: 'PUBLIKUM',
      cx: o.cx,
      cy: o.cy,
      fontSize: 20,
      strokeColor: '#868e96',
      locked: o.locked,
      customData: { tb: 'audience' },
    }),
  ]
}

/** Strek på én meter med endestreker, så tegningen kan måles på papir. */
export function scaleBar(ctx: ElementContext, o: { x: number; y: number }): SceneElement[] {
  const groupIds = [ctx.id()]
  const { x, y } = o
  return [
    line(ctx, {
      points: [
        [x, y - 6],
        [x, y],
        [x + STAGE_SCALE, y],
        [x + STAGE_SCALE, y - 6],
      ],
      strokeWidth: 2,
      groupIds,
      customData: { tb: 'scale' },
    }),
    text(ctx, { text: '1 m', cx: x + STAGE_SCALE / 2, cy: y + 14, fontSize: 12, groupIds }),
  ]
}

// ---------- Paletten ----------

export type StageGroup = 'musikere' | 'slagverk' | 'scene'

export const STAGE_GROUPS: ReadonlyArray<{ id: StageGroup; label: string }> = [
  { id: 'musikere', label: 'Musikere' },
  { id: 'slagverk', label: 'Slagverk' },
  { id: 'scene', label: 'Scene' },
]

export type StageComponentDef = {
  id: string
  group: StageGroup
  label: string
  hint?: string
  /** Bygges rundt (0, 0); `buildStageComponent` flytter den på plass. */
  build: (ctx: ElementContext) => SceneElement[]
}

/** Musikere ser mot dirigenten, som står nedenfor dem i tegningen. */
const DOWN: Point = { x: 0, y: 1000 }

const musician = (id: string, labelText: string, section: StageSection, hint?: string): StageComponentDef => ({
  id,
  group: 'musikere',
  label: labelText,
  hint: hint ?? 'Stol med notestativ',
  build: (ctx) => chairWithStand(ctx, { cx: 0, cy: 0, label: labelText, section, facing: DOWN }),
})

export const STAGE_COMPONENTS: readonly StageComponentDef[] = [
  musician('chair-cornet', 'Kornett', 'cornet'),
  musician('chair-flugel', 'Flygel', 'horn', 'Flygelhorn — stol med notestativ'),
  musician('chair-horn', 'Horn', 'horn'),
  musician('chair-baritone', 'Baryton', 'euph-bari'),
  musician('chair-euphonium', 'Eufonium', 'euph-bari'),
  musician('chair-trombone', 'Trombone', 'trombone'),
  musician('chair-bass', 'Bass', 'tuba'),
  musician('chair-perc', 'Slagverk', 'perc'),
  musician('chair', 'Stol', 'other', 'Stol med notestativ, uten seksjon'),
  {
    id: 'stand',
    group: 'musikere',
    label: 'Notestativ',
    hint: 'Bare stativet',
    build: (ctx) => [
      line(ctx, {
        points: [
          [-STAND_LENGTH / 2, 0],
          [STAND_LENGTH / 2, 0],
        ],
        strokeWidth: 3,
        groupIds: [ctx.id()],
        customData: { tb: 'stand' },
      }),
    ],
  },
  {
    id: 'timpani-4',
    group: 'slagverk',
    label: 'Pauker (4)',
    hint: '32", 29", 26" og 23" med krakk',
    build: (ctx) => timpaniSet(ctx, { cx: 0, cy: 0, sizes: [32, 29, 26, 23] }),
  },
  {
    id: 'timpani-2',
    group: 'slagverk',
    label: 'Pauker (2)',
    hint: '29" og 26" med krakk',
    build: (ctx) => timpaniSet(ctx, { cx: 0, cy: 0, sizes: [29, 26] }),
  },
  {
    id: 'bass-drum',
    group: 'slagverk',
    label: 'Stortromme',
    build: (ctx) => labeledBox(ctx, { kind: 'bass-drum', width: 90, height: 55, text: 'Stortromme', fill: SECTION_FILL.perc, fontSize: 12 }),
  },
  {
    id: 'snare',
    group: 'slagverk',
    label: 'Skarptromme',
    build: (ctx) => circleWithCaption(ctx, { kind: 'snare', size: 40, text: 'Skarptromme', fill: SECTION_FILL.perc }),
  },
  { id: 'drum-kit', group: 'slagverk', label: 'Trommesett', build: drumKit },
  {
    id: 'xylophone',
    group: 'slagverk',
    label: 'Xylofon',
    build: (ctx) => labeledBox(ctx, { kind: 'xylophone', width: 160, height: 50, text: 'Xylofon', fill: SECTION_FILL.perc }),
  },
  {
    id: 'marimba',
    group: 'slagverk',
    label: 'Marimba',
    build: (ctx) => labeledBox(ctx, { kind: 'marimba', width: 240, height: 80, text: 'Marimba', fill: SECTION_FILL.perc }),
  },
  {
    id: 'vibraphone',
    group: 'slagverk',
    label: 'Vibrafon',
    build: (ctx) => labeledBox(ctx, { kind: 'vibraphone', width: 140, height: 60, text: 'Vibrafon', fill: SECTION_FILL.perc }),
  },
  {
    id: 'glockenspiel',
    group: 'slagverk',
    label: 'Klokkespill',
    build: (ctx) =>
      labeledBox(ctx, { kind: 'glockenspiel', width: 100, height: 40, text: 'Klokkespill', fill: SECTION_FILL.perc, fontSize: 12 }),
  },
  {
    id: 'tubular-bells',
    group: 'slagverk',
    label: 'Rørklokker',
    build: (ctx) =>
      labeledBox(ctx, { kind: 'tubular-bells', width: 150, height: 45, text: 'Rørklokker', fill: SECTION_FILL.perc }),
  },
  {
    id: 'tam-tam',
    group: 'slagverk',
    label: 'Tam-tam',
    build: (ctx) => {
      const groupIds = [ctx.id()]
      const gong = ellipse(ctx, { cx: 0, cy: 0, width: 90, backgroundColor: CYMBAL_FILL, groupIds, customData: { tb: 'tam-tam' } })
      return [gong, label(ctx, gong, { text: 'Tam-tam', fontSize: 12 })]
    },
  },
  {
    id: 'cymbal',
    group: 'slagverk',
    label: 'Hengende cymbal',
    build: (ctx) => circleWithCaption(ctx, { kind: 'cymbal', size: 46, text: 'Cymbal', fill: CYMBAL_FILL }),
  },
  {
    id: 'trap-table',
    group: 'slagverk',
    label: 'Slagverksbord',
    hint: 'Bord til småinstrumenter',
    build: (ctx) => labeledBox(ctx, { kind: 'trap-table', width: 90, height: 50, text: 'Bord', fill: NEUTRAL_FILL }),
  },
  {
    id: 'stool',
    group: 'slagverk',
    label: 'Krakk',
    build: (ctx) => circleWithCaption(ctx, { kind: 'stool', size: 36, text: 'Krakk', fill: NEUTRAL_FILL }),
  },
  {
    id: 'podium',
    group: 'scene',
    label: 'Dirigentpodium',
    hint: 'Med stativ mot korpset',
    build: (ctx) => podium(ctx, { cx: 0, cy: 0, facing: { x: 0, y: -1000 } }),
  },
  {
    id: 'riser-2x1',
    group: 'scene',
    label: 'Praktikabel 2 × 1 m',
    build: (ctx) => riser(ctx, 200, 100),
  },
  {
    id: 'riser-1x1',
    group: 'scene',
    label: 'Praktikabel 1 × 1 m',
    build: (ctx) => riser(ctx, 100, 100),
  },
  {
    id: 'stage',
    group: 'scene',
    label: 'Scene 10 × 6 m',
    hint: 'Dra i hjørnene for riktig størrelse',
    build: (ctx) => stageOutline(ctx, { x: -500, y: -300, width: 1000, height: 600 }),
  },
  {
    id: 'audience',
    group: 'scene',
    label: 'Publikum',
    hint: 'Viser hvilken vei salen er',
    build: (ctx) => audienceMarker(ctx, { cx: 0, cy: 0 }),
  },
  {
    id: 'power',
    group: 'scene',
    label: 'Strømuttak',
    build: (ctx) => {
      const groupIds = [ctx.id()]
      const box = rect(ctx, { x: -14, y: -14, width: 28, height: 28, backgroundColor: CYMBAL_FILL, groupIds, customData: { tb: 'power' } })
      return [box, caption(ctx, box, 'Strøm')]
    },
  },
  {
    id: 'microphone',
    group: 'scene',
    label: 'Mikrofon',
    build: (ctx) => circleWithCaption(ctx, { kind: 'microphone', size: 22, text: 'Mik', fill: '#dee2e6' }),
  },
  {
    id: 'scale',
    group: 'scene',
    label: 'Målestokk 1 m',
    build: (ctx) => scaleBar(ctx, { x: -STAGE_SCALE / 2, y: 0 }),
  },
]

function riser(ctx: ElementContext, width: number, height: number): SceneElement[] {
  const groupIds = [ctx.id()]
  const box = rect(ctx, {
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    strokeStyle: 'dashed',
    backgroundColor: '#f1f3f5',
    groupIds,
    customData: { tb: 'riser' },
  })
  return [box, label(ctx, box, { text: 'Praktikabel', fontSize: 12 })]
}

export function findStageComponent(id: string): StageComponentDef | undefined {
  return STAGE_COMPONENTS.find((c) => c.id === id)
}

/** Bygger en komponent med senter i `at` (scenekoordinater). */
export function buildStageComponent(
  id: string,
  at: Point = { x: 0, y: 0 },
  ctx: ElementContext = elementContext(),
): SceneElement[] {
  const def = findStageComponent(id)
  if (!def) throw new Error(`Ukjent komponent: ${id}`)
  const elements = def.build(ctx)
  const box = bounds(elements)
  return translate(elements, at.x - (box.minX + box.width / 2), at.y - (box.minY + box.height / 2))
}
