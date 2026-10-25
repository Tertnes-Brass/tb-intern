/*
 * Service worker for Tertnes Brass Intern.
 *
 * Bevisst liten og uten byggesteg. Den gjør tre ting:
 *
 * 1. Hashede filer under /assets/ (JS, CSS, fonter) caches første gang de
 *    hentes og serveres derfra etterpå. Navnet endres når innholdet endres, så
 *    en fil i cachen er aldri utdatert.
 * 2. Sidenavigasjon går alltid til nettet først. Feiler nettet, vises
 *    offline.html i stedet for nettleserens feilside.
 * 3. Ingenting annet røres: server functions (/_serverFn/), /api/* og alt med
 *    brukerdata går rett til nettet, uten cache. Tilgangskontrollen bor på
 *    serveren, og en service worker skal aldri kunne svare på vegne av den.
 *
 * Bump VERSION når denne fila eller offline.html endres.
 */
const VERSION = 'v1'
const SHELL_CACHE = `tb-shell-${VERSION}`
const ASSET_CACHE = 'tb-assets'
/** Hashede filer fra gamle deployer blir liggende; taket holder cachen liten. */
const ASSET_LIMIT = 160

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
  }
})

async function navigation(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const offline = await caches.match('/offline.html', { cacheName: SHELL_CACHE })
    return offline ?? new Response('Frakoblet', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

async function asset(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)
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
