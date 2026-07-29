import { describe, expect, it } from 'vitest'
import {
  buildSplitPlan,
  countPages,
  formatPageRanges,
  normalizePageRanges,
  pageIndices,
  pageNumbers,
  parsePageRanges,
  type PageRange,
} from './pdf-ranges'

/** Kortform: tolk uttrykket mot et 12-siders hefte og gi «1-3, 7»-strengen tilbake. */
function round(expr: string, pageCount = 12): string {
  const parsed = parsePageRanges(expr, pageCount)
  if (!parsed.ok) throw new Error(`ventet gyldig uttrykk, fikk: ${parsed.error}`)
  return formatPageRanges(parsed.ranges)
}

/** Feilmeldingen for et ugyldig uttrykk. */
function reject(expr: string, pageCount = 12): string {
  const parsed = parsePageRanges(expr, pageCount)
  if (parsed.ok) throw new Error(`ventet feil, fikk: ${formatPageRanges(parsed.ranges)}`)
  return parsed.error
}

const r = (from: number, to = from): PageRange => ({ from, to })

describe('parsePageRanges', () => {
  it('tolker uttrykket fra saken', () => {
    expect(round('1-3, 7, 9-11')).toBe('1-3, 7, 9-11')
  })

  it('godtar semikolon, linjeskift og slurvete mellomrom', () => {
    expect(round('1-3; 7\n9 - 11')).toBe('1-3, 7, 9-11')
    expect(round('  4 ,, 5  ')).toBe('4-5')
  })

  it('godtar tankestrek fra innliming', () => {
    expect(round('1–3, 5—6')).toBe('1-3, 5-6')
  })

  it('gir tomt resultat for et ufylt uttrykk — ikke en feil', () => {
    expect(parsePageRanges('', 12)).toEqual({ ok: true, ranges: [] })
    expect(parsePageRanges('  , ; \n ', 12)).toEqual({ ok: true, ranges: [] })
  })

  it('forstår åpen ende i begge retninger', () => {
    expect(round('9-')).toBe('9-12')
    expect(round('-3')).toBe('1-3')
  })

  it('retter et snudd intervall stille', () => {
    expect(round('11-9')).toBe('9-11')
  })

  it('slår sammen og sorterer under tolkingen', () => {
    expect(round('7, 1-3, 2-4, 8')).toBe('1-4, 7-8')
  })

  it('avviser sider utenfor dokumentet', () => {
    expect(reject('1-13')).toBe('Side 13 finnes ikke — dokumentet har 12 sider')
    expect(reject('4', 1)).toBe('Side 4 finnes ikke — dokumentet har 1 side')
  })

  it('avviser side 0 og negative sidetall', () => {
    expect(reject('0')).toBe('Sidetall starter på 1')
    expect(reject('0-4')).toBe('Sidetall starter på 1')
  })

  it('avviser det som ikke er sidetall i det hele tatt', () => {
    expect(reject('kornett')).toBe('«kornett» er ikke et sideintervall')
    expect(reject('1-3, 4b')).toBe('«4b» er ikke et sideintervall')
    expect(reject('-')).toBe('«-» er ikke et sideintervall')
  })

  it('nekter å tolke noe før sidetallet er kjent', () => {
    expect(reject('1-3', 0)).toBe('Sidetallet i dokumentet er ikke kjent')
    expect(parsePageRanges('1-3', 1.5).ok).toBe(false)
  })
})

describe('normalizePageRanges', () => {
  it('slår sammen overlappende og inntilliggende intervaller', () => {
    expect(normalizePageRanges([r(3, 4), r(1, 2), r(2)])).toEqual([r(1, 4)])
  })

  it('lar et hull på minst én side stå', () => {
    expect(normalizePageRanges([r(1, 3), r(5, 6)])).toEqual([r(1, 3), r(5, 6)])
  })

  it('er idempotent og rører ikke inndata', () => {
    const input = [r(5, 6), r(1, 3), r(4)]
    const once = normalizePageRanges(input)
    expect(normalizePageRanges(once)).toEqual(once)
    expect(input).toEqual([r(5, 6), r(1, 3), r(4)])
  })

  it('slår sammen et intervall som ligger helt inne i et annet', () => {
    expect(normalizePageRanges([r(1, 10), r(4, 5)])).toEqual([r(1, 10)])
  })
})

