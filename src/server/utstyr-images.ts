import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { assetImages, assets } from '../db/schema'
import { ASSETS_PERMISSION } from '../lib/utstyr'
import { type Me, hasPermission } from './access'

/**
 * Gaten og R2-laget for utstyrsbilder (#13), i en egen modul med vilje.
 *
 * `src/server/utstyr.ts` består av serverfunksjoner, som vite-pluginen fjerner
 * fra klientbygget. Funksjonene her er vanlige eksporter kalt fra API-rutene
 * `/api/utstyr-images/*`, og et *levende* eksport i en modul rutene importerer
 * ville dratt `cloudflare:workers` inn i klientbygget. Samme deling som
 * `post-images.ts` og `board-files.ts` (se AGENTS.md).
 *
 * Bildene ligger i den samme R2-bøtta og bindingen som notefilene (`FILES`),
 * men under sitt eget nøkkelprefiks og bak sin egen gate. De nås ALDRI via
 * note-gaten i `/api/files/$fileId` (docs/tilgangsstyring.md).
 */

/** Alle utstyrsbilder ligger under dette prefikset. */
export const ASSET_R2_PREFIX = 'utstyr/'

export type AssetImageBytes = { r2Key: string; contentType: string; fileName: string }

/**
 * Slår opp bildet bak en id. Registeret er lesbart for alle aktive medlemmer, så
 * gaten på visning er innlogging alene — den håndheves av `currentUser()` i
 * ruta, som er stedet som har forespørselen. Finnes ikke bildet, får kalleren
 * `null` og ruta svarer 404.
 */
export async function assetImageAccess(imageId: string): Promise<AssetImageBytes | null> {
  const row = (
    await db()
      .select({
        r2Key: assetImages.r2Key,
        contentType: assetImages.contentType,
        fileName: assetImages.fileName,
      })
      .from(assetImages)
      .where(eq(assetImages.id, imageId))
      .limit(1)
  )[0]
  return row ?? null
}

/**
 * Kan `me` legge til eller fjerne bilder på denne gjenstanden? Skriving i
 * registeret er `assets.manage` for alle rader — det finnes ingen «egen»
 * gjenstand slik det finnes et eget innlegg på veggen, så eierskap gir ingen
 * skriverett her. Gjenstanden må dessuten finnes: uten sjekken kunne en id fra
 * lufta lagt et objekt i R2 uten en rad å høre til.
 */
export async function canManageAssetImages(assetId: string, me: Me): Promise<boolean> {
  if (!hasPermission(me, ASSETS_PERMISSION)) return false
  const row = (await db().select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).limit(1))[0]
  return row !== undefined
}

export async function putAssetObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await env.FILES.put(key, body, { httpMetadata: { contentType } })
}

export async function getAssetObject(key: string): Promise<R2ObjectBody | null> {
  if (!key.startsWith(ASSET_R2_PREFIX)) return null
  return env.FILES.get(key)
}

/**
 * Sletter bytene. Vokteren på prefikset hindrer at en feilaktig rad noen gang
 * kan slette en notefil eller et styredokument fra den delte bøtta.
 */
export async function deleteAssetObject(key: string): Promise<void> {
  if (!key.startsWith(ASSET_R2_PREFIX)) return
  try {
    await env.FILES.delete(key)
  } catch (err) {
    console.error('[utstyr-images] kunne ikke slette objektet i R2:', err)
  }
}
