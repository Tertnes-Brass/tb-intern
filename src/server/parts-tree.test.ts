import { describe, expect, it } from 'vitest'
import {
  type OrderedPart,
  type PartNode,
  buildChildrenMap,
  buildDisplayOrder,
  expandPartIds,
  leaderCanAssign,
  listSiblings,
  reorderAfter,
} from './parts-tree'

const sorted = (xs: string[]) => [...xs].sort()

describe('expandPartIds / buildChildrenMap', () => {
  it('flat besetning (alle parentId = null) → identitet (dagens oppførsel)', () => {
    const flat: PartNode[] = [
      { id: 'solo-cornet', parentId: null },
      { id: 'percussion-1', parentId: null },
    ]
    const cm = buildChildrenMap(flat)
    expect(expandPartIds(['solo-cornet'], cm)).toEqual(['solo-cornet'])
    expect(expandPartIds(['percussion-1'], cm)).toEqual(['percussion-1'])
  })

  it('forelder ekspanderer til alle barn', () => {
    const tree: PartNode[] = [
      { id: 'percussion', parentId: null },
      { id: 'percussion-1', parentId: 'percussion' },
      { id: 'percussion-2', parentId: 'percussion' },
      { id: 'percussion-3', parentId: 'percussion' },
      { id: 'solo-cornet', parentId: null },
    ]
    const cm = buildChildrenMap(tree)
    expect(sorted(expandPartIds(['percussion'], cm))).toEqual(
      sorted(['percussion', 'percussion-1', 'percussion-2', 'percussion-3']),
    )
  })

  it('blad ekspanderer kun til seg selv', () => {
    const tree: PartNode[] = [
      { id: 'percussion', parentId: null },
      { id: 'percussion-1', parentId: 'percussion' },
      { id: 'percussion-2', parentId: 'percussion' },
    ]
    const cm = buildChildrenMap(tree)
    expect(expandPartIds(['percussion-1'], cm)).toEqual(['percussion-1'])
  })

  it('multi-stemme på tvers av to seksjoner → union av begge subtrær', () => {
    const tree: PartNode[] = [
      { id: 'percussion', parentId: null },
      { id: 'percussion-1', parentId: 'percussion' },
      { id: 'cornets', parentId: null },
      { id: 'solo-cornet', parentId: 'cornets' },
      { id: 'second-cornet', parentId: 'cornets' },
    ]
    const cm = buildChildrenMap(tree)
    expect(sorted(expandPartIds(['percussion', 'solo-cornet'], cm))).toEqual(
      sorted(['percussion', 'percussion-1', 'solo-cornet']),
    )
  })

  it('konstruert sykel (A→B→A) terminerer og kaster ikke', () => {
    const cyclic: PartNode[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    const cm = buildChildrenMap(cyclic)
    expect(sorted(expandPartIds(['a'], cm))).toEqual(['a', 'b'])
  })

  it('dybde over grensen kuttes (terminerer på patologisk dyp kjede)', () => {
    // a→b→c→d→e (dybde 0..4). MAX_PART_DEPTH = 3 ⇒ e faller utenfor.
    const deep: PartNode[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'c' },
      { id: 'e', parentId: 'd' },
    ]
    const cm = buildChildrenMap(deep)
    const out = expandPartIds(['a'], cm)
    expect(out).toContain('d')
    expect(out).not.toContain('e')
  })

  it('partitur (score) er aldri del av tilgangstreet, selv som visuelt barn', () => {
    const tree: PartNode[] = [
      { id: 'conductor', parentId: null },
      { id: 'score', parentId: 'conductor' },
      { id: 'percussion', parentId: null },
      { id: 'percussion-1', parentId: 'score' }, // feilkonfig: forsøk på å henge under score
    ]
    const cm = buildChildrenMap(tree)
    expect(expandPartIds(['score'], cm)).toEqual([])
    expect(expandPartIds(['conductor'], cm)).toEqual(['conductor'])
    expect(cm.has('conductor')).toBe(false)
    // percussion-1 med parentId='score' skal ikke dukke opp via score
    expect(cm.has('score')).toBe(false)
  })

  it('tomt input → tomt output', () => {
    expect(expandPartIds([], new Map())).toEqual([])
  })

  describe('leaderCanAssign', () => {
    const scope = ['percussion-1', 'percussion-2', 'percussion-3'] // ekspandert omfang

    it('tillater når nåværende OG innsendte er innenfor omfanget', () => {
      expect(leaderCanAssign(scope, ['percussion-1'], ['percussion-2', 'percussion-3'])).toBe(true)
    })

    it('avviser innsendt stemme utenfor omfanget (smugling i blandet liste)', () => {
      expect(leaderCanAssign(scope, ['percussion-1'], ['percussion-1', 'solo-cornet'])).toBe(false)
    })

    it('avviser medlem som har en stemme utenfor omfanget (kapring)', () => {
      expect(leaderCanAssign(scope, ['percussion-1', 'solo-cornet'], ['percussion-2'])).toBe(false)
    })

    it('avviser stemmeløst medlem (kun global members.manage)', () => {
      expect(leaderCanAssign(scope, [], ['percussion-1'])).toBe(false)
    })

    it('avviser leder uten omfang', () => {
      expect(leaderCanAssign([], ['percussion-1'], ['percussion-1'])).toBe(false)
    })

    it('tillater å tømme stemmer for medlem i egen seksjon', () => {
      expect(leaderCanAssign(scope, ['percussion-1'], [])).toBe(true)
    })
  })

  it('dupliserte input-ider (forelder + barn samtidig) dedupliseres', () => {
    const tree: PartNode[] = [
      { id: 'percussion', parentId: null },
      { id: 'percussion-1', parentId: 'percussion' },
    ]
    const cm = buildChildrenMap(tree)
    expect(sorted(expandPartIds(['percussion', 'percussion-1'], cm))).toEqual(
      sorted(['percussion', 'percussion-1']),
    )
  })
})