describe('sider ut av intervaller', () => {
  it('lister sidetall og pdf-lib-indekser', () => {
    expect(pageNumbers([r(9, 11), r(1)])).toEqual([1, 9, 10, 11])
    expect(pageIndices([r(9, 11), r(1)])).toEqual([0, 8, 9, 10])
  })

  it('teller unike sider, også når intervallene overlapper', () => {
    expect(countPages([r(1, 3), r(2, 4)])).toBe(4)
    expect(countPages([])).toBe(0)
  })

  it('formaterer enkeltsider uten bindestrek', () => {
    expect(formatPageRanges([r(7)])).toBe('7')
    expect(formatPageRanges([])).toBe('')
  })
})

describe('buildSplitPlan', () => {
  it('lager én utfil per stemme og rapporterer sider uten stemme', () => {
    const plan = buildSplitPlan(
      [
        { partId: 'solo-cornet', ranges: [r(2, 4)] },
        { partId: 'euphonium', ranges: [r(5, 7)] },
      ],
      9,
    )
    expect(plan.parts).toEqual([
      { partId: 'solo-cornet', ranges: [r(2, 4)], pageCount: 3 },
      { partId: 'euphonium', ranges: [r(5, 7)], pageCount: 3 },
    ])
    expect(plan.overlaps).toEqual([])
    expect(plan.unassigned).toEqual([r(1), r(8, 9)])
    expect(plan.assignedPageCount).toBe(6)
  })

  it('slår sammen flere rader på samme stemme til én fil', () => {
    // Stemmen dukker opp to steder i heftet — det skal bli én PDF, ikke to.
    const plan = buildSplitPlan(
      [
        { partId: 'euphonium', ranges: [r(2, 3)] },
        { partId: 'solo-cornet', ranges: [r(4, 5)] },
        { partId: 'euphonium', ranges: [r(6)] },
      ],
      6,
    )
    expect(plan.parts).toEqual([
      { partId: 'euphonium', ranges: [r(2, 3), r(6)], pageCount: 3 },
      { partId: 'solo-cornet', ranges: [r(4, 5)], pageCount: 2 },
    ])
    expect(plan.overlaps).toEqual([])
  })

  it('slår sammen inntilliggende rader på samme stemme', () => {
    const plan = buildSplitPlan(
      [
        { partId: 'euphonium', ranges: [r(2, 3)] },
        { partId: 'euphonium', ranges: [r(4, 5)] },
      ],
      5,
    )
    expect(plan.parts).toEqual([{ partId: 'euphonium', ranges: [r(2, 5)], pageCount: 4 }])
  })

  it('rapporterer overlapp mellom to ulike stemmer', () => {
    const plan = buildSplitPlan(
      [
        { partId: 'solo-cornet', ranges: [r(1, 4)] },
        { partId: 'second-cornet', ranges: [r(3, 6)] },
      ],
      6,
    )
    expect(plan.overlaps).toEqual([{ partA: 'solo-cornet', partB: 'second-cornet', pages: [3, 4] }])
    expect(plan.unassigned).toEqual([])
    // Overlapp dobbelttelles ikke i «tildelte sider».
    expect(plan.assignedPageCount).toBe(6)
  })

  it('finner overlapp i alle par, ikke bare naboer', () => {
    const plan = buildSplitPlan(
      [
        { partId: 'a', ranges: [r(1, 2)] },
        { partId: 'b', ranges: [r(5)] },
        { partId: 'c', ranges: [r(2, 5)] },
      ],
      5,
    )
    expect(plan.overlaps).toEqual([
      { partA: 'a', partB: 'c', pages: [2] },
      { partA: 'b', partB: 'c', pages: [5] },
    ])
  })

  it('hopper over rader uten intervaller', () => {
    const plan = buildSplitPlan(
      [
        { partId: 'score', ranges: [] },
        { partId: 'euphonium', ranges: [r(1, 2)] },
      ],
      2,
    )
    expect(plan.parts.map((p) => p.partId)).toEqual(['euphonium'])
  })

  it('gir en tom plan for ingen rader — alt er da utildelt', () => {
    const plan = buildSplitPlan([], 3)
    expect(plan.parts).toEqual([])
    expect(plan.overlaps).toEqual([])
    expect(plan.unassigned).toEqual([r(1, 3)])
    expect(plan.assignedPageCount).toBe(0)
  })
})
