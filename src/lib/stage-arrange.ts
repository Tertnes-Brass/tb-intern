/**
 * Endringer på en tegning som er bygget av komponentene i
 * `stage-components.ts`: snu stativene mot dirigenten, og gjøre en stol om til
 * en dobbel stol (og tilbake).
 *
 * Rene funksjoner på elementlista — ingen Excalidraw her. Editoren sender inn
 * `getSceneElementsIncludingDeleted()` og gir resultatet tilbake til
 * `updateScene`, som ett steg i angre-historikken. Endrede elementer får ny
 * `version`/`versionNonce`, slik Excalidraw krever for å tegne dem på nytt.
 *
 * En komponent er elementene i samme INNERSTE gruppe (`groupIds[0]`).
 * Excalidraw legger nye, ytre grupper bakerst i `groupIds`, så en stol beholder
 * sin egen gruppe også når noen grupperer hele kornettrekka.
 */
import {
  EXTRA_CHAIR_OFFSET,
  type Point,
  direction,
  extraChair,
  isExtraChair,
  stageKind,
  standPoints,
  timpaniStandPoints,
} from './stage-components'
import { type ElementContext, type SceneElement, bounds } from './stage-elements'

type Unit = {
  members: SceneElement[]
  stands: SceneElement[]
  /** Stoler med navn — én per musiker. */
  chairs: SceneElement[]
  extras: SceneElement[]
  podium: boolean
}

function unitsOf(elements: readonly SceneElement[]): Map<string, Unit> {
  const units = new Map<string, Unit>()
  for (const el of elements) {
    if (el.isDeleted) continue
    const group = el.groupIds[0]
    if (!group) continue
    let unit = units.get(group)
    if (!unit) {
      unit = { members: [], stands: [], chairs: [], extras: [], podium: false }
      units.set(group, unit)
    }
    unit.members.push(el)
    const kind = stageKind(el)
    if (kind === 'stand') unit.stands.push(el)
    else if (kind === 'podium') unit.podium = true
    else if (kind === 'chair') (isExtraChair(el) ? unit.extras : unit.chairs).push(el)
  }
  return units
}

function centerOf(box: { minX: number; minY: number; width: number; height: number }): Point {
  return { x: box.minX + box.width / 2, y: box.minY + box.height / 2 }
}

const round = (n: number) => Math.round(n * 100) / 100

function bump(el: SceneElement, ctx: ElementContext, patch: Partial<SceneElement>): SceneElement {
  return {
    ...el,
    ...patch,
    version: (typeof el.version === 'number' ? el.version : 1) + 1,
    versionNonce: ctx.int(),
    updated: ctx.now,
  }
}

/** Det stativet skal stå i forhold til: stolen, eller instrumentet uten tekst og stativ. */
function anchorOf(unit: Unit) {
  if (unit.chairs.length > 1) return null
  const shapes = unit.chairs.length === 1 ? unit.chairs : unit.members.filter((m) => m.type !== 'text' && stageKind(m) !== 'stand' && !isExtraChair(m))
  if (shapes.length === 0) return null
  const box = bounds(shapes)
  return { center: centerOf(box), width: box.width, height: box.height, chair: unit.chairs[0] }
}

/** Et paukesett: krakken, paukene, og hvilken vei buen vender nå. */
function timpaniOf(unit: Unit) {
  const stool = unit.members.find((m) => stageKind(m) === 'stool')
  const drums = unit.members.filter((m) => stageKind(m) === 'timpani')
  if (!stool || drums.length === 0) return null
  const center = centerOf(bounds([stool]))
  const drumCenters = drums.map((d) => centerOf(bounds([d])))
  const mean = {
    x: drumCenters.reduce((s, c) => s + c.x, 0) / drumCenters.length,
    y: drumCenters.reduce((s, c) => s + c.y, 0) / drumCenters.length,
  }
  const radius = drumCenters.reduce((s, c) => s + Math.hypot(c.x - center.x, c.y - center.y), 0) / drumCenters.length
  return { stool: center, drums, facing: direction(center, mean), radius }
}

/** Komponenter som berøres av utvalget — alle når ingenting er valgt. */
function touches(unit: Unit, only: ReadonlySet<string> | undefined): boolean {
  return !only || only.size === 0 || unit.members.some((m) => only.has(m.id))
}

export type ArrangeResult = { elements: SceneElement[]; changed: number }

/**
 * Snur notestativene mot nærmeste dirigentpodium: stativet flyttes rundt
 * stolen (eller instrumentet), og en ekstra stol legges bak på motsatt side.
 * Stolene selv dreies aldri, så navnene kan leses. Gjelder komponentene i
 * `only`, eller alle når `only` er tomt.
 *
 * Komponenter med mer enn ett stativ (noen har gruppert løse stoler sammen)
 * og selve podiet røres ikke. Uten podium i tegningen skjer ingenting.
 */
