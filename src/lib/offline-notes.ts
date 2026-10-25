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
 * Notestativ-siden lagres også, med all JS, CSS og fonter den trenger, i den
 * samme cachen (som aldri trimmes) — ellers kunne noen deployer senere ha
 * skjøvet koden ut av service workerens asset-cache, og siden ville stått og
 * ventet for alltid uten nett. `offline.html` lister stativene fra indeksen i
 * `localStorage`.
 *
 * Hvert stativ vet hvem som lagret det (`ownerId`). Logger en annen bruker inn
 * på enheten uten at forrige logget ut (økten utløp, kontoen ble deaktivert),
 * slettes alt (`claimOfflineNotes`). Alt slettes også ved utlogging
 * (`clearOfflineNotes`) og når prosjektet ikke lenger er kommende
 * (`pruneOfflineStands`).
 */

/** Må stemme med OFFLINE_CACHE i public/sw.js. */
export const OFFLINE_CACHE = 'tb-offline-v1'
const INDEX_KEY = 'tb-offline-stands'
/** Selv uten endringer friskes et lagret stativ opp når det er så gammelt. */
const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000

export type OfflineStand = {
  projectId: string
  name: string
  fileIds: string[]
  /** JS/CSS/fonter siden trenger, lagret ved siden av filene. */
  assets: string[]
  /** Antall filer, for offline.html. */
  files: number
  bytes: number
  savedAt: number
  /** Brukeren som lagret stativet. */
  ownerId: string
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

/** Bare én lagring av gangen per stativ (Mine noter og stativet kan begge be om det). */
const inFlight = new Map<string, Promise<OfflineStand>>()

/**
 * Lagrer alle filene på et stativ, pluss selve stativ-siden og koden den
 * trenger. Filer som allerede ligger i cachen hentes ikke på nytt, og filer som
 * ikke lenger hører til stativet fjernes. Feiler én fil ved første lagring,
 * rydder vi opp — et halvt stativ offline er verre enn ingen, for det oppdager
 * man først på øvelsen.
 */
export function saveStandOffline(
  project: { id: string; name: string },
  fileIds: string[],
  ownerId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<OfflineStand> {
  const running = inFlight.get(project.id)
  if (running) return running
  const task = claimOfflineNotes(ownerId)
    .then(() => doSave(project, fileIds, ownerId, onProgress))
    .finally(() => inFlight.delete(project.id))
  inFlight.set(project.id, task)
  return task
}

async function doSave(
  project: { id: string; name: string },
  fileIds: string[],
  ownerId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<OfflineStand> {
  // Be om varig lagring, så nettleseren ikke rydder bort notene for å frigjøre
  // plass. Et nei er greit — da er det bare som før.
  void navigator.storage?.persist?.().catch(() => {})
  const cache = await caches.open(OFFLINE_CACHE)
  const previous = offlineStand(project.id)
  const unique = [...new Set(fileIds)]
  let bytes = 0
  let assets: string[] = previous?.assets ?? []
  try {
    for (const [i, fileId] of unique.entries()) {
      const cached = await cache.match(filePath(fileId))
      if (cached) {
        bytes += Number(cached.headers.get('Content-Length') ?? 0)
      } else {
        const response = await fetch(`${filePath(fileId)}?download=1`, { credentials: 'same-origin' })
        if (!response.ok) {
          throw new Error(response.status === 403 ? 'Du har ikke lenger tilgang til en av filene.' : 'Kunne ikke hente en av filene.')
        }
        const blob = await response.blob()
        bytes += blob.size
        await cache.put(
          filePath(fileId),
          new Response(blob, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(blob.size) } }),
        )
      }
      onProgress?.(i + 1, unique.length)
    }
    const page = await fetch(standPath(project.id), { credentials: 'same-origin' })
    if (page.ok && !page.redirected) {
      const html = await page.clone().text()
      await cache.put(standPath(project.id), page)
      assets = await storeAssets(cache, html)
    }
  } catch (err) {
    // Første lagring: rydd opp. En oppfrisking som feiler, beholder det som var.
    if (!previous) await removeEntries(cache, project.id, unique, [])
    throw err
  }

  const stand: OfflineStand = {
    projectId: project.id,
    name: project.name,
    fileIds: unique,
    assets,
    files: unique.length,
    bytes,
    savedAt: Date.now(),
    ownerId,
  }
  const others = offlineStands().filter((s) => s.projectId !== project.id)
  writeIndex([...others, stand])
  if (previous) {
    // Filer og kode som falt ut av programmet (eller ble byttet ved en deploy).
    const droppedFiles = previous.fileIds.filter((id) => !unique.includes(id))
    const droppedAssets = previous.assets.filter((url) => !assets.includes(url))
    await removeEntries(cache, project.id, droppedFiles, droppedAssets, { keepPage: true })
  }
  return stand
}

/** Øvre grense for hvor mange filer kartleggingen følger — en vakt, ikke et mål. */
const MAX_ASSETS = 400
/** `./x.js`, `/assets/x.js`, `assets/x.css` osv. — slik Vite-bygget peker på filer. */
const ASSET_REF = /(?:\.\/|\/assets\/|assets\/)([\w.-]+\.(?:m?js|css|woff2))/g

/**
 * Legger ALL koden stativ-siden trenger i offline-cachen. Lista bygges ikke av
 * det denne økten tilfeldigvis har lastet, men ved å følge referansene fra den
 * lagrede HTML-en: hver JS-fil leses for statiske og dynamiske importer (og
 * Vites `__vite__mapDeps`-liste), CSS for fonter, og pdf.js-modulen og
 * arbeideren legges til eksplisitt fordi de lastes dynamisk. Av fontene tas
 * bare det latinske utvalget med — det er det norsk tekst bruker.
 *
 * Kaster hvis en fil ikke kan hentes, så stativet aldri merkes «Lagret» uten
 * koden sin.
 */
async function storeAssets(cache: Cache, html: string): Promise<string[]> {
  const { pdfAssetUrls } = await import('./pdf-loader')
  const queue = new Set<string>()
  const enqueue = (name: string) => {
    if (name.endsWith('.woff2') && (!name.includes('-latin-') || name.includes('-latin-ext-'))) return
    queue.add(`/assets/${name}`)
  }
  for (const match of html.matchAll(ASSET_REF)) enqueue(match[1]!)
  for (const url of await pdfAssetUrls()) queue.add(new URL(url, window.location.href).pathname)

  const stored = new Set<string>()
  for (const url of queue) {
    if (stored.size >= MAX_ASSETS) break
    if (stored.has(url)) continue
    const response = await fetch(url)
    // En referanse som ikke er en fil i bygget (pdf.js har f.eks. en CDN-variant
    // i koden), er ikke noe siden laster. Alt annet må finnes.
    if (response.status === 404) continue
    if (!response.ok) throw new Error('Kunne ikke lagre appen for bruk uten nett. Prøv igjen.')
    const blob = await response.blob()
    await cache.put(url, new Response(blob, { headers: response.headers }))
    stored.add(url)
    if (/\.(?:m?js|css)$/.test(url)) {
      for (const match of (await blob.text()).matchAll(ASSET_REF)) enqueue(match[1]!)
    }
  }
  return [...stored]
}

/**
 * Holder et lagret stativ i takt med programmet: er det endret, mangler en fil
 * (service workeren sletter kopien når serveren sier nei), eller er det over et
 * døgn gammelt, lagres det på nytt. Gjør ingenting uten nett, eller når
 * stativet ikke er lagret.
 */
export async function syncStandOffline(project: { id: string; name: string }, fileIds: string[], ownerId: string): Promise<void> {
  await claimOfflineNotes(ownerId)
  const saved = offlineStand(project.id)
  if (!saved || !offlineSupported() || !navigator.onLine) return
  const wanted = [...new Set(fileIds)]
  const sameSet = wanted.length === saved.fileIds.length && wanted.every((id) => saved.fileIds.includes(id))
  let missing = false
  if (sameSet) {
    const cache = await caches.open(OFFLINE_CACHE)
    for (const id of wanted) {
      if (!(await cache.match(filePath(id)))) {
        missing = true
        break
      }
    }
  }
  if (sameSet && !missing && Date.now() - saved.savedAt < RESYNC_AFTER_MS) return
  await saveStandOffline(project, wanted, ownerId)
}

async function removeEntries(
  cache: Cache,
  projectId: string,
  fileIds: string[],
  assets: string[],
  opts: { keepPage?: boolean } = {},
) {
  // Filer og kode kan deles mellom stativ (samme verk i to prosjekter).
  const others = offlineStands().filter((s) => s.projectId !== projectId)
  const keepFiles = new Set(others.flatMap((s) => s.fileIds))
  const keepAssets = new Set(others.flatMap((s) => s.assets ?? []))
  await Promise.all([
    ...fileIds.filter((id) => !keepFiles.has(id)).map((id) => cache.delete(filePath(id))),
    ...assets.filter((url) => !keepAssets.has(url)).map((url) => cache.delete(url)),
  ])
  if (!opts.keepPage) await cache.delete(standPath(projectId), { ignoreSearch: true })
}

export async function removeStandOffline(projectId: string): Promise<void> {
  const stand = offlineStand(projectId)
  if (offlineSupported()) {
    const cache = await caches.open(OFFLINE_CACHE)
    await removeEntries(cache, projectId, stand?.fileIds ?? [], stand?.assets ?? [])
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

/** Én avklaring per bruker og sidelasting; alle lagringer venter på den. */
let claimed: { userId: string; done: Promise<void> } | null = null

/**
 * Sørger for at offline-cachen tilhører `userId`. Ligger det noter fra en ANNEN
 * bruker der (forrige bruker logget aldri ut), slettes alt. Det samme gjelder
 * en cache uten indeks — rester etter en lagring som ble avbrutt (appen drept
 * midt i), som ellers kunne vist forrige brukers side uten nett.
 *
 * Kalles fra roten for hver innlogget bruker, og fra hver lagring og synk før
 * de rører cachen — rekkefølgen mellom effekter i React er ikke noe å stole på.
 */
export function claimOfflineNotes(userId: string): Promise<void> {
  if (claimed?.userId === userId) return claimed.done
  const done = (async () => {
    if (!offlineSupported()) return
    const stands = offlineStands()
    if (stands.some((s) => s.ownerId !== userId)) await clearOfflineNotes()
    else if (stands.length === 0 && (await caches.has(OFFLINE_CACHE))) await caches.delete(OFFLINE_CACHE)
  })()
  claimed = { userId, done: done.catch(() => {}) }
  return claimed.done
}

/** Ved utlogging: ingen noter skal ligge igjen på en delt enhet. */
export async function clearOfflineNotes(): Promise<void> {
  claimed = null
  try {
    window.localStorage.removeItem(INDEX_KEY)
  } catch {}
  if (offlineSupported()) await caches.delete(OFFLINE_CACHE)
  window.dispatchEvent(new Event('tb:offline-changed'))
}

export function offlineBytes(): number {
  return offlineStands().reduce((sum, s) => sum + s.bytes, 0)
}
