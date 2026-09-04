import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { mediaItems } from '../db/schema'
import { BOARD_PERMISSION, type ByteRange, MEDIA_PERMISSION, type MediaKind, type MediaVisibility, canViewMedia } from '../lib/media'
import { type Me, hasPermission } from './access'

/**
 * Gaten og R2-laget for mediearkivet (#32), i en egen modul med vilje.
 *
 * `src/server/media.ts` består av serverfunksjoner, som vite-pluginen fjerner
 * fra klientbygget. Funksjonene her er vanlige eksporter kalt fra API-rutene
 * `/api/media/*`, og et *levende* eksport i en modul rutene importerer ville
 * dratt `cloudflare:workers` inn i klientbygget. Samme deling som
 * `post-images.ts`, `board-files.ts` og `utstyr-images.ts` (se AGENTS.md).
 *
 * Filene ligger i den samme R2-bøtta og bindingen som notefilene (`FILES`), men
 * under sitt eget nøkkelprefiks og bak sin egen gate. De nås ALDRI via
 * note-gaten i `/api/files/$fileId` (docs/tilgangsstyring.md).
 */

/** Alle mediefiler ligger under dette prefikset. */
export const MEDIA_R2_PREFIX = 'media/'

export type MediaBytes = {
  r2Key: string
  contentType: string
  fileName: string
  size: number
  kind: MediaKind
  visibility: MediaVisibility
}

/**
 * Slår opp filen bak en id OG håndhever tilgangsnivået. Dette er den ENESTE
 * gaten mellom en innlogget bruker og bytene, så regelen kan ikke ligge i ruta:
 * den ville da vært en av flere kopier, og en av kopiene ville før eller siden
 * vært den gamle.
 *
 * `null` betyr «finnes ikke ELLER du har ikke lov» — ruta svarer 404 på begge.
 * Å skille dem ville gjort et rått kall til et oppslagsverk over hvilke
 * styreopptak som finnes, og den som får svaret har uansett samme neste steg
 * (samme regel som `mentionRejection`, se AGENTS.md).
 */
export async function mediaAccess(mediaId: string, me: Me): Promise<MediaBytes | null> {
  const row = (
    await db()
      .select({
        r2Key: mediaItems.r2Key,
        contentType: mediaItems.contentType,
        fileName: mediaItems.fileName,
        size: mediaItems.size,
        kind: mediaItems.kind,
        visibility: mediaItems.visibility,
      })
      .from(mediaItems)
      .where(eq(mediaItems.id, mediaId))
      .limit(1)
  )[0]
  if (!row) return null
  if (!canViewMedia(row, { canManageBoard: hasPermission(me, BOARD_PERMISSION) })) return null
  return row
}

/** Kan `me` laste opp i mediearkivet i det hele tatt? */
export function canUploadMedia(me: Me): boolean {
  return hasPermission(me, MEDIA_PERMISSION)
}

export async function putMediaObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await env.FILES.put(key, body, { httpMetadata: { contentType } })
}

/**
 * Henter objektet, eventuelt bare et utsnitt. Utsnittet er det som gjør
 * avspilling mulig: `<audio>` og `<video>` ber om `Range`, og en spiller som
 * bare får 200 med hele filen kan ikke spole — på Safari starter den ikke
 * engang. Området er alltid beregnet av `parseByteRange` mot den lagrede
 * størrelsen, aldri sendt rått videre fra klienten.
 */
export async function getMediaObject(key: string, range?: ByteRange): Promise<R2ObjectBody | null> {
  if (!key.startsWith(MEDIA_R2_PREFIX)) return null
  return env.FILES.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined)
}

/**
 * Sletter bytene. Vokteren på prefikset hindrer at en feilaktig rad noen gang
 * kan slette en notefil, et styredokument eller et veggbilde fra den delte
 * bøtta.
 */
export async function deleteMediaObject(key: string): Promise<void> {
  if (!key.startsWith(MEDIA_R2_PREFIX)) return
  try {
    await env.FILES.delete(key)
  } catch (err) {
    console.error('[media] kunne ikke slette objektet i R2:', err)
  }
}
