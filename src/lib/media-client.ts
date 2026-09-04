/**
 * Klientsiden av mediearkivet (#32): én PUT per fil mot `/api/media/upload`.
 * Ingen multipart, ingen signerte billetter — se begrunnelsen i selve ruta.
 * Kun nettleser-API-er her, ingen serverimport.
 */

import { type MediaKind, type MediaVisibility, mediaRejectionReason } from './media'

export type UploadedMedia = { id: string; title: string; kind: MediaKind }

/**
 * URL-en filen vises eller spilles fra. Alltid gjennom gaten, aldri direkte mot
 * R2 — det er der tilgangsnivået håndheves.
 */
export function mediaFileUrl(mediaId: string): string {
  return `/api/media/${mediaId}`
}

/** Samme fil, men som nedlasting i stedet for avspilling. */
export function mediaDownloadUrl(mediaId: string): string {
  return `/api/media/${mediaId}?last=1`
}

async function errorFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (body?.error) return body.error
  if (res.status === 401) return 'Du er logget ut — logg inn på nytt'
  if (res.status === 403) return 'Du mangler tilgang til å legge inn media'
  if (res.status === 413) return 'Filen er for stor'
  return 'Kunne ikke laste opp filen'
}

/**
 * Laster opp én fil og oppretter medieelementet. Kaster med en melding som kan
 * vises rått.
 *
 * Størrelsen og filtypen sjekkes HER også, ikke bare på serveren — ikke som
 * sikkerhet (den ligger server-side), men fordi alternativet er at brukeren
 * sender 300 MB over mobilnettet for å få nei til slutt. Går filen over
 * Workers-taket, blir svaret dessuten en nettverksfeil uten forklaring, og da
 * er det denne sjekken som er forskjellen på en beskjed og en gåte.
 */
export async function uploadMediaFile(file: File, visibility: MediaVisibility): Promise<UploadedMedia> {
  const reason = mediaRejectionReason({ type: file.type, size: file.size })
  if (reason) throw new Error(`${file.name}: ${reason}`)

  const query = new URLSearchParams({ fileName: file.name, tilgang: visibility })
  const res = await fetch(`/api/media/upload?${query}`, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  return (await res.json()) as UploadedMedia
}
