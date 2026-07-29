import { describe, expect, it } from 'vitest'
import {
  type ArchiveSearch,
  type SortableWork,
  type WorkCoverage,
  buildFilterOptions,
  compareWorks,
  countActiveFilters,
  defaultDirFor,
  isMissingListeningExample,
  isMissingParts,
  isMissingScore,
  matchesMissing,
  parseArchiveSearch,
  resolveWorkFilter,
  serializeArchiveSearch,
  sortWorks,
} from './work-filter'

// ---------- Search params ----------

describe('parseArchiveSearch', () => {
  it('tomt input → tomt filter (ingen standardvalg i URL-en)', () => {
    expect(parseArchiveSearch({})).toEqual({})
    expect(resolveWorkFilter(parseArchiveSearch({}))).toEqual({
      q: '',
      composer: null,
      arranger: null,
      genre: null,
      grade: null,
      year: null,
      status: 'active',
      missing: [],
      sort: 'title',
      dir: 'asc',
    })
  })

  it('resolveWorkFilter(undefined) gir samme standardvalg som tomt input', () => {
    expect(resolveWorkFilter(undefined)).toEqual(resolveWorkFilter({}))
  })

  it('leser strenger, tall og lister fra URL-en (tall kan komme som streng)', () => {
    expect(
      parseArchiveSearch({
        q: '  eagles  ',
        composer: 'Paul Lovatt-Cooper',
        genre: 'Marsj',
        grade: '4',
        year: '2024',
        status: 'archived',
        missing: 'audio,parts',
        sort: 'grade',
        dir: 'desc',
      }),
    ).toEqual({
      q: 'eagles',
      composer: 'Paul Lovatt-Cooper',
      genre: 'Marsj',
      grade: 4,
      year: 2024,
      status: 'archived',
      missing: 'parts,audio', // kanonisk rekkefølge
      sort: 'grade',
      dir: 'desc',
    })
  })

  it('forkaster søppel: ukjente nøkler, grad utenfor 1–5 og tomme strenger', () => {
    expect(
      parseArchiveSearch({
        q: '   ',
        grade: '9',
        year: 'i fjor',
        status: 'slettet',
        missing: 'parts,tuba,,parts',
        sort: 'tilfeldig',
        dir: 'oppned',
      }),
    ).toEqual({ missing: 'parts' })
  })

  it('utelater standardvalg (aktive verk, tittel A–Å, nyeste først)', () => {
    expect(parseArchiveSearch({ status: 'active', sort: 'title', dir: 'asc' })).toEqual({})
    expect(parseArchiveSearch({ sort: 'updated', dir: 'desc' })).toEqual({ sort: 'updated' })
    expect(parseArchiveSearch({ sort: 'updated', dir: 'asc' })).toEqual({ sort: 'updated', dir: 'asc' })
    // Tittel synkende er ikke standard og må bli med selv om `sort` utelates
    expect(parseArchiveSearch({ dir: 'desc' })).toEqual({ dir: 'desc' })
  })

  it('rundtur: search → filter → search er identitet', () => {
    const cases: ArchiveSearch[] = [
      {},
      { q: 'eagles' },
      { composer: 'Sparke', arranger: 'Nordmann', genre: 'Hymne', grade: 3, year: 1998 },
      { status: 'all', missing: 'parts,score,audio' },
      { sort: 'duration', dir: 'desc' },
      { sort: 'updated' },
      { q: 'fanfare', status: 'archived', missing: 'score', sort: 'composer', dir: 'desc' },
    ]
    for (const search of cases) {
      expect(serializeArchiveSearch(resolveWorkFilter(search))).toEqual(search)
    }
  })

  it('serialisering normaliserer «mangler»-rekkefølgen (klikkerekkefølge betyr ikke noe)', () => {
    const filter = resolveWorkFilter({})
    expect(serializeArchiveSearch({ ...filter, missing: ['audio', 'parts'] }).missing).toBe('parts,audio')
    expect(serializeArchiveSearch({ ...filter, missing: ['score', 'score'] }).missing).toBe('score')
  })

  it('rundtur: filter → search → filter er identitet', () => {
    const filter = resolveWorkFilter({ q: 'eagles', grade: 5, missing: 'audio', sort: 'grade', dir: 'desc' })
    expect(resolveWorkFilter(serializeArchiveSearch(filter))).toEqual(filter)
  })

  it('defaultDirFor: bare «sist oppdatert» snus', () => {
    expect(defaultDirFor('updated')).toBe('desc')
    expect(defaultDirFor('title')).toBe('asc')
    expect(defaultDirFor('grade')).toBe('asc')
  })
})

