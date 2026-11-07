import { env } from 'cloudflare:workers'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { bandMedia } from '../db/schema'
import { type BandMediaItem, MAX_BAND_MEDIA, bandMediaTitleRejection, normalizeBandMediaTitle } from '../lib/band-media'
import { newId } from '../lib/id'
import { messageMediaExtension, sniffImage, sniffedRejectionReason } from '../lib/message-media'
import type { Me } from './access'
import { MediaUploadError } from './message-media'

/**
 * Tertnes-samlingen, R2- og databaselaget. Vanlige eksporter, ikke
 * serverfunksjoner, i en EGEN modul: API-rutene `/api/band-media/*` kaller dem
 * direkte, og serverfunksjonene i `band-media.ts` kaller dem fra handlerne.
 * Ingen rutekomponent skal importere denne fila — et levende eksport som rører
 * `cloudflare:workers` ville dratt Workers-runtime inn i klientbygget.
 */

/**
 * Legger en GIF i samlingen. Samme kontroll av bytene som en opplasting i en
 * melding (`sniffImage`: GIF/PNG/JPEG/WebP, maks 10 MB, pikseltak) — den skal jo
 * kunne kopieres inn i en melding etterpå. R2-nøkkelen bygges av en fersk id,
 * aldri av filnavnet. Kalleren har sjekket `gifs.manage`.
 */
export async function storeBandMedia(bytes: Uint8Array, rawTitle: string, me: Me): Promise<BandMediaItem> {
  const titleError = bandMediaTitleRejection(rawTitle)
  if (titleError) throw new MediaUploadError(titleError)
  const image = sniffImage(bytes)
  const reason = sniffedRejectionReason(image, bytes.byteLength)
  if (reason || !image || !image.width || !image.height) throw new MediaUploadError(reason ?? 'Kunne ikke lese bildet')

  const d = db()
  const count = await d.select({ n: sql<number>`count(*)` }).from(bandMedia).get()
  if ((count?.n ?? 0) >= MAX_BAND_MEDIA) {
    throw new MediaUploadError(`Samlingen er full (${MAX_BAND_MEDIA}). Fjern noen før du legger til flere.`)
  }

  const id = newId()
  const title = normalizeBandMediaTitle(rawTitle)
  const r2Key = `band-media/${id}.${messageMediaExtension(image.contentType)}`
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: image.contentType } })
  try {
    await d.insert(bandMedia).values({
      id,
      r2Key,
      title,
      contentType: image.contentType,
      size: bytes.byteLength,
      width: image.width,
      height: image.height,
      addedBy: me.id,
      createdAt: new Date(),
    })
  } catch (err) {
    // Ingen foreldreløse objekter i R2 hvis raden ikke ble skrevet.
    await env.FILES.delete(r2Key).catch(() => {})
    throw err
  }
  return { id, title, contentType: image.contentType, width: image.width, height: image.height }
}

/** Det gaten og kopieringen trenger. Null når GIF-en ikke (lenger) finnes. */
export async function bandMediaSource(id: string): Promise<{ r2Key: string; contentType: string; title: string } | null> {
  const row = await db()
    .select({ r2Key: bandMedia.r2Key, contentType: bandMedia.contentType, title: bandMedia.title })
    .from(bandMedia)
    .where(eq(bandMedia.id, id))
    .get()
  return row ?? null
}
