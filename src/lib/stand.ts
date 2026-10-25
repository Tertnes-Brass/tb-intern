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
