/**
 * Klientsiden av bildeopplasting på veggen: én PUT per bilde mot
 * `/api/post-images/upload`. Ingen multipart, ingen signerte billetter — se
 * begrunnelsen i selve ruta. Kun nettleser-API-er her, ingen serverimport.
 */

import { imageRejectionReason } from './posts'

export type UploadedPostImage = { id: string; fileName: string }

/** URL-en et bilde vises fra. Alltid gjennom gaten, aldri direkte mot R2. */
export function postImageUrl(imageId: string): string {
  return `/api/post-images/${imageId}`
}

async function errorFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (body?.error) return body.error
  if (res.status === 401) return 'Du er logget ut — logg inn på nytt'
  if (res.status === 403) return 'Du kan bare legge bilder på dine egne innlegg'
  return 'Kunne ikke laste opp bildet'
}

/** Laster opp ett bilde til et innlegg. Kaster med en melding som kan vises. */
export async function uploadPostImage(postId: string, file: File): Promise<UploadedPostImage> {
  const reason = imageRejectionReason({ type: file.type, size: file.size })
  if (reason) throw new Error(`${file.name}: ${reason}`)

  const query = new URLSearchParams({ postId, fileName: file.name })
  const res = await fetch(`/api/post-images/upload?${query}`, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  return (await res.json()) as UploadedPostImage
}

/**
 * Laster opp flere bilder etter tur. Rekkefølgen bevares (den blir
 * `sortOrder` server-side), og første feil stopper resten med en melding.
 */
export async function uploadPostImages(postId: string, files: File[]): Promise<UploadedPostImage[]> {
  const out: UploadedPostImage[] = []
  for (const file of files) out.push(await uploadPostImage(postId, file))
  return out
}