describe('countActiveFilters', () => {
  it('ingen filter → 0, og sortering teller ikke', () => {
    expect(countActiveFilters(resolveWorkFilter({}))).toBe(0)
    expect(countActiveFilters(resolveWorkFilter({ sort: 'grade', dir: 'desc' }))).toBe(0)
  })

  it('teller hver dimensjon, og hvert «mangler»-valg for seg', () => {
    expect(countActiveFilters(resolveWorkFilter({ q: 'eagles' }))).toBe(1)
    expect(countActiveFilters(resolveWorkFilter({ status: 'all' }))).toBe(1)
    expect(countActiveFilters(resolveWorkFilter({ missing: 'parts,score' }))).toBe(2)
    expect(
      countActiveFilters(
        resolveWorkFilter({ q: 'a', composer: 'b', arranger: 'c', genre: 'd', grade: 2, year: 2000 }),
      ),
    ).toBe(6)
  })
})

// ---------- «Mangler»-predikater ----------

function coverage(over: Partial<WorkCoverage['counts']> & { linkCount?: number } = {}): WorkCoverage {
  const { linkCount = 0, ...counts } = over
  return { counts: { parts: 0, score: 0, audio: 0, ...counts }, linkCount }
}

describe('mangler-predikater', () => {
  it('isMissingParts: ingen stemmefiler', () => {
    expect(isMissingParts(coverage())).toBe(true)
    expect(isMissingParts(coverage({ score: 1, audio: 1, linkCount: 1 }))).toBe(true)
    expect(isMissingParts(coverage({ parts: 1 }))).toBe(false)
  })

  it('isMissingScore: ingen partitur', () => {
    expect(isMissingScore(coverage())).toBe(true)
    expect(isMissingScore(coverage({ parts: 24 }))).toBe(true)
    expect(isMissingScore(coverage({ score: 1 }))).toBe(false)
  })

  it('isMissingListeningExample: verken lydfil eller lenke', () => {
    expect(isMissingListeningExample(coverage())).toBe(true)
    expect(isMissingListeningExample(coverage({ parts: 24, score: 1 }))).toBe(true)
    expect(isMissingListeningExample(coverage({ audio: 1 }))).toBe(false)
    expect(isMissingListeningExample(coverage({ linkCount: 1 }))).toBe(false)
    expect(isMissingListeningExample(coverage({ audio: 1, linkCount: 2 }))).toBe(false)
  })

  it('matchesMissing: tomt valg slipper alt gjennom', () => {
    expect(matchesMissing(coverage({ parts: 1, score: 1, audio: 1 }), [])).toBe(true)
    expect(matchesMissing(coverage(), [])).toBe(true)
  })

  it('matchesMissing: OR innenfor fasetten — minst én mangel holder', () => {
    const komplett = coverage({ parts: 24, score: 1, audio: 1 })
    const utenPartitur = coverage({ parts: 24, linkCount: 1 })
    expect(matchesMissing(komplett, ['parts', 'score', 'audio'])).toBe(false)
    expect(matchesMissing(utenPartitur, ['score'])).toBe(true)
    expect(matchesMissing(utenPartitur, ['parts'])).toBe(false)
    expect(matchesMissing(utenPartitur, ['parts', 'score'])).toBe(true)
  })
})

// ---------- Sortering ----------

function work(over: Partial<SortableWork> & { title: string }): SortableWork {
  return { composer: null, grade: null, durationSec: null, updatedAt: 0, ...over }
}

const titles = (rows: SortableWork[]) => rows.map((r) => r.title)

