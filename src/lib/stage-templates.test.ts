import { describe, expect, it } from 'vitest'
import { equipmentList, stageKind, stageSize } from './stage-components'
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

  it('brass band har full besetning: 25 stoler, stativ til alle + dirigent, fire pauker', () => {
    const c = counts('brass-band')
    expect(c.chair).toBe(25)
    expect(c.stand).toBe(26)
    expect(c.podium).toBe(1)
    expect(c.timpani).toBe(4)
    expect(c['drum-kit']).toBe(1)
  })

  it('brass band-stolene overlapper ikke hverandre', () => {
    const chairs = buildStageTemplate('brass-band').filter((e) => stageKind(e) === 'chair')
    for (let i = 0; i < chairs.length; i++) {
      for (let j = i + 1; j < chairs.length; j++) {
        const a = chairs[i]!
        const b = chairs[j]!
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap, `${i} og ${j}`).toBe(false)
      }
    }
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
