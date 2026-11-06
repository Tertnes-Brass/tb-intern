/**
 * Søk og sortering på veggen — rene regler, delt av serveren (`searchPosts` i
 * src/server/posts.ts) og skjermen (`/beskjeder`). Ingen avhengigheter.
 *
 * Søket er bevisst enkelt: hvert ord (eller "frase i anførselstegn") må finnes
 * et sted i innlegget — tittel, tekst, avsender eller en kommentar — og
 * rangeringen vekter tittel over tekst over kommentarer. Ingen FTS-tabell: D1
 * eksporterer ikke virtuelle tabeller, og deploy-workflowen tar backup med
 * eksport. Veggen er hundrevis av innlegg, ikke millioner; å lese dem er billig.
 *
 * Tegnene foldes ÉN TIL ÉN (`foldForSearch` bevarer lengden), slik at
 * treffposisjonene i den foldede teksten også er posisjonene i originalen —
 * det er det som lar skjermen utheve treffene uten å gjette.
 */

/** Korteste søk som sendes til serveren. Ett tegn treffer alt og sier ingenting. */
export const SEARCH_MIN_LENGTH = 2
export const SEARCH_MAX_LENGTH = 100
/** Maks antall søkeord; resten ignoreres. */
const MAX_TERMS = 8
/** Tegn på hver side av treffet i et utdrag. */
const SNIPPET_RADIUS = 70

/**
 * Små bokstaver og aksenter bort — men æ, ø og å er egne bokstaver på norsk og
 * beholdes («år» skal ikke treffe «arrangement»). Ett tegn inn, ett tegn ut.
 */
export function foldForSearch(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) out += foldChar(value[i])
  return out
}

function foldChar(ch: string): string {
  if (ch === 'å' || ch === 'Å') return 'å'
  const lower = ch.toLowerCase()
  if (lower.length !== 1) return ch
  // Tegn med aksent (é, ü, ñ) dekomponeres til grunnbokstav + merke; merket fjernes.
  const base = lower.normalize('NFD').replace(/\p{M}+/gu, '')
  return base.length === 1 ? base : lower
}

/**
 * Søkeordene i et søk: ord skilt med mellomrom, og "fraser i anførselstegn"
 * som ett ord. Foldet, uten duplikater, maks `MAX_TERMS`.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = []
  for (const m of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim()
    // Et løst anførselstegn eller rene skilletegn er ikke et søkeord.
    const term = foldForSearch(raw.replace(/^["'«»()[\],.;:!?]+|["'«»()[\],.;:!?]+$/g, ''))
    if (term && !terms.includes(term)) terms.push(term)
    if (terms.length === MAX_TERMS) break
  }
  return terms
}

/** Er søket langt nok til å sendes? (Tomt søk = ingen søk.) */
export function isSearchable(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH && searchTerms(query).length > 0
}

/**
 * Hvor søkeordene står i en tekst, som sorterte, sammenslåtte [start, slutt)-
 * intervaller i ORIGINALTEKSTEN. Brukes til uthevingen på skjermen.
 */
