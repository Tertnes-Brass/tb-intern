import { describe, expect, it } from 'vitest'
import { faceConductor } from './stage-arrange'
import { equipmentList, isExtraChair, percussionRigOrder, stageKind, stageSize } from './stage-components'
import { STAGE_SCALE, bounds } from './stage-elements'
import { parseStageScene } from './stage-scene'
import { STAGE_SIZE_LIMITS, STAGE_TEMPLATES, buildStageTemplate, clampStageSize } from './stage-templates'

const counts = (id: (typeof STAGE_TEMPLATES)[number]['id']) =>
  Object.fromEntries(equipmentList(buildStageTemplate(id)).map((l) => [l.key, l.count]))

describe('buildStageTemplate', () => {
  it.each(STAGE_TEMPLATES.map((t) => [t.id]))('%s er en gyldig tegning med unike id-er', (id) => {
    const elements = buildStageTemplate(id)
    expect(() => parseStageScene({ elements, appState: {} })).not.toThrow()
    expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length)
  })

  it('standard er Kim Systads oppsett: 26 plasser, 39 stoler + paukekrakk, 35 notestativ', () => {
    const c = counts('standard')
    // 13 doble stoler: sopran, repiano, 2. og 3. kornett, bassene og trombonene.
    expect(c.chair).toBe(39)
    expect(c.stool).toBe(1)
    // 26 plasser, dirigenten og åtte instrumenter med stativ.
    expect(c.stand).toBe(35)
    expect(c.podium).toBe(1)
    expect(c.timpani).toBe(4)
    expect(c['drum-kit']).toBe(1)
    expect(c['clash-cymbals']).toBe(1)
    expect(c['tam-tam']).toBe(1)
  })

  it('standard har slagverket i samme riggerekkefølge som Kims oppsett', () => {
    expect(percussionRigOrder(buildStageTemplate('standard'))).toEqual([
      'Pauker (4)',
      'Trommesett',
      'Stortromme',
      'Tam-tam',
      'Hengende cymbal',
      'Clash cymbals (par)',
      'Skarptromme',
      'Klokkespill',
      'Vibrafon',
      'Xylofon',
      'Marimba',
    ])
  })

  it('storband har trommesettet i midten og kornettene bakerst', () => {
    const elements = buildStageTemplate('big-band')
    const kit = elements.find((e) => stageKind(e) === 'drum-kit')!
    expect(kit.x + kit.width / 2).toBeCloseTo(0, 0)
    const chairs = elements.filter((e) => stageKind(e) === 'chair' && !isExtraChair(e))
    const cornets = chairs.filter((e) => (e.customData as { section?: string }).section === 'cornet')
    const others = chairs.filter((e) => ['trombone', 'tuba', 'euph-bari'].includes((e.customData as { section?: string }).section ?? ''))
    expect(cornets).toHaveLength(11)
    expect(Math.max(...cornets.map((e) => e.y))).toBeLessThan(Math.min(...others.map((e) => e.y)))
    expect(Math.max(...cornets.map((e) => e.y))).toBeLessThan(kit.y)
  })

  it.each([['standard'], ['big-band']] as const)('%s: stolene overlapper ikke hverandre (bortsett fra en dobbel stol med seg selv)', (id) => {
    const chairs = buildStageTemplate(id).filter((e) => stageKind(e) === 'chair')
    for (let i = 0; i < chairs.length; i++) {
      for (let j = i + 1; j < chairs.length; j++) {
        const a = chairs[i]!
        const b = chairs[j]!
        if (a.groupIds[0] === b.groupIds[0]) continue
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap, `${i} og ${j}`).toBe(false)
      }
    }
  })

  it.each(STAGE_TEMPLATES.map((t) => [t.id]))('%s: stativene står allerede mot dirigenten', (id) => {
    const elements = buildStageTemplate(id)
    expect(faceConductor(elements, { id: () => 'x', int: () => 1, now: 0 }).changed).toBe(0)
  })

  it.each(STAGE_TEMPLATES.map((t) => [t.id]))('%s holder seg innenfor scenen (bortsett fra publikum og målestokk)', (id) => {
    const elements = buildStageTemplate(id)
    const stage = elements.find((e) => stageKind(e) === 'stage')!
    const inside = elements.filter((e) => !['stage', 'audience', 'scale'].includes(stageKind(e) ?? '') && !e.groupIds.some((g) => elements.some((x) => stageKind(x) === 'scale' && x.groupIds.includes(g))))
    const box = bounds(inside)
    expect(box.minX).toBeGreaterThanOrEqual(stage.x)
    expect(box.maxX).toBeLessThanOrEqual(stage.x + stage.width)
    expect(box.minY).toBeGreaterThanOrEqual(stage.y)
    expect(box.maxY).toBeLessThanOrEqual(stage.y + stage.height)
  })

  it('låser scenen og publikum, så de ikke dras med når man flytter stoler', () => {
    const elements = buildStageTemplate('empty')
    expect(elements.find((e) => stageKind(e) === 'stage')!.locked).toBe(true)
    expect(elements.find((e) => stageKind(e) === 'audience')!.locked).toBe(true)
  })

  it('bruker scenestørrelsen, med publikum nederst', () => {
    const elements = buildStageTemplate('empty', { width: 9.5, depth: 6 })
    expect(stageSize(elements)).toBe('9,5 × 6 m')
    const stage = elements.find((e) => stageKind(e) === 'stage')!
    expect(stage.y + stage.height).toBe(0)
    expect(stage.x).toBe(-4.75 * STAGE_SCALE)
  })
})

describe('clampStageSize', () => {
  it('klemmer og runder', () => {
    expect(clampStageSize(undefined, 12)).toBe(12)
    expect(clampStageSize(Number.NaN, 12)).toBe(12)
    expect(clampStageSize(0.5, 12)).toBe(STAGE_SIZE_LIMITS.min)
    expect(clampStageSize(400, 12)).toBe(STAGE_SIZE_LIMITS.max)
    expect(clampStageSize(10.04, 12)).toBe(10)
  })
})
