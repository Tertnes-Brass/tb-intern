import { describe, expect, it } from 'vitest'
import {
  MAX_STAGE_ELEMENTS,
  STAGE_HEIGHT,
  STAGE_LABEL_MAX,
  STAGE_WIDTH,
  type StageElement,
  addStageElement,
  canManageStagePlot,
  clampToStage,
  countStageElements,
  labelStageElement,
  moveStageElement,
  normalizeRotation,
  parseStagePlot,
  removeStageElement,
  rotateStageElement,
  serializeStagePlot,
  snapRotation,
  stagePlotFileName,
  stageSummary,
  standaloneStageSvg,
} from './scene'

const el = (over: Partial<StageElement> = {}): StageElement => ({
  id: 'a',
  type: 'chair',
  x: 100,
  y: 100,
  rotation: 0,
  label: null,
  ...over,
})

describe('canManageStagePlot', () => {
  it('følger samme regel som riggelista — to eiere', () => {
    expect(canManageStagePlot(['projects.manage'])).toBe(true)
    expect(canManageStagePlot(['assets.manage'])).toBe(true)
    expect(canManageStagePlot(['*'])).toBe(true)
    expect(canManageStagePlot(['calendar.manage'])).toBe(false)
  })
})

describe('parseStagePlot', () => {
  it('leser en gyldig layout fra JSON-streng', () => {
    const plot = parseStagePlot('{"elements":[{"id":"a","type":"chair","x":10,"y":20,"rotation":45}]}')
    expect(plot.elements).toEqual([{ id: 'a', type: 'chair', x: 10, y: 20, rotation: 45, label: null }])
  })

  // Tolerant, ikke tillitsfull: en ødelagt rad skal gjøre tegningen tom,
  // ikke gjøre prosjektsiden utilgjengelig.
  it('gir et tomt oppsett av søppel i stedet for å kaste', () => {
    expect(parseStagePlot('ikke json').elements).toEqual([])
    expect(parseStagePlot(null).elements).toEqual([])
    expect(parseStagePlot(42).elements).toEqual([])
    expect(parseStagePlot({}).elements).toEqual([])
    expect(parseStagePlot({ elements: 'nei' }).elements).toEqual([])
  })

  it('dropper ukjente elementtyper — et rått kall kan ikke finne opp egne', () => {
    const plot = parseStagePlot({
      elements: [{ id: 'a', type: 'flygel', x: 1, y: 1 }, { id: 'b', type: 'chair', x: 1, y: 1 }],
    })
    expect(plot.elements.map((e) => e.type)).toEqual(['chair'])
  })

  it('klemmer koordinater inn på scenen', () => {
    const plot = parseStagePlot({ elements: [{ id: 'a', type: 'chair', x: -50, y: 99999 }] })
    expect(plot.elements[0]).toMatchObject({ x: 0, y: STAGE_HEIGHT })
  })

  it('normaliserer rotasjon til 0–359', () => {
    const plot = parseStagePlot({ elements: [{ id: 'a', type: 'chair', x: 0, y: 0, rotation: -90 }] })
    expect(plot.elements[0]!.rotation).toBe(270)
  })

  it('kutter etiketten og fjerner den fra typer som ikke bruker den', () => {
    const plot = parseStagePlot({
      elements: [
        { id: 'a', type: 'percussion', x: 0, y: 0, label: 'x'.repeat(200) },
        { id: 'b', type: 'chair', x: 0, y: 0, label: 'skal bort' },
      ],
    })
    expect(plot.elements[0]!.label).toHaveLength(STAGE_LABEL_MAX)
    expect(plot.elements[1]!.label).toBeNull()
  })

  it('dropper duplikate id-er — «flytt dette elementet» må være entydig', () => {
    const plot = parseStagePlot({
      elements: [
        { id: 'a', type: 'chair', x: 0, y: 0 },
        { id: 'a', type: 'stand', x: 10, y: 10 },
      ],
    })
    expect(plot.elements).toHaveLength(1)
    expect(plot.elements[0]!.type).toBe('chair')
  })

  it('håndhever taket på antall elementer', () => {
    const many = Array.from({ length: MAX_STAGE_ELEMENTS + 40 }, (_, i) => ({
      id: `e${i}`,
      type: 'chair',
      x: 0,
      y: 0,
    }))
    expect(parseStagePlot({ elements: many }).elements).toHaveLength(MAX_STAGE_ELEMENTS)
  })

  it('er idempotent gjennom serialisering', () => {
    const plot = parseStagePlot({
      elements: [{ id: 'a', type: 'percussion', x: 12, y: 34, rotation: 90, label: 'Pauker' }],
    })
    expect(parseStagePlot(serializeStagePlot(plot))).toEqual(plot)
  })
})

