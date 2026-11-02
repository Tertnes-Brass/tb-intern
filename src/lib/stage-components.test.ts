import { describe, expect, it } from 'vitest'
import {
  STAGE_COMPONENTS,
  buildStageComponent,
  chairWithStand,
  equipmentList,
  formatMeters,
  stageKind,
  stageSize,
} from './stage-components'
import { type ElementContext, type SceneElement, bounds } from './stage-elements'
import { parseStageScene } from './stage-scene'

function testContext(): ElementContext {
  let n = 0
  return { id: () => `id${++n}`, int: () => 7, now: 0 }
}

/** Bundet tekst må peke på formen, og formen tilbake på teksten. */
function expectBindingsConsistent(elements: SceneElement[]) {
  const byId = new Map(elements.map((e) => [e.id, e]))
  for (const el of elements) {
    if (el.type === 'text' && el.containerId) {
      const container = byId.get(el.containerId as string)
      expect(container, `container for ${el.id}`).toBeDefined()
      expect(container!.boundElements).toContainEqual({ type: 'text', id: el.id })
    }
    for (const bound of (el.boundElements as Array<{ id: string }> | null) ?? []) {
      expect(byId.get(bound.id)?.containerId).toBe(el.id)
    }
  }
}

describe('STAGE_COMPONENTS', () => {
  it('har unike id-er', () => {
    const ids = STAGE_COMPONENTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(STAGE_COMPONENTS.map((c) => [c.id]))('%s bygges som én gruppe sentrert der den settes inn', (id) => {
    const elements = buildStageComponent(id, { x: 500, y: -300 }, testContext())
    expect(elements.length).toBeGreaterThan(0)
    // Alle elementene deler (minst) én gruppe, så komponenten flyttes som én ting.
    const shared = elements[0]!.groupIds.filter((g) => elements.every((e) => e.groupIds.includes(g)))
    if (elements.length > 1) expect(shared.length).toBeGreaterThan(0)
    const box = bounds(elements)
    expect(box.minX + box.width / 2).toBeCloseTo(500, 0)
    expect(box.minY + box.height / 2).toBeCloseTo(-300, 0)
    expectBindingsConsistent(elements)
    // Komponenten er alltid noe serveren godtar å lagre.
    expect(() => parseStageScene({ elements, appState: {} })).not.toThrow()
    // Hver komponent er merket, så den kan telles (eller bevisst ikke telles).
    expect(elements.some((e) => stageKind(e))).toBe(true)
  })

  it('gir nye id-er hver gang', () => {
    const a = buildStageComponent('chair-cornet')
    const b = buildStageComponent('chair-cornet')
    expect(a.map((e) => e.id)).not.toEqual(b.map((e) => e.id))
    expect(a[0]!.groupIds).not.toEqual(b[0]!.groupIds)
  })

  it('kaster for en ukjent komponent', () => {
    expect(() => buildStageComponent('tuba-med-lys')).toThrow(/Ukjent/)
  })
})

describe('chairWithStand', () => {
  const standCenter = (elements: SceneElement[]) => {
    const stand = elements.find((e) => stageKind(e) === 'stand')!
    const box = bounds([stand])
    return { x: box.minX + box.width / 2, y: box.minY + box.height / 2, stand }
  }

  it('setter stativet på siden mot dirigenten', () => {
    const below = standCenter(chairWithStand(testContext(), { cx: 0, cy: 0, label: 'Solo 1', section: 'cornet', facing: { x: 0, y: 500 } }))
    expect(below.y).toBeGreaterThan(23)
    expect(Math.abs(below.x)).toBeLessThan(1)
    const left = standCenter(chairWithStand(testContext(), { cx: 0, cy: 0, label: 'Euf', section: 'euph-bari', facing: { x: -500, y: 0 } }))
    expect(left.x).toBeLessThan(-38)
  })

  it('legger stativet på tvers av retningen', () => {
    const { stand } = standCenter(chairWithStand(testContext(), { cx: 0, cy: 0, label: 'X', section: 'other', facing: { x: 0, y: 500 } }))
    expect(stand.width).toBeCloseTo(36, 0)
    expect(stand.height).toBeCloseTo(0, 0)
  })

  it('merker stolen med seksjonen', () => {
    const chair = chairWithStand(testContext(), { cx: 0, cy: 0, label: 'Bass', section: 'tuba', facing: { x: 0, y: 1 } })[0]!
    expect(chair.customData).toEqual({ tb: 'chair', section: 'tuba' })
  })
})

describe('equipmentList', () => {
  const tagged = (tb: string, over: Partial<SceneElement> = {}) => ({ width: 10, height: 10, customData: { tb }, ...over })

  it('teller merket utstyr i fast rekkefølge, entall og flertall', () => {
    const list = equipmentList([
      tagged('timpani'),
      tagged('chair'),
      tagged('timpani'),
      tagged('stand'),
      tagged('chair'),
      tagged('bass-drum'),
    ])
    expect(list.map((l) => [l.label, l.count])).toEqual([
      ['Stoler', 2],
      ['Notestativ', 1],
      ['Pauker', 2],
      ['Stortromme', 1],
    ])
  })

  it('teller ikke slettede, umerkede eller scene/publikum/målestokk', () => {
    const list = equipmentList([
      tagged('chair', { isDeleted: true }),
      { width: 1, height: 1 },
      { width: 1, height: 1, customData: 'tull' },
      tagged('stage'),
      tagged('audience'),
      tagged('scale'),
    ])
    expect(list).toEqual([])
  })

  it('teller praktikabler per størrelse, uavhengig av retning', () => {
    const list = equipmentList([
      tagged('riser', { width: 200, height: 100 }),
      tagged('riser', { width: 100, height: 200 }),
      tagged('riser', { width: 100, height: 100 }),
    ])
    expect(list.map((l) => [l.label, l.count])).toEqual([
      ['Praktikabel 1 × 1 m', 1],
      ['Praktikabler 2 × 1 m', 2],
    ])
  })

  it('teller komponentene slik de bygges', () => {
    const list = equipmentList([...buildStageComponent('timpani-4'), ...buildStageComponent('podium'), ...buildStageComponent('drum-kit')])
    expect(Object.fromEntries(list.map((l) => [l.key, l.count]))).toEqual({
      stand: 1,
      stool: 1,
      podium: 1,
      timpani: 4,
      'drum-kit': 1,
    })
  })
})

describe('formatMeters og stageSize', () => {
  it('runder til en desimal med komma', () => {
    expect(formatMeters(1234, 800)).toBe('12,3 × 8 m')
    expect(formatMeters(100, 250)).toBe('2,5 × 1 m')
  })

  it('finner scenen', () => {
    expect(stageSize(buildStageComponent('stage'))).toBe('10 × 6 m')
    expect(stageSize([])).toBeNull()
  })
})
