import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { bandMedia } from '../db/schema'
import { BAND_MEDIA_GONE, BAND_MEDIA_PERMISSION, type BandMediaItem } from '../lib/band-media'
import type { MessageMediaItem } from '../lib/message-media'
import { hasPermission, requireMe, requirePermission } from './access'
import { bandMediaSource } from './band-media-store'
import { storeMessageMedia } from './message-media'

/**
 * Tertnes-fanen i GIF-velgeren, serverfunksjonene. Bare serverfunksjoner
 * eksporteres herfra — velgeren importerer fila, og en levende eksport ville
 * dratt `cloudflare:workers` inn i klientbygget. R2-laget er
 * `band-media-store.ts`; opplastingen går via `/api/band-media/upload`.
 */

const idInput = z.object({ id: z.string().min(1).max(64) })

/** Samlingen, nyeste først, og om den som spør kan legge til og fjerne. */
export const listBandMedia = createServerFn().handler(async (): Promise<{ items: BandMediaItem[]; canManage: boolean }> => {
  const me = await requireMe()
  const items = await db()
    .select({
      id: bandMedia.id,
      title: bandMedia.title,
      contentType: bandMedia.contentType,
      width: bandMedia.width,
      height: bandMedia.height,
    })
    .from(bandMedia)
    .orderBy(desc(bandMedia.createdAt))
  return { items, canManage: hasPermission(me, BAND_MEDIA_PERMISSION) }
})

/**
 * Et valg i Tertnes-fanen blir et utkast i meldingen — en KOPI av bytene, lagret
 * gjennom samme vei som en opplasting (`storeMessageMedia`: samme kontroll, samme
 * tak på utkast, samme gate etterpå). Meldingen eier kopien sin, så en GIF som
 * senere fjernes fra samlingen blir stående der den er brukt, og slettes med
 * meldingen. Navnet blir alt-tekst.
 */
export const pickBandMedia = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }): Promise<MessageMediaItem> => {
    const me = await requireMe()
    const source = await bandMediaSource(data.id)
    const object = source ? await env.FILES.get(source.r2Key) : null
    if (!source || !object) throw new Error(BAND_MEDIA_GONE)
    return storeMessageMedia(new Uint8Array(await object.arrayBuffer()), me, { title: source.title })
  })

/**
 * Fjerner en GIF fra samlingen. Raden først — den er eneste vei til bytene — og
 * så R2. Feiler R2, blir bytene liggende uten rad: usynlige for alle. Meldinger
 * der GIF-en er brukt, har sin egen kopi og røres ikke.
 */
export const removeBandMedia = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }): Promise<{ removed: boolean }> => {
    await requirePermission(BAND_MEDIA_PERMISSION)
    const gone = await db().delete(bandMedia).where(eq(bandMedia.id, data.id)).returning({ r2Key: bandMedia.r2Key })
    for (const { r2Key } of gone) {
      await env.FILES.delete(r2Key).catch((err: unknown) => console.error('[tertnes-gif] kunne ikke slette i R2:', err))
    }
    return { removed: gone.length > 0 }
  })