describe('sortWorks', () => {
  it('tom liste → tom liste, og input muteres ikke', () => {
    expect(sortWorks([], 'title', 'asc')).toEqual([])
    const rows = [work({ title: 'B' }), work({ title: 'A' })]
    sortWorks(rows, 'title', 'asc')
    expect(titles(rows)).toEqual(['B', 'A'])
  })

  it('tittel: norsk kollasjon og numerisk rekkefølge, begge retninger', () => {
    const rows = [
      work({ title: 'Ørnen' }),
      work({ title: 'Fanfare 10' }),
      work({ title: 'Åsen' }),
      work({ title: 'Fanfare 2' }),
      work({ title: 'Ægir' }),
    ]
    expect(titles(sortWorks(rows, 'title', 'asc'))).toEqual(['Fanfare 2', 'Fanfare 10', 'Ægir', 'Ørnen', 'Åsen'])
    expect(titles(sortWorks(rows, 'title', 'desc'))).toEqual(['Åsen', 'Ørnen', 'Ægir', 'Fanfare 10', 'Fanfare 2'])
  })

  it('komponist: tomme sist i BEGGE retninger, likt brytes på tittel', () => {
    const rows = [
      work({ title: 'Uten komponist', composer: null }),
      work({ title: 'Zulu', composer: 'Sparke' }),
      work({ title: 'Alfa', composer: 'Sparke' }),
      work({ title: 'Blank', composer: '   ' }),
      work({ title: 'Beta', composer: 'Ball' }),
    ]
    expect(titles(sortWorks(rows, 'composer', 'asc'))).toEqual([
      'Beta',
      'Alfa',
      'Zulu',
      'Blank',
      'Uten komponist',
    ])
    expect(titles(sortWorks(rows, 'composer', 'desc'))).toEqual([
      'Alfa',
      'Zulu',
      'Beta',
      'Blank',
      'Uten komponist',
    ])
  })

  it('grad: stigende og synkende, uten grad sist', () => {
    const rows = [work({ title: 'C', grade: 3 }), work({ title: 'A' }), work({ title: 'B', grade: 5 })]
    expect(titles(sortWorks(rows, 'grade', 'asc'))).toEqual(['C', 'B', 'A'])
    expect(titles(sortWorks(rows, 'grade', 'desc'))).toEqual(['B', 'C', 'A'])
  })

  it('varighet: korteste først, ukjent varighet sist', () => {
    const rows = [
      work({ title: 'Lang', durationSec: 600 }),
      work({ title: 'Ukjent' }),
      work({ title: 'Kort', durationSec: 90 }),
    ]
    expect(titles(sortWorks(rows, 'duration', 'asc'))).toEqual(['Kort', 'Lang', 'Ukjent'])
    expect(titles(sortWorks(rows, 'duration', 'desc'))).toEqual(['Lang', 'Kort', 'Ukjent'])
  })

  it('sist oppdatert: håndterer både Date og epoch-ms', () => {
    const rows = [
      work({ title: 'Gammel', updatedAt: new Date('2024-01-01T00:00:00Z') }),
      work({ title: 'Ny', updatedAt: new Date('2026-07-01T00:00:00Z').getTime() }),
      work({ title: 'Midt', updatedAt: new Date('2025-05-05T00:00:00Z') }),
    ]
    expect(titles(sortWorks(rows, 'updated', 'desc'))).toEqual(['Ny', 'Midt', 'Gammel'])
    expect(titles(sortWorks(rows, 'updated', 'asc'))).toEqual(['Gammel', 'Midt', 'Ny'])
  })

  it('compareWorks er stabil for identiske rader', () => {
    const a = work({ title: 'Samme', grade: 3 })
    const b = work({ title: 'Samme', grade: 3 })
    expect(compareWorks('grade', 'asc')(a, b)).toBe(0)
  })
})

// ---------- Nedtrekksvalg ----------

describe('buildFilterOptions', () => {
  it('tom liste → tomme lister', () => {
    expect(buildFilterOptions([])).toEqual({ composers: [], arrangers: [], genres: [], grades: [], years: [] })
  })

  it('unike verdier, trimmet, tomme ignorert; grad stigende og år synkende', () => {
    expect(
      buildFilterOptions([
        { composer: 'Sparke', arranger: null, genre: 'Marsj', grade: 4, acquiredYear: 2020 },
        { composer: ' Sparke ', arranger: '  ', genre: 'Hymne', grade: 2, acquiredYear: 2024 },
        { composer: 'Ball', arranger: 'Nordmann', genre: null, grade: null, acquiredYear: 2020 },
      ]),
    ).toEqual({
      composers: ['Ball', 'Sparke'],
      arrangers: ['Nordmann'],
      genres: ['Hymne', 'Marsj'],
      grades: [2, 4],
      years: [2024, 2020],
    })
  })
})
