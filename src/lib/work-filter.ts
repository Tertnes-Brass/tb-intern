import { z } from 'zod'

/**
 * Ren, runtime-uavhengig logikk for søk, filter og sortering i verksarkivet.
 * Holdes fri for db-/cloudflare-importer så den kan enhetstestes i node, og
 * deles av URL-en (/arkiv), serverfunksjonen (`listWorks`) og UI-et.
 *
 * URL-en er sannhetskilden: alle valg ligger i search params som skalarer, og
 * standardvalgene (aktive verk, tittel A–Å) utelates så delte lenker blir korte.
 * Det som SQL kan gjøre (tekstsøk, likhet på kolonne, status) gjøres i SQL —
 * her ligger det avledede: «mangler»-predikatene og sorteringen.
 */

export const SORT_KEYS = ['title', 'composer', 'grade', 'duration', 'updated'] as const
export type WorkSortKey = (typeof SORT_KEYS)[number]

export const SORT_DIRS = ['asc', 'desc'] as const
export type SortDir = (typeof SORT_DIRS)[number]

/** Hva et verk kan mangle. `audio` = lytteeksempel (lydfil eller lenke). */
export const MISSING_KEYS = ['parts', 'score', 'audio'] as const
export type MissingKey = (typeof MISSING_KEYS)[number]

