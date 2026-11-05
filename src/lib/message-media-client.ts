/**
 * Klientsiden av bilder i samtalene: én PUT per fil mot
 * `/api/message-media/upload`, og en DELETE når et bilde krysses vekk før
 * meldingen sendes. Kun nettleser-API-er her, ingen serverimport.
 */

import { type MessageMediaItem, mediaRejectionReason, messageMediaUrl } from './message-media'

async function errorFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (body?.error) return body.error
  if (res.status === 401) return 'Du er logget ut — logg inn på nytt'
  if (res.status === 413) return 'Filen er større enn 10 MB'
  return 'Kunne ikke laste opp bildet'
}

/** Laster opp ett bilde som utkast. Kaster med en melding som kan vises. */
export async function uploadMessageMedia(file: File): Promise<MessageMediaItem> {
  const reason = mediaRejectionReason({ type: file.type, size: file.size })
  if (reason) throw new Error(reason)
  let res: Response
  try {
    res = await fetch('/api/message-media/upload', {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    })
  } catch {
    throw new Error('Ingen forbindelse — prøv igjen')
  }
  if (!res.ok) throw new Error(await errorFrom(res))
  return (await res.json()) as MessageMediaItem
}

/**
 * Fjerner et utkast. Beste forsøk: feiler det, tar den daglige ryddingen det,
 * og ingen andre kan se det i mellomtiden.
 */
export function discardMessageMedia(id: string): void {
  void fetch(messageMediaUrl(id), { method: 'DELETE', keepalive: true }).catch(() => {})
}

/**
 * Bildene i et lim inn (Cmd+V av et bilde eller en GIF man har kopiert, eller
 * et GIF-tastatur som limer inn). Tom liste når det ikke er bilder der.
 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = [...data.files].filter((f) => f.type.startsWith('image/'))
  if (files.length) return files
  // Noen nettlesere legger bildet bare i `items`.
  return [...data.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((f): f is File => !!f)
}
