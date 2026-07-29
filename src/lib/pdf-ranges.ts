/**
 * Ren logikk for PDF-splitteren: tolking, normalisering og validering av
 * sideintervaller, samt planen for hvilke sider som blir hvilken stemme.
 *
 * Holdes fri for importer (React, db, pdf-lib m.m.) slik at den kan
 * enhetstestes i node. Selve PDF-kopieringen skjer i nettleseren
 * (`src/components/PdfSplitter.tsx`) — Workers har for lite CPU-budsjett per
 * request til å splitte et 200-siders hefte.
 */

/** Ett sammenhengende sideintervall. 1-indeksert og inklusivt i begge ender. */
export type PageRange = { from: number; to: number }

export type ParsedPageRanges = { ok: true; ranges: PageRange[] } | { ok: false; error: string }

// Bindestrek, tankestrek og lang tankestrek: arkivaren limer gjerne inn fra
// Word eller e-post, der «1-3» har blitt «1–3».
const RANGE = /^(\d*)\s*[-–—]\s*(\d*)$/
const SINGLE = /^\d+$/

/**
 * Tolker et uttrykk som «1-3, 7, 9-11» til normaliserte intervaller.
 *
 * Skilletegn mellom intervaller er komma, semikolon eller linjeskift. Åpen ende
 * er tillatt: «7-» betyr «side 7 og ut», «-3» betyr «fra første side til 3».
 * Et snudd intervall («9-7») er en åpenbar skrivefeil og ikke tvetydig, så det
 * rettes stille. Tomt uttrykk er ikke en feil — det betyr bare at raden ennå er
 * ufylt. Feilmeldingene er ment å vises rett til arkivaren.
 */
export function parsePageRanges(expr: string, pageCount: number): ParsedPageRanges {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: 'Sidetallet i dokumentet er ikke kjent' }
  }

  const ranges: PageRange[] = []
  for (const raw of expr.split(/[,;\n]/)) {
    const token = raw.trim()
    if (token === '') continue

    let from: number
    let to: number
    const range = RANGE.exec(token)
    if (range) {
      if (range[1] === '' && range[2] === '') {
        return { ok: false, error: `«${token}» er ikke et sideintervall` }
      }
      from = range[1] === '' ? 1 : Number(range[1])
      to = range[2] === '' ? pageCount : Number(range[2])
    } else if (SINGLE.test(token)) {
      from = Number(token)
      to = from
    } else {
      return { ok: false, error: `«${token}» er ikke et sideintervall` }
    }

    if (from > to) [from, to] = [to, from]
    if (from < 1) return { ok: false, error: 'Sidetall starter på 1' }
    if (to > pageCount) {
      const sider = pageCount === 1 ? 'side' : 'sider'
      return { ok: false, error: `Side ${to} finnes ikke — dokumentet har ${pageCount} ${sider}` }
    }
    ranges.push({ from, to })
  }

  return { ok: true, ranges: normalizePageRanges(ranges) }
}

/**
 * Sorterer og slår sammen intervaller som overlapper eller ligger inntil
 * hverandre: «3-4, 1-2, 2» blir «1-4». Idempotent.
 */
export function normalizePageRanges(ranges: PageRange[]): PageRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)
  const out: PageRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

/** Sidetallene intervallene dekker, 1-indeksert og i stigende rekkefølge. */
export function pageNumbers(ranges: PageRange[]): number[] {
  const out: number[] = []
  for (const r of normalizePageRanges(ranges)) {
    for (let page = r.from; page <= r.to; page++) out.push(page)
  }
  return out
}

/** Samme sider, 0-indeksert — formen `PDFDocument.copyPages` vil ha dem i. */
export function pageIndices(ranges: PageRange[]): number[] {
  return pageNumbers(ranges).map((page) => page - 1)
}

/** Antall unike sider intervallene dekker. */
export function countPages(ranges: PageRange[]): number {
  return normalizePageRanges(ranges).reduce((n, r) => n + (r.to - r.from + 1), 0)
}

/** Kompakt visning: «1-3, 7, 9-11». Tolkes tilbake av `parsePageRanges`. */
export function formatPageRanges(ranges: PageRange[]): string {
  return normalizePageRanges(ranges)
    .map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`))
    .join(', ')
}

export type RangeAssignment = { partId: string; ranges: PageRange[] }
export type PlannedSplitPart = { partId: string; ranges: PageRange[]; pageCount: number }
export type PageOverlap = { partA: string; partB: string; pages: number[] }

export type SplitPlan = {
  /** Én utfil per stemme, i den rekkefølgen stemmene først ble valgt. */
  parts: PlannedSplitPart[]
  /** Sider to ULIKE stemmer begge har krevd. Advarsel, ikke feil. */
  overlaps: PageOverlap[]
  /** Sider ingen stemme har tatt — typisk tittelside eller glemt stemme. */
  unassigned: PageRange[]
  assignedPageCount: number
}

/**
 * Legger planen for én splitt.
 *
 * Samme stemme kan stå på flere rader (arkivaren legger til en rad per gang
 * stemmen dukker opp i heftet). Radene slås da sammen til ÉN utfil, slik at det
 * aldri blir to filer på samme stemme. Rader uten intervaller faller bort.
 *
 * Overlapp mellom to ulike stemmer er nesten alltid en skrivefeil, men kan være
 * en bevisst delt side (stikkord, sluttside), så det rapporteres som advarsel og
 * blokkerer ikke splitten.
 */
export function buildSplitPlan(assignments: RangeAssignment[], pageCount: number): SplitPlan {
  const byPart = new Map<string, PageRange[]>()
  for (const a of assignments) {
    if (a.ranges.length === 0) continue
    byPart.set(a.partId, [...(byPart.get(a.partId) ?? []), ...a.ranges])
  }

  const parts: PlannedSplitPart[] = []
  for (const [partId, ranges] of byPart) {
    const merged = normalizePageRanges(ranges)
    parts.push({ partId, ranges: merged, pageCount: countPages(merged) })
  }

  const pagesByPart = parts.map((p) => new Set(pageNumbers(p.ranges)))
  const overlaps: PageOverlap[] = []
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const shared = [...pagesByPart[i]].filter((page) => pagesByPart[j].has(page))
      if (shared.length > 0) {
        overlaps.push({ partA: parts[i].partId, partB: parts[j].partId, pages: shared })
      }
    }
  }

  const assigned = new Set<number>()
  for (const set of pagesByPart) for (const page of set) assigned.add(page)

  const unassigned: PageRange[] = []
  for (let page = 1; page <= pageCount; page++) {
    if (!assigned.has(page)) unassigned.push({ from: page, to: page })
  }

  return {
    parts,
    overlaps,
    unassigned: normalizePageRanges(unassigned),
    assignedPageCount: assigned.size,
  }
}
