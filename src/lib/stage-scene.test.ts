import { describe, expect, it } from 'vitest'
import { projectReadError } from './project-access'
import {
  STAGE_MAX_ELEMENTS,
  STAGE_SCENE_MAX_BYTES,
  canReadStageSetups,
  isSafeElementLink,
  normalizeStageNotes,
  normalizeStageTitle,
  parseStageScene,
  stageFileName,
} from './stage-scene'

const el = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...over,
})

describe('parseStageScene', () => {
  it('godtar en vanlig tegning og beholder ukjente felt', () => {
    const scene = parseStageScene({ elements: [el({ customData: { tb: 'chair' } })], appState: { gridSize: 20 } })
    expect(scene.elements[0]).toMatchObject({ id: 'a', customData: { tb: 'chair' } })
    expect(scene.appState.gridSize).toBe(20)
  })

  it('gir tom appState når den mangler', () => {
    expect(parseStageScene({ elements: [] }).appState).toEqual({})
  })

  it.each(['image', 'embeddable', 'iframe', 'magicframe', 'selection'])('avviser elementtypen %s', (type) => {
    expect(() => parseStageScene({ elements: [el({ type })], appState: {} })).toThrow(/kunne ikke lagres/)
  })

  it('avviser farlige lenker, også med kontrolltegn i skjemaet', () => {
    for (const link of ['javascript:alert(1)', 'java\tscript:alert(1)', ' JAVASCRIPT:x', 'data:text/html,<b>', 'vbscript:x']) {
      expect(() => parseStageScene({ elements: [el({ link })] })).toThrow()
    }
  })

  it('godtar vanlige lenker', () => {
    for (const link of ['https://tertnesbrass.com', 'mailto:a@b.no', '/noter', '?element=abc', null]) {
      expect(() => parseStageScene({ elements: [el({ link })] })).not.toThrow()
    }
  })

  it('avviser like id-er', () => {
    expect(() => parseStageScene({ elements: [el(), el()] })).toThrow(/like element-id-er/)
  })

  it('avviser ukjente appState-felt (editorens egne valg lagres ikke)', () => {
    expect(() => parseStageScene({ elements: [], appState: { zoom: { value: 2 } } })).toThrow()
  })

  it('avviser ikke-endelige koordinater', () => {
    expect(() => parseStageScene({ elements: [el({ x: Number.POSITIVE_INFINITY })] })).toThrow()
    expect(() => parseStageScene({ elements: [el({ width: -1 })] })).toThrow()
  })

  it('tar ut slettede elementer', () => {
    const scene = parseStageScene({ elements: [el(), el({ id: 'b', isDeleted: true })] })
    expect(scene.elements.map((e) => e.id)).toEqual(['a'])
  })

  it('avviser for store tegninger', () => {
    const big = 'x'.repeat(STAGE_SCENE_MAX_BYTES)
    expect(() => parseStageScene({ elements: [el({ customData: { big } })] })).toThrow(/for stor/)
  })

  it('avviser for mange elementer', () => {
    const elements = Array.from({ length: STAGE_MAX_ELEMENTS + 1 }, (_, i) => el({ id: `e${i}` }))
    expect(() => parseStageScene({ elements })).toThrow(/for mange/)
  })

  it('avviser noe som ikke er en tegning', () => {
    expect(() => parseStageScene(null)).toThrow()
    expect(() => parseStageScene({ elements: 'x' })).toThrow()
    expect(() => parseStageScene({ elements: [], files: {} })).toThrow()
  })
})

describe('isSafeElementLink', () => {
  it('skiller trygge og utrygge skjema', () => {
    expect(isSafeElementLink('http://x.no')).toBe(true)
    expect(isSafeElementLink('relativ/sti')).toBe(true)
    expect(isSafeElementLink('javascript:void(0)')).toBe(false)
    expect(isSafeElementLink('\u0000javascript:x')).toBe(false)
  })
})

describe('tittel og merknader', () => {
  it('normaliserer tittelen og krever innhold', () => {
    expect(normalizeStageTitle('  Korps   oppsett \n')).toBe('Korps oppsett')
    expect(() => normalizeStageTitle('   ')).toThrow(/navn/)
    expect(normalizeStageTitle('x'.repeat(500))).toHaveLength(120)
  })

  it('normaliserer merknader og gjør tomt til null', () => {
    expect(normalizeStageNotes(' a\r\nb ')).toBe('a\nb')
    expect(normalizeStageNotes('  ')).toBeNull()
    expect(normalizeStageNotes(null)).toBeNull()
  })
})

describe('canReadStageSetups', () => {
  const today = '2026-11-02'
  const member = { canManageProjects: false, canBrowseArchive: false, canManageStage: false }
  const stage = { ...member, canManageStage: true }
  const manager = { ...member, canManageProjects: true }
  const upcoming = { isPublished: true, eventDate: '2026-12-01' }
  const past = { isPublished: true, eventDate: '2026-01-01' }
  const draft = { isPublished: false, eventDate: '2026-12-01' }

  it('følger prosjektsidens regel for vanlige medlemmer', () => {
    expect(canReadStageSetups(upcoming, member, today)).toBe(true)
    expect(canReadStageSetups(past, member, today)).toBe(false)
    expect(canReadStageSetups(draft, member, today)).toBe(false)
  })

  it('lar stage.manage lese tidligere publiserte prosjekter, men aldri utkast', () => {
    expect(canReadStageSetups(past, stage, today)).toBe(true)
    expect(canReadStageSetups(draft, stage, today)).toBe(false)
  })

  it('lar projects.manage lese alt', () => {
    expect(canReadStageSetups(draft, manager, today)).toBe(true)
    expect(canReadStageSetups(past, manager, today)).toBe(true)
  })

  it('arkivinnsyn gir tidligere prosjekter, ikke utkast', () => {
    const archive = { ...member, canBrowseArchive: true }
    expect(canReadStageSetups(past, archive, today)).toBe(true)
    expect(canReadStageSetups(draft, archive, today)).toBe(false)
  })
})

describe('projectReadError', () => {
  const viewer = { canManage: false, canBrowseArchive: false }
  it('har samme meldinger som prosjektsiden alltid har hatt', () => {
    expect(projectReadError({ isPublished: false, eventDate: null }, viewer, '2026-11-02')).toBe(
      'Prosjektet er ikke publisert ennå',
    )
    expect(projectReadError({ isPublished: true, eventDate: null }, viewer, '2026-11-02')).toBe(
      'Prosjektet er ikke lenger tilgjengelig',
    )
    expect(projectReadError({ isPublished: true, eventDate: '2026-11-02' }, viewer, '2026-11-02')).toBeNull()
  })
})

describe('stageFileName', () => {
  it('fjerner tegn som er ulovlige i filnavn', () => {
    expect(stageFileName('NM: Div 1/2', 'Korps*oppsett', 'pdf')).toBe('NM- Div 1-2 – Korps-oppsett.pdf')
  })
})
