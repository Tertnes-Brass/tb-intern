import { describe, expect, it } from 'vitest'
import {
  type SearchDoc,
  effectiveSort,
  foldForSearch,
  highlightParts,
  isSearchable,
  matchRanges,
  scoreDoc,
  searchDocs,
  searchTerms,
  snippetAround,
  sortOptions,
  sortPosts,
} from './post-search'

function doc(partial: Partial<SearchDoc> & { id: string }): SearchDoc {
  const body = partial.body ?? ''
  return {
    title: null,
    excerpt: partial.excerpt ?? body.slice(0, 200),
    sender: 'Ingrid Dale',
    author: 'Ingrid Dale',
    comments: [],
    publishedAt: 0,
    ...partial,
    body,
  }
}

describe('foldForSearch', () => {
  it('bevarer lengden, så treffposisjoner kan brukes på originalteksten', () => {
    for (const s of ['Café Ølhallen', 'ÆØÅ æøå', 'Straße', 'İstanbul', 'emoji 🎺 her', 'Ångström']) {
      expect(foldForSearch(s)).toHaveLength(s.length)
    }
  })

  it('små bokstaver og aksenter bort, men æ, ø og å er egne bokstaver', () => {
    expect(foldForSearch('Café RÉSUMÉ')).toBe('cafe resume')
    expect(foldForSearch('Øvelse på Åsane')).toBe('øvelse på åsane')
    expect(foldForSearch('Bø')).not.toBe('bo')
  })
})

describe('searchTerms', () => {
  it('ord og "fraser i anførselstegn", foldet og uten duplikater', () => {
    expect(searchTerms('Konsert  "St. Hans"  konsert')).toEqual(['konsert', 'st. hans'])
  })

  it('skilletegn rundt et ord og løse anførselstegn er ikke søkeord', () => {
    expect(searchTerms('«øvelse», (torsdag)!')).toEqual(['øvelse', 'torsdag'])
    expect(searchTerms('" "')).toEqual([])
    expect(searchTerms('   ')).toEqual([])
  })

  it('isSearchable krever minst to tegn', () => {
    expect(isSearchable('a')).toBe(false)
    expect(isSearchable(' a ')).toBe(false)
    expect(isSearchable('ab')).toBe(true)
    expect(isSearchable('""')).toBe(false)
  })
})

describe('matchRanges og highlightParts', () => {
  it('finner alle forekomster, slår sammen overlapp og bruker originalens posisjoner', () => {
    expect(matchRanges('Café og CAFÉ', ['cafe'])).toEqual([
      [0, 4],
      [8, 12],
    ])
    expect(matchRanges('konsertkonsert', ['konsert', 'sertk'])).toEqual([[0, 14]])
  })

  it('deler teksten i uthevede og vanlige biter', () => {
    expect(highlightParts('Øvelse torsdag', ['torsdag'])).toEqual([
      { text: 'Øvelse ', match: false },
      { text: 'torsdag', match: true },
    ])
    expect(highlightParts('Ingen treff', ['xyz'])).toEqual([{ text: 'Ingen treff', match: false }])
  })
})

describe('snippetAround', () => {
  it('kutter ved ordgrenser og markerer at teksten fortsetter', () => {
    const text = `${'a '.repeat(100)}MÅLET ${'b '.repeat(100)}`.trim()
    const at = text.indexOf('MÅLET')
    const snippet = snippetAround(text, at, 20)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('MÅLET')
    expect(snippet).not.toMatch(/^…\S*a\S/)
  })

  it('ingen «…» når hele teksten får plass', () => {
    expect(snippetAround('kort tekst', 0)).toBe('kort tekst')
  })
})

