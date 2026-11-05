/**
 * Notestativet (`/noter/stativ/$projectId`): hvilke noter som ligger på
 * stativet, og i hvilken rekkefølge. Rene regler, testet i `stand.test.ts`.
 *
 * Stativet følger programmet. For hvert verk ligger brukerens egne stemmer der
 * (en musiker med to stemmer får begge, etter hverandre). Den som ikke har noen
 * stemme — dirigenten, typisk — får partituret i stedet. Hvilke filer som
 * finnes i lista, er allerede avgjort av serveren (`assembleRepertoire`), som
 * bruker samme regel som fil-gaten.
 */
import { toRoman } from './format'

/** Utsnittet av `ProjectWorkDetail` stativet trenger. */
export type StandWork = {
  workId: string
  title: string
  composer: string | null
  arranger: string | null
  myFiles: Array<{ id: string; partName: string | null; fileName: string; pageCount: number | null }>
  partFiles: Array<{ id: string; partName: string | null; pageCount: number | null }>
  scoreFileId: string | null
  links: Array<{ kind: string; url: string }>
  audioFiles: Array<{ id: string }>
}

export type StandEntry = {
  fileId: string
  workId: string
  /** «I.», «II.» — verkets plass i programmet. */
  number: string
  title: string
  /** «1. horn», «Partitur». */
  label: string
  pageCount: number | null
  /** Har verket lytteeksempler (lenker eller lydfiler)? */
  canListen: boolean
}

const PDF = /\.pdf$/i

export function standEntries(
  works: StandWork[],
  opts: { hasParts: boolean; focusFileId?: string | null },
): StandEntry[] {
  const entries: StandEntry[] = []
  works.forEach((work, i) => {
    const base = {
      workId: work.workId,
      number: `${toRoman(i + 1)}.`,
      title: work.title,
      canListen: work.links.length > 0 || work.audioFiles.length > 0,
    }
    const focus = opts.focusFileId ? focusedFile(work, opts.focusFileId) : null
    if (focus) {
      // Åpnet fra en bestemt fil (partituret, eller en annen stemme fra «Alle
      // stemmer»): den filen erstatter verkets plass på stativet.
      entries.push({ ...base, ...focus })
      return
    }
    const mine = work.myFiles.filter((f) => PDF.test(f.fileName))
    if (mine.length > 0) {
      for (const f of mine) {
        entries.push({ ...base, fileId: f.id, label: f.partName ?? 'Min stemme', pageCount: f.pageCount })
      }
    } else if (!opts.hasParts && work.scoreFileId) {
      entries.push({ ...base, fileId: work.scoreFileId, label: 'Partitur', pageCount: null })
    }
  })
  return entries
}

function focusedFile(work: StandWork, fileId: string): Pick<StandEntry, 'fileId' | 'label' | 'pageCount'> | null {
  if (work.myFiles.some((f) => f.id === fileId)) return null
  if (work.scoreFileId === fileId) return { fileId, label: 'Partitur', pageCount: null }
  const part = work.partFiles.find((f) => f.id === fileId)
  return part ? { fileId, label: part.partName ?? 'Stemme', pageCount: part.pageCount } : null
}

/** Hvor på stativet man skal starte: fila man ba om, ellers første stykke. */
export function startIndex(entries: StandEntry[], fileId: string | null | undefined): number {
  if (!fileId) return 0
  const index = entries.findIndex((e) => e.fileId === fileId)
  return index === -1 ? 0 : index
}

// ---------- Hvor man var ----------

/**
 * Leseposisjonen på stativet: hvilket stykke (fila) og hvilken side man stod
 * på, husket per bruker og prosjekt i localStorage (virker uten nett). Et
 * avbrudd på øvelsen — en telefon, en pause, en iPad som ble lagt bort — skal
 * ikke bety å lete frem stedet igjen. Adressen endres aldri (se ruta).
 */
export type StandPosition = { fileId: string; page: number; savedAt: number }

/** Eldre enn dette er en posisjon fra et annet prosjektløp; da starter man forfra. */
export const POSITION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export function standPositionKey(userId: string, projectId: string): string {
  return `tb-stand-pos:${userId}:${projectId}`
}

export function serializeStandPosition(position: StandPosition): string {
  return JSON.stringify(position)
}

/** Tåler alt localStorage kan finne på å gi tilbake; ugyldig blir `null`. */
export function parseStandPosition(raw: string | null | undefined): StandPosition | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StandPosition> | null
    if (!value || typeof value !== 'object') return null
    const { fileId, page, savedAt } = value
    if (typeof fileId !== 'string' || !fileId) return null
    if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) return null
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null
    return { fileId, page: Math.floor(page), savedAt }
  } catch {
    return null
  }
}

export type StandStart = {
  index: number
  page: number
  /** Fortsetter vi fra en lagret posisjon (og ikke fra starten)? Da vises «Fra starten». */
  resumed: boolean
}

/**
 * Hvor stativet åpner:
 * 1. `?fil=` som finnes på stativet vinner alltid — man ba om akkurat det
 *    stykket. Er det samme fil som den lagrede, fortsetter man på siden.
 * 2. Ellers den lagrede posisjonen, om fila fortsatt ligger på stativet og
 *    posisjonen ikke er for gammel.
 * 3. Ellers første side i første stykke.
 */
export function resolveStart(
  entries: StandEntry[],
  opts: { requestedFileId?: string | null; saved?: StandPosition | null; now: number },
): StandStart {
  const fresh = opts.saved && opts.now - opts.saved.savedAt <= POSITION_MAX_AGE_MS ? opts.saved : null
  const requested = opts.requestedFileId ? entries.findIndex((e) => e.fileId === opts.requestedFileId) : -1
  if (requested !== -1) {
    const page = fresh && fresh.fileId === opts.requestedFileId ? fresh.page : 1
    return { index: requested, page, resumed: page > 1 }
  }
  const index = fresh ? entries.findIndex((e) => e.fileId === fresh.fileId) : -1
  if (index === -1 || !fresh) return { index: 0, page: 1, resumed: false }
  return { index, page: fresh.page, resumed: !(index === 0 && fresh.page === 1) }
}

/** «II. Benedictus, side 3» — til «Fortsatt fra …». */
export function resumeLabel(entry: Pick<StandEntry, 'number' | 'title'>, page: number): string {
  return `${entry.number} ${entry.title}${page > 1 ? `, side ${page}` : ''}`
}