export function faceConductor(
  elements: readonly SceneElement[],
  ctx: ElementContext,
  only?: ReadonlySet<string>,
): ArrangeResult {
  const podiums = elements
    .filter((e) => !e.isDeleted && stageKind(e) === 'podium')
    .map((e) => centerOf(bounds([e])))
  if (podiums.length === 0) return { elements: [...elements], changed: 0 }

  const nearest = (from: Point) =>
    podiums.reduce((best, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? p : best))
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5

  const updates = new Map<string, SceneElement>()
  let changed = 0
  for (const unit of unitsOf(elements).values()) {
    if (unit.podium || unit.stands.length !== 1 || !touches(unit, only)) continue
    const anchor = anchorOf(unit)
    if (!anchor) continue
    let moved = false
    let points: [[number, number], [number, number]]

    const timpani = timpaniOf(unit)
    const target = nearest(timpani ? timpani.stool : anchor.center)
    if (timpani) {
      // Hele buen dreies om krakken, så paukeristen ser mot dirigenten.
      const want = direction(timpani.stool, target)
      const turn = Math.atan2(want.y, want.x) - Math.atan2(timpani.facing.y, timpani.facing.x)
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      for (const drum of timpani.drums) {
        const c = centerOf(bounds([drum]))
        const rx = c.x - timpani.stool.x
        const ry = c.y - timpani.stool.y
        const dx = timpani.stool.x + rx * cos - ry * sin - c.x
        const dy = timpani.stool.y + rx * sin + ry * cos - c.y
        if (same(dx, 0) && same(dy, 0)) continue
        for (const part of unit.members.filter((m) => m.id === drum.id || m.containerId === drum.id)) {
          updates.set(part.id, bump(part, ctx, { x: round(part.x + dx), y: round(part.y + dy) }))
        }
        moved = true
      }
      points = timpaniStandPoints(timpani.stool, timpani.radius, want)
    } else {
      points = standPoints(anchor.center, anchor.width, anchor.height, target)
    }

    const stand = unit.stands[0]!
    const [[x0, y0], [x1, y1]] = points
    const current = Array.isArray(stand.points) ? (stand.points as Array<[number, number]>) : []
    const [cx0, cy0] = [stand.x, stand.y]
    const [cx1, cy1] = current[1] ? [stand.x + current[1][0], stand.y + current[1][1]] : [NaN, NaN]
    if (!(same(cx0, x0) && same(cy0, y0) && same(cx1, x1) && same(cy1, y1)) || stand.angle) {
      updates.set(
        stand.id,
        bump(stand, ctx, {
          x: round(x0),
          y: round(y0),
          points: [
            [0, 0],
            [round(x1 - x0), round(y1 - y0)],
          ],
          width: round(Math.abs(x1 - x0)),
          height: round(Math.abs(y1 - y0)),
          angle: 0,
        }),
      )
      moved = true
    }

    if (anchor.chair) {
      const toward = direction(anchor.center, target)
      for (const extra of unit.extras) {
        const x = round(anchor.center.x - toward.x * EXTRA_CHAIR_OFFSET - extra.width / 2)
        const y = round(anchor.center.y - toward.y * EXTRA_CHAIR_OFFSET - extra.height / 2)
        if (same(extra.x, x) && same(extra.y, y)) continue
        updates.set(extra.id, bump(extra, ctx, { x, y }))
        moved = true
      }
    }
    if (moved) changed++
  }
  return { elements: elements.map((e) => updates.get(e.id) ?? e), changed }
}

/**
 * Gjør stolene i utvalget om til doble stoler (`2`) eller enkle (`1`). Den
 * ekstra stolen legges bak stolen med navnet, på motsatt side av stativet, og
 * under den i tegnerekkefølgen. Ved `1` merkes de ekstra stolene som slettet,
 * så angre virker.
 */
export function setChairCount(
  elements: readonly SceneElement[],
  ctx: ElementContext,
  selected: ReadonlySet<string>,
  count: 1 | 2,
): ArrangeResult {
  const updates = new Map<string, SceneElement>()
  const before = new Map<string, SceneElement>()
  let changed = 0
  for (const unit of unitsOf(elements).values()) {
    if (unit.chairs.length !== 1 || !unit.members.some((m) => selected.has(m.id))) continue
    const chair = unit.chairs[0]!
    if (count === 2 && unit.extras.length === 0) {
      const center = centerOf(bounds([chair]))
      const toward = unit.stands.length === 1 ? direction(center, centerOf(bounds(unit.stands))) : { x: 0, y: 1 }
      before.set(chair.id, extraChair(ctx, chair, toward))
      changed++
    } else if (count === 1 && unit.extras.length > 0) {
      for (const extra of unit.extras) updates.set(extra.id, bump(extra, ctx, { isDeleted: true }))
      changed++
    }
  }
  return {
    elements: elements.flatMap((e) => {
      const extra = before.get(e.id)
      return extra ? [extra, e] : [updates.get(e.id) ?? e]
    }),
    changed,
  }
}

export type StageSelection = {
  /** Stoler med navn i utvalget. */
  chairs: number
  /** …av dem som er doble. */
  doubles: number
  /** Komponenter med ett stativ som kan snus. */
  stands: number
}

/** Hva utvalget inneholder — styrer verktøylinja over tegningen. */
export function describeSelection(elements: readonly SceneElement[], selected: ReadonlySet<string>): StageSelection {
  const out: StageSelection = { chairs: 0, doubles: 0, stands: 0 }
  if (selected.size === 0) return out
  for (const unit of unitsOf(elements).values()) {
    if (!unit.members.some((m) => selected.has(m.id))) continue
    if (unit.chairs.length === 1) {
      out.chairs++
      if (unit.extras.length > 0) out.doubles++
    }
    if (!unit.podium && unit.stands.length === 1 && anchorOf(unit)) out.stands++
  }
  return out
}
