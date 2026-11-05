/**
 * GIF-velgeren: KLIPY (som Discord bruker etter at Tenor ble lagt ned 30. juni
 * 2026). Rene regler her — adresser, tolking av svar og hvilke medieadresser vi
 * godtar — slik at de kan testes uten nettleser og deles av klienten og serveren.
 *
 * KLIPYs standardvilkår (docs.klipy.com/integration-requirements) styrer
 * arkitekturen, og er grunnen til at dette ser annerledes ut enn opplastingene:
 *
 * - Søk og visning skjer fra MEDLEMMETS nettleser, rett mot api.klipy.com og
 *   KLIPYs CDN. Ingen proxy og ingen kopi hos oss (det krever skriftlig
 *   godkjenning fra KLIPY). Leserens IP og lesetidspunkt blir dermed synlig for
 *   KLIPY når en GIF vises — et bevisst valg (4. november 2026), og bare for
 *   adresser `isKlipyMediaUrl` godtar. `referrerPolicy="no-referrer"` sørger for
 *   at KLIPY ikke får vite HVOR GIF-en ble vist.
 * - Medieadressen lagres og brukes slik den kom fra KLIPY.
 * - Søkefeltet har plassholderen «Search KLIPY» (påkrevd), og resultatene vises
 *   i rekkefølgen KLIPY ga dem, i et eget rutenett.
 * - Annonser er av (det er standard per nøkkel i KLIPYs partnerpanel). Skulle
 *   et `type: 'ad'`-objekt likevel komme, har det ingen medieformater og vises
 *   ikke — vi kan ikke vise annonser riktig uten KLIPYs annonse-SDK.
 *
 * `customer_id` er et pseudonym (HMAC av bruker-id-en, se `src/server/klipy.ts`),
 * aldri vår bruker-id eller e-post.
 */

import type { ExternalMediaKind, MessageMediaType } from './message-media'

export const KLIPY_API_BASE = 'https://api.klipy.com'

/** KLIPYs CDN-er (docs.klipy.com/network-requirements). Bare disse vises og lagres. */
export const KLIPY_MEDIA_HOSTS = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'] as const

/** `locale` på søk (landskode) og på kategorier (språk_LAND). */
export const KLIPY_SEARCH_LOCALE = 'no'
export const KLIPY_CATEGORY_LOCALE = 'nb_NO'
/** KLIPYs innholdsfilter. «medium» ≈ det Discord viser som standard. */
export const KLIPY_CONTENT_FILTER = 'medium'
export const KLIPY_PAGE_SIZE = 24

/** Fanene i velgeren og KLIPYs navn på dem i adressen. */
export const KLIPY_KINDS: readonly ExternalMediaKind[] = ['gif', 'sticker', 'meme']
const SEGMENT: Record<ExternalMediaKind, string> = { gif: 'gifs', sticker: 'stickers', meme: 'static-memes' }

/** Det klienten får fra serveren før den kan søke. */
export type KlipyConfig = {
  appKey: string
  /** Pseudonymet KLIPY ser — stabilt per medlem, umulig å føre tilbake uten vår hemmelighet. */
  customerId: string
  /** `https://api.klipy.com`, eller den lokale etterligningen i `pnpm dev` uten nøkkel. */
  apiBase: string
}

export type KlipyRendition = { url: string; width: number; height: number }

/** Ett treff i velgeren. */
export type KlipyItem = {
  kind: ExternalMediaKind
  slug: string
  title: string
  /** Lite format til rutenettet. */
  preview: KlipyRendition
  /** Det som lagres og vises i meldingen. */
  full: KlipyRendition
  /** Et stillbilde (JPG/PNG) til rutenettet for den som har bedt om redusert bevegelse. */
  still: KlipyRendition | null
}

export type KlipyCategory = { label: string; query: string; previewUrl: string | null }

type Op =
  | { op: 'search'; q: string; page: number }
  | { op: 'trending'; page: number }
  | { op: 'recent'; page: number }
  | { op: 'categories' }
  | { op: 'share'; slug: string }