export const STATUS_FILTERS = ['active', 'archived', 'all'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export const DEFAULT_SORT: WorkSortKey = 'title'
export const DEFAULT_STATUS: StatusFilter = 'active'

/** Sist oppdatert er bare nyttig med nyeste først; alle andre nøkler stiger. */
export function defaultDirFor(sort: WorkSortKey): SortDir {
  return sort === 'updated' ? 'desc' : 'asc'
}

// ---------- Search params ----------

/**
 * Formen som ligger i URL-en og sendes til serverfunksjonen. Bare skalarer:
 * `missing` er kommaseparert («parts,audio») for at lenken skal være lesbar.
 */
export const archiveSearchInput = z.object({
  q: z.string().optional(),
  composer: z.string().optional(),
  arranger: z.string().optional(),
  genre: z.string().optional(),
  grade: z.number().int().min(1).max(5).optional(),
  year: z.number().int().optional(),
  status: z.enum(STATUS_FILTERS).optional(),
  missing: z.string().optional(),
  sort: z.enum(SORT_KEYS).optional(),
  dir: z.enum(SORT_DIRS).optional(),
})

export type ArchiveSearch = z.infer<typeof archiveSearchInput>

/** Ferdig tolket filter: ingen `undefined`, standardvalgene fylt inn. */
export type WorkFilter = {
  q: string
  composer: string | null
  arranger: string | null
  genre: string | null
  grade: number | null
  year: number | null
  status: StatusFilter
  missing: MissingKey[]
  sort: WorkSortKey
  dir: SortDir
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  return v.trim() || undefined
}

function int(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN
  return Number.isInteger(n) ? n : undefined
}

function pick<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

function grade(v: unknown): number | undefined {
  const n = int(v)
  return n != null && n >= 1 && n <= 5 ? n : undefined
}

function year(v: unknown): number | undefined {
  const n = int(v)
  return n != null && n >= 1 && n <= 9999 ? n : undefined
}

/** Kommaseparert liste → kanonisk rekkefølge uten duplikater eller ukjente nøkler. */
function parseMissing(v: unknown): MissingKey[] {
  const raw = typeof v === 'string' ? v.split(',').map((s) => s.trim()) : []
  return MISSING_KEYS.filter((k) => raw.includes(k))
}

/**
 * `validateSearch` for /arkiv: tåler hva som helst i URL-en og gir den
 * kanoniske formen tilbake — standardvalg som `undefined` slik at de forsvinner
 * fra lenken.
 */
export function parseArchiveSearch(raw: Record<string, unknown>): ArchiveSearch {
  const sort = pick(SORT_KEYS, raw.sort)
  const dir = pick(SORT_DIRS, raw.dir)
  const status = pick(STATUS_FILTERS, raw.status)
  const missing = parseMissing(raw.missing)
  return {
    q: str(raw.q),
    composer: str(raw.composer),
    arranger: str(raw.arranger),
    genre: str(raw.genre),
    grade: grade(raw.grade),
    year: year(raw.year),
    status: status && status !== DEFAULT_STATUS ? status : undefined,
    missing: missing.length > 0 ? missing.join(',') : undefined,
    sort: sort && sort !== DEFAULT_SORT ? sort : undefined,
    dir: dir && dir !== defaultDirFor(sort ?? DEFAULT_SORT) ? dir : undefined,
  }
}

/** Search params → ferdig tolket filter. Validerer på nytt; stoler ikke på klienten. */
export function resolveWorkFilter(search: ArchiveSearch | undefined): WorkFilter {
  const s = search ?? {}
  const sort = pick(SORT_KEYS, s.sort) ?? DEFAULT_SORT
  return {
    q: str(s.q) ?? '',
    composer: str(s.composer) ?? null,
    arranger: str(s.arranger) ?? null,
    genre: str(s.genre) ?? null,
    grade: grade(s.grade) ?? null,
    year: year(s.year) ?? null,
    status: pick(STATUS_FILTERS, s.status) ?? DEFAULT_STATUS,
    missing: parseMissing(s.missing),
    sort,
    dir: pick(SORT_DIRS, s.dir) ?? defaultDirFor(sort),
  }
}

/**
 * Ferdig tolket filter → search params. Motstykket til `resolveWorkFilter`;
 * normaliserer også «mangler»-rekkefølgen slik at UI-et og en fersk innlasting
 * av samme lenke gir identisk URL.
 */
export function serializeArchiveSearch(filter: WorkFilter): ArchiveSearch {
  const missing = MISSING_KEYS.filter((k) => filter.missing.includes(k))
  return {
    q: filter.q.trim() || undefined,
    composer: filter.composer ?? undefined,
    arranger: filter.arranger ?? undefined,
    genre: filter.genre ?? undefined,
    grade: filter.grade ?? undefined,
    year: filter.year ?? undefined,
    status: filter.status === DEFAULT_STATUS ? undefined : filter.status,
    missing: missing.length > 0 ? missing.join(',') : undefined,
    sort: filter.sort === DEFAULT_SORT ? undefined : filter.sort,
    dir: filter.dir === defaultDirFor(filter.sort) ? undefined : filter.dir,
  }
}

/**
 * Hvor mange valg som snevrer inn listen — vises i UI-et og styrer
 * «Nullstill». Hvert avkrysset «mangler»-valg teller som ett. Sortering er
 * ikke et filter og teller ikke.
 */
export function countActiveFilters(filter: WorkFilter): number {
  let n = 0
  if (filter.q) n++
  if (filter.composer) n++
  if (filter.arranger) n++
  if (filter.genre) n++
  if (filter.grade != null) n++
  if (filter.year != null) n++
  if (filter.status !== DEFAULT_STATUS) n++
  return n + filter.missing.length
}

// ---------- «Mangler»-predikater ----------

/** Det som trengs for å avgjøre hva et verk mangler. */
export type WorkCoverage = {
  counts: { parts: number; score: number; audio: number }
  linkCount: number
}

/** Ingen stemmefiler lastet opp (kind = 'part'). */
export function isMissingParts(c: WorkCoverage): boolean {
  return c.counts.parts === 0
}

/** Ingen partitur lastet opp (kind = 'score'). */
export function isMissingScore(c: WorkCoverage): boolean {
  return c.counts.score === 0
}

/**
 * Verken opplastet lydfil (kind = 'audio') eller lenke (YouTube/Spotify/annet).
 * En lenke regnes som et fullgodt lytteeksempel — det er slik arkivet i praksis
 * dokumenterer referanseinnspillinger.
 */
export function isMissingListeningExample(c: WorkCoverage): boolean {
  return c.counts.audio === 0 && c.linkCount === 0
}

export const MISSING_PREDICATES: Record<MissingKey, (c: WorkCoverage) => boolean> = {
  parts: isMissingParts,
  score: isMissingScore,
  audio: isMissingListeningExample,
}

/**
 * OR innenfor «Mangler»-fasetten: to avkryssinger gir verk som mangler minst
 * én av dem — arkivaren leter etter hull, ikke etter snittet. Tomt valg
 * slipper alt gjennom.
 */
export function matchesMissing(coverage: WorkCoverage, keys: readonly MissingKey[]): boolean {
  if (keys.length === 0) return true
  return keys.some((k) => MISSING_PREDICATES[k](coverage))
}

// ---------- Sortering ----------

// Norsk kollasjon (æ ø å etter z) og numerisk så «Fanfare 2» kommer før
// «Fanfare 10». Bygges én gang; Intl.Collator er dyr å konstruere.
const collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' })

export type SortableWork = {
  title: string
  composer: string | null
  grade: number | null
  durationSec: number | null
  updatedAt: Date | number
}

function sortValue(sort: WorkSortKey, w: SortableWork): string | number | null {
  switch (sort) {
    case 'title':
      return w.title.trim() || null
    case 'composer':
      return w.composer?.trim() || null
    case 'grade':
      return w.grade
    case 'duration':
      return w.durationSec
    case 'updated':
      return w.updatedAt instanceof Date ? w.updatedAt.getTime() : Number(w.updatedAt)
  }
}

/**
 * Sammenligner på valgt nøkkel. Verk uten verdi (ingen komponist, ingen grad,
 * ukjent varighet) havner alltid SIST — også når retningen snus, ellers ville
 * «Grad høy–lav» starte med tomme rader. Likt sorteres på tittel A–Å så
 * rekkefølgen er deterministisk.
 */
export function compareWorks(sort: WorkSortKey, dir: SortDir) {
  const flip = dir === 'desc' ? -1 : 1
  return (a: SortableWork, b: SortableWork): number => {
    const va = sortValue(sort, a)
    const vb = sortValue(sort, b)
    if (va == null || vb == null) {
      if (va != null) return -1
      if (vb != null) return 1
    } else {
      const primary =
        typeof va === 'string' && typeof vb === 'string' ? collator.compare(va, vb) : Number(va) - Number(vb)
      if (primary !== 0) return primary * flip
    }
    return collator.compare(a.title, b.title)
  }
}

/** Ny, sortert liste — muterer ikke input. */
export function sortWorks<T extends SortableWork>(rows: readonly T[], sort: WorkSortKey, dir: SortDir): T[] {
  return [...rows].sort(compareWorks(sort, dir))
}

// ---------- Nedtrekksvalg ----------

export type WorkFacetRow = {
  composer: string | null
  arranger: string | null
  genre: string | null
  grade: number | null
  acquiredYear: number | null
}

export type WorkFilterOptions = {
  composers: string[]
  arrangers: string[]
  genres: string[]
  grades: number[]
  years: number[]
}

function distinctText(values: Array<string | null>): string[] {
  const set = new Set<string>()
  for (const v of values) {
    const t = v?.trim()
    if (t) set.add(t)
  }
  return [...set].sort((a, b) => collator.compare(a, b))
}

function distinctNumbers(values: Array<number | null>, dir: SortDir): number[] {
  const set = new Set<number>()
  for (const v of values) {
    if (v != null) set.add(v)
  }
  return [...set].sort((a, b) => (dir === 'desc' ? b - a : a - b))
}

/**
 * Nedtrekksvalgene bygges av verdiene som faktisk finnes i arkivet — da kan
 * arkivaren ikke skrive et filter som garantert gir null treff, og listen
 * dokumenterer samtidig hvilke sjangre/komponister som er i bruk.
 */
export function buildFilterOptions(rows: readonly WorkFacetRow[]): WorkFilterOptions {
  return {
    composers: distinctText(rows.map((r) => r.composer)),
    arrangers: distinctText(rows.map((r) => r.arranger)),
    genres: distinctText(rows.map((r) => r.genre)),
    grades: distinctNumbers(rows.map((r) => r.grade), 'asc'),
    years: distinctNumbers(rows.map((r) => r.acquiredYear), 'desc'),
  }
}
