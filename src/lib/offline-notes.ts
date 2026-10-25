/**
 * Noter lagret for offline-bruk — for øvelser og konserter med dårlig nett.
 *
 * Bare det serveren allerede har latt brukeren åpne kan lagres: hver fil hentes
 * gjennom den vanlige fil-gaten (`/api/files/$fileId?download=1`, logget som
 * nedlasting i filtilgangsloggen), og legges i Cache Storage under den rene
 * adressen (`/api/files/$fileId`). Service workeren (`public/sw.js`) går
 * fortsatt til nettet først når den kan — da er det serveren som avgjør, og et
 * nei (401/403/404) sletter den lagrede kopien. Bare uten nett brukes kopien.
 *
 * Notestativ-siden lagres også, slik at den kan åpnes uten nett, og
 * `offline.html` lister stativene fra indeksen i `localStorage`.
 *
 * Alt slettes ved utlogging (`clearOfflineNotes`) og når prosjektet ikke
 * lenger er kommende (`pruneOfflineStands`).
 */

/** Må stemme med OFFLINE_CACHE i public/sw.js. */
export const OFFLINE_CACHE = 'tb-offline-v1'
const INDEX_KEY = 'tb-offline-stands'

export type OfflineStand = {
  projectId: string
  name: string
  fileIds: string[]
  /** Antall filer, for offline.html. */
  files: number
  bytes: number
  savedAt: number
}

export function offlineSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

export function offlineStands(): OfflineStand[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeIndex(stands: OfflineStand[]) {
  try {
    if (stands.length === 0) window.localStorage.removeItem(INDEX_KEY)
    else window.localStorage.setItem(INDEX_KEY, JSON.stringify(stands))
  } catch {}
  window.dispatchEvent(new Event('tb:offline-changed'))
}

export function onOfflineChange(listener: () => void): () => void {
  window.addEventListener('tb:offline-changed', listener)
  return () => window.removeEventListener('tb:offline-changed', listener)
}

export function offlineStand(projectId: string): OfflineStand | null {
  return offlineStands().find((s) => s.projectId === projectId) ?? null
}

export function standPath(projectId: string): string {
  return `/noter/stativ/${encodeURIComponent(projectId)}`
}

function filePath(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}`
}

/**
 * Lagrer alle filene på et stativ, pluss selve stativ-siden. Feiler én fil,
 * stopper vi og rydder opp det som ble lagret for dette stativet — et halvt
 * stativ offline er verre enn ingen, for det oppdager man først på øvelsen.
 */
export async function saveStandOffline(
  project: { id: string; name: string },
  fileIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<OfflineStand> {
  const cache = await caches.open(OFFLINE_CACHE)
  const unique = [...new Set(fileIds)]
  let bytes = 0
  try {
    for (const [i, fileId] of unique.entries()) {
      const response = await fetch(`${filePath(fileId)}?download=1`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(response.status === 403 ? 'Du har ikke lenger tilgang til en av filene.' : 'Kunne ikke hente en av filene.')
      const blob = await response.blob()
      bytes += blob.size
      await cache.put(
        filePath(fileId),
        new Response(blob, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(blob.size) } }),
      )
      onProgress?.(i + 1, unique.length)
    }
    const page = await fetch(standPath(project.id), { credentials: 'same-origin' })
    if (page.ok && !page.redirected) {
      await cache.put(standPath(project.id), page.clone())
      await warmAssets(await page.text())
    }
  } catch (err) {
    await removeEntries(cache, project.id, unique)
    throw err
  }

  const stand: OfflineStand = {
    projectId: project.id,
    name: project.name,
    fileIds: unique,
    files: unique.length,
    bytes,
    savedAt: Date.now(),
  }
  writeIndex([...offlineStands().filter((s) => s.projectId !== project.id), stand])
  return stand
}

/**
 * Sørger for at JS, CSS og fonter siden trenger ligger i service workerens
 * cache (den legger alt under /assets/ der når det hentes), og at pdf.js er
 * hentet. Uten dette kan en lagret side mangle koden sin uten nett.
 */
async function warmAssets(html: string) {
  const urls = new Set(html.match(/\/assets\/[\w.-]+\.(?:js|mjs|css|woff2)/g) ?? [])
  await Promise.all([...urls].map((url) => fetch(url).catch(() => {})))
  const { warmPdfAssets } = await import('./pdf-loader')
  await warmPdfAssets()
}

async function removeEntries(cache: Cache, projectId: string, fileIds: string[]) {
  // En fil kan ligge på flere stativ (samme verk i to prosjekter).
  const keep = new Set(offlineStands().filter((s) => s.projectId !== projectId).flatMap((s) => s.fileIds))
  await Promise.all(fileIds.filter((id) => !keep.has(id)).map((id) => cache.delete(filePath(id))))
  await cache.delete(standPath(projectId), { ignoreSearch: true })
}

export async function removeStandOffline(projectId: string): Promise<void> {
  const stand = offlineStand(projectId)
  if (offlineSupported()) {
    const cache = await caches.open(OFFLINE_CACHE)
    await removeEntries(cache, projectId, stand?.fileIds ?? [])
  }
  writeIndex(offlineStands().filter((s) => s.projectId !== projectId))
}

/**
 * Fjerner stativ for prosjekter som ikke lenger er kommende. Fil-gaten slipper
 * uansett ikke stemmene ut etter konserten; kopien skal ikke leve lenger.
 */
export async function pruneOfflineStands(upcomingProjectIds: string[]): Promise<void> {
  const keep = new Set(upcomingProjectIds)
  for (const stand of offlineStands()) {
    if (!keep.has(stand.projectId)) await removeStandOffline(stand.projectId)
  }
}

/** Ved utlogging: ingen noter skal ligge igjen på en delt enhet. */
export async function clearOfflineNotes(): Promise<void> {
  try {
    window.localStorage.removeItem(INDEX_KEY)
  } catch {}
  if (offlineSupported()) await caches.delete(OFFLINE_CACHE)
  window.dispatchEvent(new Event('tb:offline-changed'))
}

export function offlineBytes(): number {
  return offlineStands().reduce((sum, s) => sum + s.bytes, 0)
}