describe('scoreDoc', () => {
  it('alle ordene må finnes et sted (OG, ikke ELLER)', () => {
    const d = doc({ id: '1', title: 'Konsert i Grieghallen', body: 'Oppmøte kl. 18.' })
    expect(scoreDoc(d, searchTerms('konsert oppmøte'))).not.toBeNull()
    expect(scoreDoc(d, searchTerms('konsert buss'))).toBeNull()
  })

  it('treff i tittelen rangeres over treff i teksten, som rangeres over kommentarer', () => {
    const terms = searchTerms('buss')
    const title = scoreDoc(doc({ id: 't', title: 'Buss til NM' }), terms)!
    const body = scoreDoc(doc({ id: 'b', body: 'Vi tar buss til NM.' }), terms)!
    const comment = scoreDoc(doc({ id: 'c', body: 'NM', comments: [{ author: 'Jonas', text: 'Går det buss?' }] }), terms)!
    expect(title.score).toBeGreaterThan(body.score)
    expect(body.score).toBeGreaterThan(comment.score)
  })

  it('treff i begynnelsen av et ord teller mer enn midt i et ord', () => {
    const terms = searchTerms('kor')
    const start = scoreDoc(doc({ id: '1', body: 'Hele korpset' }), terms)!
    const middle = scoreDoc(doc({ id: '2', body: 'Ny rekord' }), terms)!
    expect(start.score).toBeGreaterThan(middle.score)
  })

  it('avsenderen er søkbar (styret, notearkivaren og navnet bak)', () => {
    const d = doc({ id: '1', sender: 'Styret', author: 'Hilde Berg', body: 'Husk kontingenten.' })
    expect(scoreDoc(d, searchTerms('styret'))).not.toBeNull()
    expect(scoreDoc(d, searchTerms('hilde'))).not.toBeNull()
  })

  it('kommentarforfatteren alene gir ikke treff', () => {
    const d = doc({ id: '1', body: 'Hei', comments: [{ author: 'Karim', text: 'Takk!' }] })
    expect(scoreDoc(d, searchTerms('karim'))).toBeNull()
  })

  it('ingen utdrag når treffet allerede står på kortet', () => {
    const d = doc({ id: '1', title: 'Sommeravslutning', body: 'Grilling i parken.' })
    expect(scoreDoc(d, searchTerms('sommer'))!.hit).toBeNull()
    expect(scoreDoc(d, searchTerms('grilling'))!.hit).toBeNull()
  })

  it('utdrag fra lenger ned i teksten når treffet ikke er i utdraget på kortet', () => {
    const body = `${'Lang innledning. '.repeat(30)}Husk å ta med notestativ.`
    const d = doc({ id: '1', body, excerpt: body.slice(0, 120) })
    const hit = scoreDoc(d, searchTerms('notestativ'))!.hit
    expect(hit).toMatchObject({ kind: 'body' })
    expect(hit && hit.snippet).toContain('notestativ')
  })

  it('utdrag fra kommentaren med flest av ordene som mangler på kortet', () => {
    const d = doc({
      id: '1',
      body: 'Hvem kan kjøre?',
      comments: [
        { author: 'Jonas', text: 'Jeg kan kjøre fra Åsane.' },
        { author: 'Ingrid', text: 'Jeg kjører fra Åsane, har plass til tuba.' },
      ],
    })
    const hit = scoreDoc(d, searchTerms('åsane tuba'))!.hit
    expect(hit).toMatchObject({ kind: 'comment', author: 'Ingrid' })
  })

  it('et kommentartreff har kommentarens id når den finnes, så det kan lenke dit', () => {
    const d = doc({ id: '1', body: 'Spørsmål', comments: [{ id: 'svar-7', author: 'Karim', text: 'Lageret er åpent.' }] })
    expect(scoreDoc(d, searchTerms('lageret'))!.hit).toEqual({ kind: 'comment', author: 'Karim', snippet: 'Lageret er åpent.', commentId: 'svar-7' })
    const anonymous = doc({ id: '2', body: 'Spørsmål', comments: [{ author: 'Karim', text: 'Lageret er åpent.' }] })
    expect(scoreDoc(anonymous, searchTerms('lageret'))!.hit).not.toHaveProperty('commentId')
  })
})

describe('searchDocs', () => {
  it('best først, og ved lik poengsum det nyeste først', () => {
    const docs = [
      doc({ id: 'gammel', body: 'Konsert', publishedAt: 1 }),
      doc({ id: 'ny', body: 'Konsert', publishedAt: 2 }),
      doc({ id: 'tittel', title: 'Konsert', publishedAt: 0 }),
      doc({ id: 'ingen', body: 'Øvelse', publishedAt: 3 }),
    ]
    expect(searchDocs(docs, 'konsert').map((r) => r.id)).toEqual(['tittel', 'ny', 'gammel'])
  })

  it('tomt søk gir ingen treff', () => {
    expect(searchDocs([doc({ id: '1', body: 'x' })], '  ')).toEqual([])
  })
})

describe('sortering', () => {
  const post = (id: string, publishedAt: number, commentCount = 0, likeCount = 0, lastActivityAt = publishedAt) => ({
    id,
    publishedAt,
    createdAt: publishedAt,
    commentCount,
    likeCount,
    lastActivityAt,
  })
  const posts = [post('a', 1, 0, 0, 50), post('b', 3, 1, 0), post('c', 2, 2, 5)]
  const ids = (list: Array<{ id: string }>) => list.map((p) => p.id)

  it('nyeste, eldste, mest aktive og siste aktivitet', () => {
    expect(ids(sortPosts(posts, 'nyeste'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortPosts(posts, 'eldste'))).toEqual(['a', 'c', 'b'])
    expect(ids(sortPosts(posts, 'aktive'))).toEqual(['c', 'b', 'a'])
    expect(ids(sortPosts(posts, 'aktivitet'))).toEqual(['a', 'b', 'c'])
  })

  it('«Beste treff» beholder rekkefølgen, og lista sorteres som kopi', () => {
    expect(ids(sortPosts(posts, 'treff'))).toEqual(['a', 'b', 'c'])
    sortPosts(posts, 'eldste')
    expect(ids(posts)).toEqual(['a', 'b', 'c'])
  })

  it('lik aktivitet faller tilbake på nyeste først', () => {
    expect(ids(sortPosts([post('x', 1, 1), post('y', 2, 0, 1)], 'aktive'))).toEqual(['y', 'x'])
  })

  it('«Beste treff» finnes bare mens man søker, og er da standard', () => {
    expect(effectiveSort(undefined, false)).toBe('nyeste')
    expect(effectiveSort(undefined, true)).toBe('treff')
    expect(effectiveSort('treff', false)).toBe('nyeste')
    expect(effectiveSort('eldste', true)).toBe('eldste')
    expect(sortOptions(false).map((o) => o.value)).not.toContain('treff')
    expect(sortOptions(true)[0].value).toBe('treff')
  })
})
