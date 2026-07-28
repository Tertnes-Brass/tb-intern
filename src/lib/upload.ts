import { isAudioFilename } from './taxonomy'

/**
 * Delte regler for filopplasting, brukt av både nettleser og Worker.
 *
 * Filer lastes opp i biter som en R2 multipart-opplasting (se
 * `src/lib/upload-client.ts` og `src/routes/api/upload/`). Da holder hver
 * request seg langt under request-grensen på 100 MB, og verken nettleseren
 * eller Worker'en trenger å ha hele filen i minnet samtidig — et 69 MB
 * partitur sprengte tidligere minnetaket på 128 MB per request.
 */

/**
 * Bitstørrelse. R2 krever at alle deler unntatt den siste er like store og
 * minst 5 MiB. 8 MiB gir jevn framdriftsvisning uten unødig mange kall.
 */
export const PART_SIZE = 8 * 1024 * 1024

/** Øvre grense per fil. R2 tåler langt mer; dette er en fornuftsgrense. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

/**
 * Over denne størrelsen er full pdf-lib-parsing for treg i nettleseren (det var
 * her opplastingen så ut til å henge). Sidetallet telles i stedet strømmende
 * mens filen lastes opp — se `createPdfPageCounter`.
 */
export const PDF_PARSE_LIMIT = 25 * 1024 * 1024

/** R2 tillater maks 10 000 deler per multipart-opplasting. */
export const MAX_PARTS = 10_000

export const ACCEPT_ATTR = '.pdf,.mp3,.m4a,.wav,.ogg,.flac'

export function isPdfFilename(fileName: string): boolean {
  return /\.pdf$/i.test(fileName)
}

/** Filendelsen som brukes i R2-nøkkelen. */
export function uploadExtension(fileName: string): string {
  if (isPdfFilename(fileName)) return 'pdf'
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
}

/**
 * Hvorfor filen ikke kan lastes opp — eller null om den er grei. Kalles både i
 * nettleseren (umiddelbar tilbakemelding) og på serveren (fasit). Tidligere ble
 * for store filer forkastet i stillhet, som ga den misvisende meldingen
 * «Ingen gyldige filer».
 */
export function uploadRejectionReason(file: { name: string; size: number }): string | null {
  if (!isPdfFilename(file.name) && !isAudioFilename(file.name)) {
    return 'ikke en PDF- eller lydfil'
  }
  if (file.size <= 0) return 'filen er tom'
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024))
    const max = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    return `${mb} MB er over grensen på ${max} MB`
  }
  return null
}

// Nok til å dekke det lengste mønsteret vi ser etter, med margin.
const CARRY_CHARS = 64
const PAGE_OBJECT = /\/Type\s*\/Page[^s]/g

/**
 * Teller sider i en PDF ved å lete etter `/Type /Page`-objekter, bit for bit,
 * uten å holde hele filen i minnet. Samme heuristikk som det gamle
 * server-skannet, men den kjører gratis i nettleseren mens bitene uansett
 * leses for opplasting.
 *
 * Halen av forrige bit gjentas foran den neste slik at treff på bitgrensen
 * ikke går tapt. Bare treff som *slutter* i de nye bytene telles — ellers ville
 * overlappet telt de samme objektene to ganger.
 */
export function createPdfPageCounter() {
  const decoder = new TextDecoder('latin1')
  let carry = ''
  let count = 0
  return {
    push(bytes: Uint8Array) {
      const carryLength = carry.length
      const text = carry + decoder.decode(bytes)
      for (const match of text.matchAll(PAGE_OBJECT)) {
        if ((match.index ?? 0) + match[0].length > carryLength) count++
      }
      carry = text.slice(-CARRY_CHARS)
    },
    result(): number | null {
      return count > 0 ? count : null
    },
  }
}