describe('buildDisplayOrder / reorderAfter', () => {
  // To blokker (cornets, percussion), en løs rot (horn) og partitur sist
  const band: OrderedPart[] = [
    { id: 'cornets', parentId: null, sortOrder: 10 },
    { id: 'solo-cornet', parentId: 'cornets', sortOrder: 20 },
    { id: 'second-cornet', parentId: 'cornets', sortOrder: 30 },
    { id: 'horn', parentId: null, sortOrder: 40 },
    { id: 'percussion', parentId: null, sortOrder: 50 },
    { id: 'percussion-1', parentId: 'percussion', sortOrder: 60 },
    { id: 'percussion-2', parentId: 'percussion', sortOrder: 70 },
    { id: 'score', parentId: null, sortOrder: 80 },
  ]
  const bandOrder = band.map((r) => r.id)

  it('buildDisplayOrder er identitet når blokkene allerede henger sammen', () => {
    expect(buildDisplayOrder(band)).toEqual(bandOrder)
  })

  it('buildDisplayOrder reparerer løsrevet barn (legges rett etter forelderens øvrige barn)', () => {
    const detached: OrderedPart[] = [
      { id: 'percussion', parentId: null, sortOrder: 10 },
      { id: 'horn', parentId: null, sortOrder: 20 },
      { id: 'percussion-1', parentId: 'percussion', sortOrder: 30 }, // ligger etter horn i flat sortOrder
    ]
    expect(buildDisplayOrder(detached)).toEqual(['percussion', 'percussion-1', 'horn'])
  })

  it('viser Partitur rett under Dirigent', () => {
    const withScoreChild: OrderedPart[] = [
      { id: 'conductor', parentId: null, sortOrder: 10 },
      { id: 'horn', parentId: null, sortOrder: 20 },
      { id: 'score', parentId: 'conductor', sortOrder: 30 },
    ]
    expect(buildDisplayOrder(withScoreChild)).toEqual(['conductor', 'score', 'horn'])
  })

  it('rot-flytt tar med hele blokken (barna følger)', () => {
    expect(reorderAfter(band, 'cornets', 'percussion')).toEqual([
      'horn',
      'percussion',
      'percussion-1',
      'percussion-2',
      'cornets',
      'solo-cornet',
      'second-cornet',
      'score',
    ])
  })

  it('afterId=null flytter rot (med barn) øverst', () => {
    expect(reorderAfter(band, 'percussion', null)).toEqual([
      'percussion',
      'percussion-1',
      'percussion-2',
      'cornets',
      'solo-cornet',
      'second-cornet',
      'horn',
      'score',
    ])
  })

  it('barn flyttes innenfor forelderen — resten av listen står urørt', () => {
    expect(reorderAfter(band, 'percussion-1', 'percussion-2')).toEqual([
      'cornets',
      'solo-cornet',
      'second-cornet',
      'horn',
      'percussion',
      'percussion-2',
      'percussion-1',
      'score',
    ])
  })

  it('afterId=null flytter barn først i forelderen', () => {
    expect(reorderAfter(band, 'second-cornet', null)).toEqual([
      'cornets',
      'second-cornet',
      'solo-cornet',
      'horn',
      'percussion',
      'percussion-1',
      'percussion-2',
      'score',
    ])
  })

  it('ugyldig afterId kaster (feil nivå, annen forelder, ukjent, seg selv)', () => {
    expect(() => reorderAfter(band, 'horn', 'solo-cornet')).toThrow(/øverste nivå/)
    expect(() => reorderAfter(band, 'solo-cornet', 'horn')).toThrow(/søsken/)
    expect(() => reorderAfter(band, 'solo-cornet', 'percussion-1')).toThrow(/søsken/)
    expect(() => reorderAfter(band, 'horn', 'finnes-ikke')).toThrow(/[Uu]kjent/)
    expect(() => reorderAfter(band, 'finnes-ikke', null)).toThrow(/[Uu]kjent/)
    expect(() => reorderAfter(band, 'horn', 'horn')).toThrow(/seg selv/)
  })

  it('renummerering av resultatet er komplett og strengt stigende', () => {
    const order = reorderAfter(band, 'cornets', 'percussion')
    expect(sorted(order)).toEqual(sorted(bandOrder))
    const renumbered = order.map((_, i) => (i + 1) * 10)
    for (let i = 1; i < renumbered.length; i++) {
      expect(renumbered[i]!).toBeGreaterThan(renumbered[i - 1]!)
    }
  })

  it('listSiblings: røtter for rot, forelderens barn for barn, tomt for ukjent', () => {
    expect(listSiblings(band, 'horn')).toEqual(['cornets', 'horn', 'percussion', 'score'])
    expect(listSiblings(band, 'percussion-2')).toEqual(['percussion-1', 'percussion-2'])
    expect(listSiblings(band, 'finnes-ikke')).toEqual([])
  })
})
