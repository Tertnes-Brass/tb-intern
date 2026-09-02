/**
 * Klientsiden av bildeopplasting i utstyrsregisteret: én PUT per bilde mot
 * `/api/utstyr-images/upload`. Ingen multipart, ingen signerte billetter — se
 * begrunnelsen i selve ruta. Kun nettleser-API-er her, ingen serverimport.
 */

import { assetImageRejectionReason } from './utstyr'

export type UploadedAssetImage = { id: string; fileName: string }

/** URL-en et bilde vises fra. Alltid gjennom gaten, aldri direkte mot R2. */
export function assetImageUrl(imageId: string): string {
  return `/api/utstyr-images/${imageId}`
}

async function errorFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (body?.error) return body.error
  if (res.status === 401) return 'Du er logget ut — logg inn på nytt'
  if (res.status === 403) return 'Du mangler tilgang til å endre utstyr'
  return 'Kunne ikke laste opp bildet'
}

/** Laster opp ett bilde til en gjenstand. Kaster med en melding som kan vises. */
export async function uploadAssetImage(assetId: string, file: File): Promise<UploadedAssetImage> {
  const reason = assetImageRejectionReason({ type: file.type, size: file.size })
  if (reason) throw new Error(`${file.name}: ${reason}`)

  const query = new URLSearchParams({ assetId, fileName: file.name })
  const res = await fetch(`/api/utstyr-images/upload?${query}`, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  return (await res.json()) as UploadedAssetImage
}

/**
 * Laster opp flere bilder etter tur. Rekkefølgen bevares (den blir `sortOrder`
 * server-side, og dermed hvilket bilde som blir miniatyren i lista), og første
 * feil stopper resten med en melding.
 */
export async function uploadAssetImages(assetId: string, files: File[]): Promise<UploadedAssetImage[]> {
  const out: UploadedAssetImage[] = []
  for (const file of files) out.push(await uploadAssetImage(assetId, file))
  return out
}