describe('rotasjon og posisjon', () => {
  it('snapper til de åtte retningene', () => {
    expect(snapRotation(10)).toBe(0)
    expect(snapRotation(30)).toBe(45)
    expect(snapRotation(350)).toBe(0)
    expect(snapRotation(-45)).toBe(315)
  })

  it('tåler NaN uten å ødelegge oppsettet', () => {
    expect(normalizeRotation(Number.NaN)).toBe(0)
    expect(clampToStage(Number.NaN, Number.NaN)).toEqual({
      x: Math.round(STAGE_WIDTH / 2),
      y: Math.round(STAGE_HEIGHT / 2),
    })
  })
})

describe('redigeringsoperasjonene', () => {
  it('legger til, flytter, roterer, merker og fjerner', () => {
    let elements = addStageElement([], el({ id: 'a' }))
    elements = addStageElement(elements, el({ id: 'b', type: 'percussion' }))
    elements = moveStageElement(elements, 'a', 5000, -20)
    expect(elements[0]).toMatchObject({ x: STAGE_WIDTH, y: 0 })

    elements = rotateStageElement(elements, 'a', -45)
    expect(elements[0]!.rotation).toBe(315)

    elements = labelStageElement(elements, 'b', '  Pauker  ')
    expect(elements[1]!.label).toBe('Pauker')

    // En stol har ingen etikett, uansett hva noen prøver å sette på den.
    elements = labelStageElement(elements, 'a', 'Stol nr 1')
    expect(elements[0]!.label).toBeNull()

    expect(removeStageElement(elements, 'a').map((e) => e.id)).toEqual(['b'])
  })

  it('nekter å legge til over taket', () => {
    const full = Array.from({ length: MAX_STAGE_ELEMENTS }, (_, i) => el({ id: `e${i}` }))
    expect(() => addStageElement(full, el({ id: 'ny' }))).toThrow(/Maks/)
  })
})

describe('opptelling', () => {
  const elements = [
    el({ id: '1', type: 'chair' }),
    el({ id: '2', type: 'chair' }),
    el({ id: '3', type: 'stand' }),
    el({ id: '4', type: 'podium' }),
    el({ id: '5', type: 'percussion', label: 'Pauker' }),
    el({ id: '6', type: 'percussion', label: 'Pauker' }),
  ]

  it('teller per type i palettens rekkefølge, og hopper over tomme typer', () => {
    expect(countStageElements(elements).map((c) => c.label)).toEqual([
      '2 stoler',
      '1 notestativ',
      '1 dirigentpodium',
      '2 slagverk',
    ])
  })

  // Norsk intetkjønn: «4 notestativ», ikke «4 notestativer».
  it('bøyer entall og flertall riktig', () => {
    expect(countStageElements([el({ type: 'chair' })])[0]!.label).toBe('1 stol')
    expect(
      countStageElements([el({ id: 'a', type: 'stand' }), el({ id: 'b', type: 'stand' })])[0]!.label,
    ).toBe('2 notestativ')
  })

  it('samler distinkte fritekst-etiketter uten duplikater', () => {
    const perc = countStageElements(elements).find((c) => c.type === 'percussion')!
    expect(perc.labels).toEqual(['Pauker'])
  })

  it('oppsummerer på én linje, og er ærlig når scenen er tom', () => {
    expect(stageSummary(elements)).toBe('2 stoler, 1 notestativ, 1 dirigentpodium, 2 slagverk')
    expect(stageSummary([])).toBe('Ingen elementer plassert ennå')
  })
})

describe('standaloneStageSvg', () => {
  const markup = '<svg viewBox="0 0 10 10"><rect fill="var(--ink)" /></svg>'

  it('legger på xmlns slik at fila er en SVG også utenfor nettleseren', () => {
    const out = standaloneStageSvg(markup, {})
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('dobler ikke xmlns når den allerede står der', () => {
    const out = standaloneStageSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', {})
    expect(out.match(/xmlns=/g)).toHaveLength(1)
  })

  // Fargene kommer fra design-tokenene, lest ut av :root ved nedlasting —
  // ingen hardkodede farger noe sted i koden.
  it('skriver token-verdiene inn i fila', () => {
    const out = standaloneStageSvg(markup, { '--ink': '#211b12', '--brass': '#95762a' })
    expect(out).toContain('--ink: #211b12;')
    expect(out).toContain('--brass: #95762a;')
    expect(out).toContain('<rect fill="var(--ink)" />')
  })

  it('dropper style-blokken helt når ingen tokens er kjent', () => {
    expect(standaloneStageSvg(markup, {})).not.toContain('<style>')
  })

  it('sier fra når markeringen ikke er en SVG', () => {
    expect(() => standaloneStageSvg('<div></div>', {})).toThrow(/Fant ikke/)
  })
})

describe('stagePlotFileName', () => {
  it('skriver om norske bokstaver i stedet for å stryke dem', () => {
    expect(stagePlotFileName('Vårkonsert i Ådnahall')).toBe('sceneoppsett-varkonsert-i-adnahall.svg')
    expect(stagePlotFileName('Blæst & Brød')).toBe('sceneoppsett-blaest-brod.svg')
  })

  it('faller tilbake på noe lesbart når navnet ikke gir en slug', () => {
    expect(stagePlotFileName('!!!')).toBe('sceneoppsett-prosjekt.svg')
  })
})
