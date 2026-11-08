import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { user } from '../db/auth-schema'
import { bandMedia } from '../db/schema'
import { BAND_MEDIA_GONE, BAND_MEDIA_NOT_YOURS, BAND_MEDIA_PERMISSION, type BandMediaListItem, canRemoveBandMedia } from '../lib/band-media'
import type { MessageMediaItem } from '../lib/message-media'
import { hasPermission, requireMe } from './access'
import { bandMediaSource } from './band-media-store'
import { storeMessageMedia } from './message-media'

/**
 * Tertnes-fanen i GIF-velgeren, serverfunksjonene. Bare serverfunksjoner
 * eksporteres herfra — velgeren importerer fila, og en levende eksport ville
 * dratt `cloudflare:workers` inn i klientbygget. R2-laget er
 * `band-media-store.ts`; opplastingen går via `/api/band-media/upload`.
 */

const idInput = z.object({ id: z.string().min(1).max(64) })

/**
 * Samlingen, nyeste først. Hver GIF sier om den er din, og hvem som la den til
 * — navnet vises bare i «Fjern»-bekreftelsen, så styret ser hvem de bør snakke
 * med. `canModerate`: kan fjerne andres (`gifs.manage`).
 */
export const listBandMedia = createServerFn().handler(async (): Promise<{ items: BandMediaListItem[]; canModerate: boolean }> => {
  const me = await requireMe()
  const rows = await db()
    .select({
      id: bandMedia.id,
      title: bandMedia.title,
      contentType: bandMedia.contentType,
      width: bandMedia.width,
      height: bandMedia.height,
      addedBy: bandMedia.addedBy,
      addedByName: user.name,
    })
    .from(bandMedia)
    .leftJoin(user, eq(user.id, bandMedia.addedBy))
    .orderBy(desc(bandMedia.createdAt))
  const items = rows.map(({ addedBy, addedByName, ...item }) => ({ ...item, mine: addedBy === me.id, addedByName: addedByName ?? null }))
  return { items, canModerate: hasPermission(me, BAND_MEDIA_PERMISSION) }
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
 * Fjerner en GIF fra samlingen: din egen, eller hvilken som helst med
 * `gifs.manage`. Raden først — den er eneste vei til bytene — og så R2. Feiler
 * R2, blir bytene liggende uten rad: usynlige for alle. Meldinger der GIF-en er
 * brukt, har sin egen kopi og røres ikke.
 */
export const removeBandMedia = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }): Promise<{ removed: boolean }> => {
    const me = await requireMe()
    const canModerate = hasPermission(me, BAND_MEDIA_PERMISSION)
    const row = await db().select({ addedBy: bandMedia.addedBy }).from(bandMedia).where(eq(bandMedia.id, data.id)).get()
    if (!row) return { removed: false }
    if (!canRemoveBandMedia(row, { id: me.id, canModerate })) throw new Error(BAND_MEDIA_NOT_YOURS)
    // Eierskapet sjekkes også i selve DELETE-en (uten moderering), så sjekk og sletting ikke kan skilles.
    const gone = await db()
      .delete(bandMedia)
      .where(canModerate ? eq(bandMedia.id, data.id) : and(eq(bandMedia.id, data.id), eq(bandMedia.addedBy, me.id)))
      .returning({ r2Key: bandMedia.r2Key })
    for (const { r2Key } of gone) {
      await env.FILES.delete(r2Key).catch((err: unknown) => console.error('[tertnes-gif] kunne ikke slette i R2:', err))
    }
    return { removed: gone.length > 0 }
  })
