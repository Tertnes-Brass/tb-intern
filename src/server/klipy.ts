import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { KLIPY_API_BASE, type KlipyConfig, MAX_KLIPY_DIMENSION, isKlipyMediaUrl } from '../lib/klipy'
import { EXTERNAL_MEDIA_KINDS, type MessageMediaItem } from '../lib/message-media'
import { requireMe } from './access'
import { createKlipyMedia } from './message-media'

/**
 * GIF-velgeren (KLIPY), server-siden. Søket går fra nettleseren rett til KLIPY
 * (vilkåret for å bruke dem — se src/lib/klipy.ts); serveren gir bare
 * innloggede medlemmer det de trenger for å søke, og tar imot valget.
 */

/**
 * Pseudonymet KLIPY ser (`customer_id`, til «nylig brukt» og bedre treff):
 * HMAC av bruker-id-en med en hemmelighet bare vi har. Stabilt per medlem, men
 * KLIPY kan verken se hvem det er eller koble det til noe annet hos oss.
 */
async function customerIdFor(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`klipy:${userId}`)))
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Det klienten trenger for å søke, eller null når GIF-søket er av (ingen
 * `KLIPY_API_KEY`). Nøkkelen står i adressen til hvert kall mot KLIPY — slik
 * er KLIPYs API laget for nettleser-klienter — og gis derfor bare til
 * innloggede medlemmer. I `pnpm dev` uten nøkkel peker den på den lokale
 * etterligningen (`/api/dev-klipy`), som viser KLIPYs egne eksempelfiler.
 */
export const getKlipyConfig = createServerFn().handler(async (): Promise<KlipyConfig | null> => {
  const me = await requireMe()
  const appKey = env.KLIPY_API_KEY?.trim()
  if (appKey) return { appKey, customerId: await customerIdFor(me.id), apiBase: KLIPY_API_BASE }
  if (import.meta.env.DEV) return { appKey: 'dev', customerId: await customerIdFor(me.id), apiBase: '/api/dev-klipy' }
  return null
})

/**
 * Et valg fra GIF-velgeren blir et utkast, som en opplasting, og sendes med
 * meldingen som en vanlig bilde-id. Adressen MÅ være på KLIPYs CDN.
 */
export const addKlipyMedia = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(EXTERNAL_MEDIA_KINDS),
      slug: z.string().min(1).max(200),
      title: z.string().max(500).default(''),
      url: z.string().refine(isKlipyMediaUrl, 'Ugyldig adresse fra KLIPY'),
      width: z.number().int().min(1).max(MAX_KLIPY_DIMENSION * 4),
      height: z.number().int().min(1).max(MAX_KLIPY_DIMENSION * 4),
    }),
  )
  .handler(async ({ data }): Promise<MessageMediaItem> => {
    const me = await requireMe()
    return createKlipyMedia(data, me)
  })
