/**
 * Klientsiden av Tertnes-samlingen: opplastingen er én PUT mot
 * `/api/band-media/upload` med navnet i adressen. Kun nettleser-API-er her.
 */

import { BAND_MEDIA_CONSENT_REQUIRED, type BandMediaItem, bandMediaTitleRejection } from './band-media'
import { mediaRejectionReason } from './message-media'

/**
 * Legger en GIF i samlingen. `consent`: den som legger til har krysset av for at
 * alle som er med har sagt ja — serveren avviser opplastingen uten. Kaster med
 * en melding som kan vises.
 */
export async function uploadBandMedia(file: File, title: string, consent: boolean): Promise<BandMediaItem> {
  const reason =
    bandMediaTitleRejection(title) ?? mediaRejectionReason({ type: file.type, size: file.size }) ?? (consent ? null : BAND_MEDIA_CONSENT_REQUIRED)
  if (reason) throw new Error(reason)
  let res: Response
  try {
    res = await fetch(`/api/band-media/upload?title=${encodeURIComponent(title)}&consent=1`, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    })
  } catch {
    throw new Error('Ingen forbindelse — prøv igjen')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    if (body?.error) throw new Error(body.error)
    if (res.status === 401) throw new Error('Du er logget ut — logg inn på nytt')
    if (res.status === 413) throw new Error('Filen er større enn 10 MB')
    throw new Error('Kunne ikke legge til GIF-en')
  }
  return (await res.json()) as BandMediaItem
}
