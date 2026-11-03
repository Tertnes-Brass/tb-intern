import { describe, expect, it } from 'vitest'
import { describeSelection, faceConductor, setChairCount } from './stage-arrange'
import { buildStageComponent, equipmentList, isExtraChair, stageKind } from './stage-components'
import { type ElementContext, type SceneElement, bounds } from './stage-elements'

function testContext(): ElementContext {
  let n = 0
  return { id: () => `id${++n}`, int: () => 7, now: 123 }
}

const center = (els: SceneElement[]) => {
  const b = bounds(els)
  return { x: b.minX + b.width / 2, y: b.minY + b.height / 2 }
}
const standOf = (els: SceneElement[], group: string) =>
  center(els.filter((e) => stageKind(e) === 'stand' && e.groupIds[0] === group))
const chairCount = (els: SceneElement[]) => equipmentList(els).find((l) => l.key === 'chair')?.count ?? 0

/** En stol midt på, og dirigenten et sted. */
function scene(podium: { x: number; y: number }) {
  const ctx = testContext()
  const chair = buildStageComponent('chair-cornet', { x: 0, y: 0 }, ctx)
  const conductor = buildStageComponent('podium', podium, ctx)
  return { elements: [...conductor, ...chair], group: chair[0]!.groupIds[0]! }
}

describe('faceConductor', () => {
  it('flytter stativet over på siden mot dirigenten', () => {
    // Komponenten er bygget med stativet ned; dirigenten står til høyre.
    const { elements, group } = scene({ x: 600, y: 0 })
    expect(standOf(elements, group).y).toBeGreaterThan(20)
    const result = faceConductor(elements, testContext())
    expect(result.changed).toBe(1)
    const chair = center(result.elements.filter((e) => stageKind(e) === 'chair'))
    const podium = center(result.elements.filter((e) => stageKind(e) === 'podium'))
    const stand = standOf(result.elements, group)
    expect(stand.x).toBeGreaterThan(chair.x + 38)
    // På linja fra stolen mot podiet.
    const t = (stand.x - chair.x) / (podium.x - chair.x)
    expect(stand.y).toBeCloseTo(chair.y + t * (podium.y - chair.y), 1)
  })

  it('gir endrede elementer ny versjon, og lar resten være de samme objektene', () => {
    const { elements } = scene({ x: 600, y: 0 })
    const result = faceConductor(elements, testContext())
    const before = new Map(elements.map((e) => [e.id, e]))
    const changed = result.elements.filter((e) => e !== before.get(e.id))
    expect(changed).toHaveLength(1)
    expect(changed[0]!.version).toBe((before.get(changed[0]!.id)!.version as number) + 1)
    expect(changed[0]!.updated).toBe(123)
  })

  it('er ferdig når stativene allerede står riktig', () => {
    const { elements } = scene({ x: 600, y: 0 })
    const once = faceConductor(elements, testContext()).elements
    expect(faceConductor(once, testContext()).changed).toBe(0)
  })

  it('gjør ingenting uten dirigentpodium', () => {
    const elements = buildStageComponent('chair-cornet', { x: 0, y: 0 }, testContext())
    expect(faceConductor(elements, testContext()).changed).toBe(0)
  })

  it('snur bare utvalget når noe er valgt', () => {
    const ctx = testContext()
    const a = buildStageComponent('chair-cornet', { x: 0, y: 0 }, ctx)
    const b = buildStageComponent('chair-cornet', { x: 0, y: 300 }, ctx)
    const elements = [...buildStageComponent('podium', { x: 600, y: 150 }, ctx), ...a, ...b]
    const result = faceConductor(elements, testContext(), new Set([a[0]!.id]))
    expect(result.changed).toBe(1)
    expect(standOf(result.elements, b[0]!.groupIds[0]!)).toEqual(standOf(elements, b[0]!.groupIds[0]!))
  })

  it('flytter den ekstra stolen bak, på motsatt side av dirigenten', () => {
    const { elements } = scene({ x: 600, y: 0 })
    const doubled = setChairCount(elements, testContext(), new Set(elements.map((e) => e.id)), 2).elements
    const result = faceConductor(doubled, testContext()).elements
    const extra = result.find(isExtraChair)!
    const chair = result.find((e) => stageKind(e) === 'chair' && !isExtraChair(e))!
    expect(extra.x).toBeLessThan(chair.x - 7)
    expect(Math.abs(extra.y - chair.y)).toBeLessThan(1)
  })

  it('lar komponenter med flere stativ og selve podiet være', () => {
    const ctx = testContext()
    const loose = [...buildStageComponent('chair-cornet', { x: 0, y: 0 }, ctx), ...buildStageComponent('chair-cornet', { x: 200, y: 0 }, ctx)]
    // Noen har gruppert to løse stoler sammen — og tatt bort deres egne grupper.
    const grouped = loose.map((e) => ({ ...e, groupIds: ['felles'] }))
    const podium = buildStageComponent('podium', { x: 600, y: 0 }, ctx)
    const result = faceConductor([...podium, ...grouped], testContext())
    expect(result.changed).toBe(0)
  })

  it('dreier paukebuen om krakken og setter stativet i buen', () => {
    const ctx = testContext()
    const timpani = buildStageComponent('timpani-4', { x: 0, y: 0 }, ctx)
    const stool = timpani.find((e) => stageKind(e) === 'stool')!
    const stoolCenter = center([stool])
    const elements = [...buildStageComponent('podium', { x: stoolCenter.x - 800, y: stoolCenter.y }, ctx), ...timpani]
    const result = faceConductor(elements, testContext()).elements
    const drums = result.filter((e) => stageKind(e) === 'timpani')
    for (const drum of drums) expect(center([drum]).x).toBeLessThan(stoolCenter.x)
    // Navnene på paukene følger med.
    for (const drum of drums) {
      const text = result.find((e) => e.containerId === drum.id)!
      expect(center([text]).x).toBeCloseTo(center([drum]).x, 0)
    }
    const stand = standOf(result, timpani[0]!.groupIds[0]!)
    expect(stand.x).toBeLessThan(stoolCenter.x - 100)
    expect(Math.abs(stand.y - stoolCenter.y)).toBeLessThan(3)
    // Krakken står der den stod.
    expect(result.find((e) => e.id === stool.id)).toBe(stool)
  })
})