export function matchRanges(text: string, terms: string[]): Array<[number, number]> {
  if (!text || terms.length === 0) return []
  const folded = foldForSearch(text)
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    if (!term) continue
    let from = 0
    for (;;) {
      const at = folded.indexOf(term, from)
      if (at === -1) break
      ranges.push([at, at + term.length])
      from = at + term.length
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Teksten delt i biter, med `match: true` på det som skal utheves. */
export function highlightParts(text: string, terms: string[]): Array<{ text: string; match: boolean }> {
  const ranges = matchRanges(text, terms)
  if (ranges.length === 0) return text ? [{ text, match: false }] : []
  const parts: Array<{ text: string; match: boolean }> = []
  let pos = 0
  for (const [start, end] of ranges) {
    if (start > pos) parts.push({ text: text.slice(pos, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    pos = end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false })
  return parts
}

/**
 * Et kort utdrag rundt posisjonen `at` (i en tekst der blanktegn allerede er
 * slått sammen), kuttet ved ordgrenser og med «…» der teksten fortsetter.
 */
export function snippetAround(text: string, at: number, radius: number = SNIPPET_RADIUS): string {
  let start = Math.max(0, at - radius)
  let end = Math.min(text.length, at + radius)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < at) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > at) end = space
  }
  const body = text.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/** Det søket ser av ett innlegg. Alt er REN tekst (markdown og markører er borte). */
export type SearchDoc = {
  id: string
  title: string | null
  /** Hele teksten, ren. */
  body: string
  /** Det kortet viser — et treff her trenger ikke et eget utdrag. */
  excerpt: string
  /** «Styret», «Notearkivar» eller forfatterens navn — slik kortet viser det. */
  sender: string
  /** Forfatterens navn (står også på kortet for styret og notearkivaren). */
  author: string
  comments: Array<{ author: string; text: string }>
  publishedAt: number
}

/**
 * Hvorfor innlegget kom med, når det ikke synes på kortet av seg selv: et
 * utdrag fra lenger ned i teksten, eller fra en kommentar. `null` når alle
 * søkeordene allerede står i tittelen, utdraget eller avsenderen.
 */
export type SearchHit =
  | { kind: 'body'; snippet: string }
  | { kind: 'comment'; author: string; snippet: string }
  | null

export type SearchResult = { id: string; score: number; hit: SearchHit }

const WEIGHT = { title: 8, body: 3, sender: 4, comment: 1 } as const

/** Starter treffet et ord? «kor» i «korpset» teller mer enn i «rekord». */
function wordStartIndex(folded: string, term: string): { at: number; wordStart: boolean } {
  let at = folded.indexOf(term)
  const first = at
  while (at !== -1) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(folded[at - 1])) return { at, wordStart: true }
    at = folded.indexOf(term, at + 1)
  }
  return { at: first, wordStart: false }
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Rangerer ett innlegg mot søkeordene. `null` når et av ordene ikke finnes
 * noe sted — alle ordene må med (OG, ikke ELLER: flere ord skal snevre inn).
 */
export function scoreDoc(doc: SearchDoc, terms: string[]): SearchResult | null {
  if (terms.length === 0) return null
  const title = foldForSearch(doc.title ?? '')
  const bodyText = flatten(doc.body)
  const body = foldForSearch(bodyText)
  const people = foldForSearch(`${doc.sender} ${doc.author}`)
  const comments = doc.comments.map((c) => ({ ...c, flat: flatten(c.text) })).map((c) => ({ ...c, folded: foldForSearch(c.flat) }))
  const visible = foldForSearch(`${doc.title ?? ''} ${doc.excerpt} ${doc.sender} ${doc.author}`)

  let score = 0
  for (const term of terms) {
    let found = false
    const t = wordStartIndex(title, term)
    if (t.at !== -1) {
      score += WEIGHT.title + (t.wordStart ? 4 : 0)
      found = true
    }
    const b = wordStartIndex(body, term)
    if (b.at !== -1) {
      score += WEIGHT.body + (b.wordStart ? 1 : 0)
      found = true
    }
    if (people.includes(term)) {
      score += WEIGHT.sender
      found = true
    }
    const inComments = comments.filter((c) => c.folded.includes(term)).length
    if (inComments > 0) {
      score += WEIGHT.comment + Math.min(inComments - 1, 3) * 0.5
      found = true
    }
    if (!found) return null
  }
  // Hele søket som én frase i tittelen eller teksten er et sterkt signal.
  if (terms.length > 1) {
    const phrase = terms.join(' ')
    if (title.includes(phrase)) score += 6
    else if (body.includes(phrase)) score += 3
  }

  // Utdraget: bare når et søkeord ikke synes på kortet.
  let hit: SearchHit = null
  const missing = terms.filter((term) => !visible.includes(term))
  if (missing.length > 0) {
    const inBody = missing.map((term) => body.indexOf(term)).filter((at) => at !== -1)
    if (inBody.length > 0) {
      hit = { kind: 'body', snippet: snippetAround(bodyText, Math.min(...inBody)) }
    } else {
      // Kommentaren som har flest av de manglende ordene; ved likhet den første.
      let best: (typeof comments)[number] | null = null
      let bestCount = 0
      for (const c of comments) {
        const n = missing.filter((term) => c.folded.includes(term)).length
        if (n > bestCount) {
          best = c
          bestCount = n
        }
      }
      if (best) {
        const at = Math.min(...missing.map((term) => best.folded.indexOf(term)).filter((i) => i !== -1))
        hit = { kind: 'comment', author: best.author, snippet: snippetAround(best.flat, at) }
      }
    }
  }
  return { id: doc.id, score, hit }
}

/** Alle treff, best først; ved lik poengsum det nyeste først. */
export function searchDocs(docs: SearchDoc[], query: string): SearchResult[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  const published = new Map(docs.map((d) => [d.id, d.publishedAt]))
  return docs
    .map((doc) => scoreDoc(doc, terms))
    .filter((r): r is SearchResult => r !== null)
    .sort((a, b) => b.score - a.score || (published.get(b.id) ?? 0) - (published.get(a.id) ?? 0))
}

// ---------- Sortering ----------

export type PostSort = 'treff' | 'nyeste' | 'eldste' | 'aktive' | 'aktivitet'

export const POST_SORTS: ReadonlyArray<{ value: PostSort; label: string; hint: string }> = [
  { value: 'treff', label: 'Beste treff', hint: 'Treff i tittelen først' },
  { value: 'nyeste', label: 'Nyeste', hint: 'Sist publisert først' },
  { value: 'eldste', label: 'Eldste', hint: 'Først publisert først' },
  { value: 'aktive', label: 'Mest aktive', hint: 'Flest kommentarer og likes' },
  { value: 'aktivitet', label: 'Siste aktivitet', hint: 'Sist kommentert eller publisert' },
]

/** Sorteringen som gjelder: «Beste treff» finnes bare når man søker, og er da standard. */
export function effectiveSort(sort: PostSort | undefined, searching: boolean): PostSort {
  if (!sort) return searching ? 'treff' : 'nyeste'
  if (sort === 'treff' && !searching) return 'nyeste'
  return sort
}

/** Valgene som gir mening nå. */
export function sortOptions(searching: boolean): typeof POST_SORTS {
  return searching ? POST_SORTS : POST_SORTS.filter((s) => s.value !== 'treff')
}

type Sortable = {
  publishedAt: number | null
  createdAt: number
  commentCount: number
  likeCount: number
  lastActivityAt: number
}

/**
 * Sorterer en kopi. «Beste treff» beholder rekkefølgen den fikk (serveren
 * rangerer). Lik verdi faller alltid tilbake på nyeste først, så rekkefølgen
 * er stabil mellom to hentinger.
 */
export function sortPosts<T extends Sortable>(posts: readonly T[], sort: PostSort): T[] {
  const time = (p: T) => p.publishedAt ?? p.createdAt
  const newest = (a: T, b: T) => time(b) - time(a)
  const list = [...posts]
  switch (sort) {
    case 'treff':
      return list
    case 'nyeste':
      return list.sort(newest)
    case 'eldste':
      return list.sort((a, b) => time(a) - time(b))
    case 'aktive':
      return list.sort((a, b) => b.commentCount + b.likeCount - (a.commentCount + a.likeCount) || newest(a, b))
    case 'aktivitet':
      return list.sort((a, b) => b.lastActivityAt - a.lastActivityAt || newest(a, b))
  }
}
