/*
 * Service worker for Tertnes Brass Intern.
 *
 * Bevisst liten og uten byggesteg. Den gjør fire ting:
 *
 * 1. Hashede filer under /assets/ (JS, CSS, fonter) caches første gang de
 *    hentes og serveres derfra etterpå. Navnet endres når innholdet endres, så
 *    en fil i cachen er aldri utdatert.
 * 2. Sidenavigasjon går alltid til nettet først. Feiler nettet, brukes en
 *    lagret kopi av notestativ-siden hvis den finnes, ellers offline.html.
 * 3. Noter brukeren selv har lagret offline (src/lib/offline-notes.ts) ligger i
 *    OFFLINE_CACHE. For dem går forespørselen fortsatt til nettet først — det er
 *    serveren som avgjør tilgang, og et nei sletter kopien. Bare uten (eller med
 *    svært tregt) nett brukes kopien.
 * 4. Ingenting annet røres: server functions (/_serverFn/), resten av /api/* og
 *    alt med brukerdata går rett til nettet, uten cache.
 *
 * Bump VERSION når denne fila eller offline.html endres.
 */
const VERSION = 'v3'
const SHELL_CACHE = `tb-shell-${VERSION}`
const ASSET_CACHE = 'tb-assets'
/** Hashede filer fra gamle deployer blir liggende; taket holder cachen liten. */
const ASSET_LIMIT = 160
/** Brukerens lagrede noter og notestativ-sider. Må stemme med src/lib/offline-notes.ts. */
const OFFLINE_CACHE = 'tb-offline-v1'
/** Hvor lenge vi venter på nettet før en lagret note vises i stedet. */
const FILE_TIMEOUT_MS = 4000

const SHELL_FILES = ['/offline.html', '/icons/icon-192.png', '/icons/badge-96.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      for (const path of SHELL_FILES) {
        const response = await fetch(path, { cache: 'reload' })
        if (!response.ok) throw new Error(`${path}: ${response.status}`)
        await cache.put(path, await unredirected(response))
      }
      await self.skipWaiting()
    })(),
  )
})

/**
 * Cloudflare sine statiske filer svarer `/offline.html` med en omdirigering til
 * `/offline`. Et omdirigert svar kan ikke brukes som svar på en navigasjon
 * (nettleseren gir ERR_FAILED), så vi lagrer en ren kopi.
 */
async function unredirected(response) {
  if (!response.redirected) return response
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith('tb-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key)),
      )
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(navigation(event))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request))
    return
  }
  // Bare hele-fil-forespørsler: lydavspilling bruker Range og skal rett til nettet.
  if (url.pathname.startsWith('/api/files/') && !url.search && !request.headers.has('range')) {
    event.respondWith(noteFile(request, url.pathname))
  }
})

async function navigation(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const saved = await caches.match(event.request, { cacheName: OFFLINE_CACHE, ignoreSearch: true, ignoreVary: true })
    if (saved) return saved
    const offline = await caches.match('/offline.html', { cacheName: SHELL_CACHE })
    return offline ?? new Response('Frakoblet', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

async function asset(request) {
  const cache = await caches.open(ASSET_CACHE)
  // ignoreVary: Cloudflare svarer med `Vary: Origin`, og en modul-<script>
  // sender Origin mens en vanlig fetch() ikke gjør det. Filene er uforanderlige
  // (navnet er innholdets hash), så variasjonen betyr ingenting her.
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
    trimAssets(cache)
  }
  return response
}

async function trimAssets(cache) {
  const keys = await cache.keys()
  // keys() kommer i innsettingsrekkefølge: de eldste først.
  for (const key of keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT))) await cache.delete(key)
}

async function noteFile(request, path) {
  const cache = await caches.open(OFFLINE_CACHE)
  const saved = await cache.match(path, { ignoreVary: true })
  if (!saved) return fetch(request)

  const network = fetch(request).then(async (response) => {
    // Serveren sier nei (utlogget, tilgangen er borte, fila slettet): da skal
    // kopien heller ikke vises.
    if (response.status === 401 || response.status === 403 || response.status === 404) await cache.delete(path)
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), FILE_TIMEOUT_MS))
  try {
    const first = await Promise.race([network, timeout])
    if (first) return first
    // Tregt nett: vis kopien nå, og la nettet fullføre i bakgrunnen.
    network.catch(() => {})
    return saved
  } catch {
    return saved
  }
}