describe('setChairCount', () => {
  it('gjør en stol dobbel, og tilbake — telles som to stoler', () => {
    const { elements } = scene({ x: 0, y: 600 })
    const chairId = elements.find((e) => stageKind(e) === 'chair')!.id
    const doubled = setChairCount(elements, testContext(), new Set([chairId]), 2)
    expect(doubled.changed).toBe(1)
    expect(chairCount(doubled.elements)).toBe(2)
    // Ingen dobbel-dobbel.
    expect(setChairCount(doubled.elements, testContext(), new Set([chairId]), 2).changed).toBe(0)

    const single = setChairCount(doubled.elements, testContext(), new Set([chairId]), 1)
    expect(single.changed).toBe(1)
    expect(chairCount(single.elements)).toBe(1)
    // Merket som slettet (så angre virker), ikke fjernet fra lista.
    expect(single.elements.find(isExtraChair)!.isDeleted).toBe(true)
  })

  it('legger den ekstra stolen rett under stolen med navnet, bak stativet', () => {
    const { elements } = scene({ x: 0, y: 600 })
    const result = setChairCount(elements, testContext(), new Set(elements.map((e) => e.id)), 2).elements
    const extra = result.find(isExtraChair)!
    const chair = result.find((e) => stageKind(e) === 'chair' && !isExtraChair(e))!
    expect(result.indexOf(extra)).toBe(result.indexOf(chair) - 1)
    // Stativet står nedenfor (mot dirigenten), så den ekstra stolen stikker ut oppover.
    expect(extra.y).toBeLessThan(chair.y)
    expect(extra.groupIds).toEqual(chair.groupIds)
    expect(extra.index).toBeNull()
  })

  it('rører bare stolene i utvalget, og ikke podiet', () => {
    const { elements } = scene({ x: 0, y: 600 })
    const podium = elements.find((e) => stageKind(e) === 'podium')!
    expect(setChairCount(elements, testContext(), new Set([podium.id]), 2).changed).toBe(0)
    expect(setChairCount(elements, testContext(), new Set(), 2).changed).toBe(0)
  })
})

describe('describeSelection', () => {
  it('teller stoler, doble stoler og stativ i utvalget', () => {
    const ctx = testContext()
    const a = buildStageComponent('chair-cornet', { x: 0, y: 0 }, ctx)
    const b = buildStageComponent('chair-trombone', { x: 200, y: 0 }, ctx)
    const kit = buildStageComponent('drum-kit', { x: 600, y: 0 }, ctx)
    const podium = buildStageComponent('podium', { x: 0, y: 600 }, ctx)
    let elements = [...a, ...b, ...kit, ...podium]
    elements = setChairCount(elements, testContext(), new Set([b[0]!.id]), 2).elements
    const all = new Set(elements.map((e) => e.id))
    expect(describeSelection(elements, all)).toEqual({ chairs: 2, doubles: 1, stands: 3 })
    expect(describeSelection(elements, new Set([kit[0]!.id]))).toEqual({ chairs: 0, doubles: 0, stands: 1 })
    expect(describeSelection(elements, new Set([podium[0]!.id]))).toEqual({ chairs: 0, doubles: 0, stands: 0 })
    expect(describeSelection(elements, new Set())).toEqual({ chairs: 0, doubles: 0, stands: 0 })
  })
})