/** Adressen for et kall mot KLIPY. Nøkkelen står i stien — slik KLIPYs API er laget. */
export function klipyEndpoint(config: KlipyConfig, kind: ExternalMediaKind, request: Op): string {
  const root = `${config.apiBase}/api/v1/${encodeURIComponent(config.appKey)}/${SEGMENT[kind]}`
  const common = (page: number) => ({
    page: String(page),
    per_page: String(KLIPY_PAGE_SIZE),
    customer_id: config.customerId,
    locale: KLIPY_SEARCH_LOCALE,
    content_filter: KLIPY_CONTENT_FILTER,
  })
  switch (request.op) {
    case 'search':
      return `${root}/search?${new URLSearchParams({ q: request.q, ...common(request.page) })}`
    case 'trending':
      return `${root}/trending?${new URLSearchParams(common(request.page))}`
    case 'recent':
      return `${root}/recent/${encodeURIComponent(config.customerId)}?${new URLSearchParams({ page: String(request.page), per_page: String(KLIPY_PAGE_SIZE) })}`
    case 'categories':
      return `${root}/categories?${new URLSearchParams({ locale: KLIPY_CATEGORY_LOCALE })}`
    case 'share':
      return `${root}/share/${encodeURIComponent(request.slug)}`
  }
}

/**
 * Er dette en medieadresse fra KLIPYs CDN? Det eneste som får lagres som et
 * KLIPY-valg — ellers kunne et rått kall lagt inn et sporingsbilde fra hvilken
 * som helst vert, og alle som leste tråden, ville hentet det.
 */
export function isKlipyMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 600) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    url.port === '' &&
    (KLIPY_MEDIA_HOSTS as readonly string[]).includes(url.hostname) &&
    contentTypeForKlipyUrl(raw) !== null
  )
}

/** Bildetypen ut fra filendelsen på en KLIPY-adresse. Video (mp4/webm) brukes ikke. */
export function contentTypeForKlipyUrl(raw: string): MessageMediaType | null {
  let path: string
  try {
    path = new URL(raw).pathname.toLowerCase()
  } catch {
    return null
  }
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  return null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

/**
 * Formatet vi bruker i en gitt størrelse. Animert WebP før GIF (en tiendedel så
 * stort, og vises i alle nettlesere vi støtter); for stickers og memes PNG før
 * JPG (gjennomsiktighet).
 */
function rendition(file: unknown, sizes: readonly string[], formatOrder = ['webp', 'gif', 'png', 'jpg']): KlipyRendition | null {
  if (!file || typeof file !== 'object') return null
  for (const size of sizes) {
    const formats = (file as Record<string, unknown>)[size]
    if (!formats || typeof formats !== 'object') continue
    for (const format of formatOrder) {
      const r = (formats as Record<string, unknown>)[format] as Record<string, unknown> | undefined
      const width = num(r?.width)
      const height = num(r?.height)
      if (r && isKlipyMediaUrl(r.url) && width && height) return { url: r.url, width, height }
    }
  }
  return null
}

/**
 * Treffene i et søk/trending/nylig-svar, i KLIPYs rekkefølge. Et objekt uten
 * brukbare medieformater (en annonse, et ukjent format) hoppes over.
 */
export function parseKlipyItems(kind: ExternalMediaKind, json: unknown): { items: KlipyItem[]; hasNext: boolean } {
  const data = (json as { data?: { data?: unknown; has_next?: unknown } } | null)?.data
  const list = Array.isArray(data?.data) ? data.data : []
  const items: KlipyItem[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const it = raw as { slug?: unknown; title?: unknown; file?: unknown; type?: unknown }
    if (it.type === 'ad' || typeof it.slug !== 'string' || !it.slug) continue
    const preview = rendition(it.file, ['sm', 'xs', 'md'])
    const full = rendition(it.file, ['md', 'hd', 'sm'])
    if (!preview || !full) continue
    const still = rendition(it.file, ['sm', 'xs'], ['jpg', 'png'])
    items.push({ kind, slug: it.slug, title: typeof it.title === 'string' ? it.title.slice(0, 200) : '', preview, full, still })
  }
  return { items, hasNext: data?.has_next === true }
}

export function parseKlipyCategories(json: unknown): KlipyCategory[] {
  const list = (json as { data?: { categories?: unknown } } | null)?.data?.categories
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const c = raw as { category?: unknown; query?: unknown; preview_url?: unknown } | null
    if (!c || typeof c.query !== 'string' || !c.query.trim()) return []
    const label = typeof c.category === 'string' && c.category.trim() ? c.category : c.query
    return [{ label, query: c.query, previewUrl: isKlipyMediaUrl(c.preview_url) ? c.preview_url : null }]
  })
}

/** Maks bredde/høyde vi tar imot fra klienten for et KLIPY-valg (kun til layout). */
export const MAX_KLIPY_DIMENSION = 4096
