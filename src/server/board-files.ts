import { env } from 'cloudflare:workers'
import { newId } from '../lib/id'

/**
 * Styredokumenter i R2. Samme bøtte og samme binding som notefilene (`FILES`),
 * men et eget nøkkelprefiks og en egen gate.
 *
 * Denne modulen har et *levende* eksport som rører `cloudflare:workers`, og må
 * derfor aldri importeres direkte fra en rutekomponent — bare fra serverkode
 * (`board.ts` og rutene under `src/routes/api/board-files/`). Samme deling som
 * `calendar-feed.ts` (se AGENTS.md).
 */

/** Alle styredokumenter ligger under dette prefikset. */
export const BOARD_R2_PREFIX = 'board/'

/** 25 MB. Referater, budsjetter og kontrakter — ikke video. */
export const BOARD_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Filnavnet slik det lagres og sendes tilbake: uten stier og kontrolltegn. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned.slice(0, 200) || 'dokument'
}

/**
 * Innholdstyper vi tør vise i nettleseren. Alt annet strømmes som nedlasting
 * med `application/octet-stream`: et opplastet HTML- eller SVG-dokument vist
 * inline ville kjørt skript på vårt eget origin.
 */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
])

/** Normaliserer klientens content-type til noe vi vil lagre. */
export function storableContentType(raw: string | null): string {
  const value = (raw ?? '').split(';')[0]!.trim().toLowerCase()
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value)) return 'application/octet-stream'
  return value.slice(0, 120)
}

/** Kan denne typen vises i nettleseren, eller må den lastes ned? */
export function canRenderInline(contentType: string): boolean {
  return INLINE_TYPES.has(contentType)
}

/** Filendelsen, små bokstaver, kun a–z0–9 — brukes bare i R2-nøkkelen. */
export function keyExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName)
  return match ? `.${match[1]!.toLowerCase()}` : ''
}

/**
 * Nøkkelen bygges av en fersk id, aldri av brukerens filnavn: da kan ingen
 * skrive utenfor prefikset eller over et annet dokument.
 */
export function boardObjectKey(documentId: string, fileName: string): string {
  return `${BOARD_R2_PREFIX}${documentId}${keyExtension(fileName)}`
}

export function newDocumentId(): string {
  return newId()
}

export async function putBoardObject(
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await env.FILES.put(key, body, { httpMetadata: { contentType } })
}

export async function getBoardObject(key: string): Promise<R2ObjectBody | null> {
  if (!key.startsWith(BOARD_R2_PREFIX)) return null
  return env.FILES.get(key)
}

export async function deleteBoardObject(key: string): Promise<void> {
  // Vokteren hindrer at en feilaktig rad noen gang kan slette en notefil.
  if (!key.startsWith(BOARD_R2_PREFIX)) return
  try {
    await env.FILES.delete(key)
  } catch (err) {
    console.error('[board-files] kunne ikke slette objektet i R2:', err)
  }
}
