/**
 * Vertsnavn-redirect fra de gamle domenene til det kanoniske.
 *
 * Notearkivet ble internsiden «Tertnes Brass Intern» og flyttet fra
 * `noter.tertnesbrass.com` til `intern.tertnesbrass.com`. Gamle URL-er lever
 * videre i e-poster (magiske lenker, passordreset), i vikarlenker delt på SMS
 * og i bokmerker, så det gamle domenet må bestå og svare 301 — også for
 * `/api/*` og `/v/*`.
 */

/**
 * Vertsnavn som skal 301-e videre. Ren allowlist: alt annet (localhost,
 * 127.0.0.1, *.workers.dev, det kanoniske domenet selv) slipper urørt gjennom.
 * `noter.saynain.com` var det aller første domenet og kan fortsatt ligge i
 * gamle bokmerker; det koster ingenting å ta det med.
 */
export const LEGACY_HOSTS: ReadonlyArray<string> = ['noter.tertnesbrass.com', 'noter.saynain.com']

/**
 * Returnerer den kanoniske URL-en forespørselen skal 301-es til, eller `null`
 * når den skal håndteres som normalt.
 *
 * @param requestUrl  Hele URL-en fra `Request.url`
 * @param canonicalOrigin  Kanonisk origin, dvs. `BETTER_AUTH_URL`
 */
export function legacyHostRedirect(requestUrl: string, canonicalOrigin: string): string | null {
  let url: URL
  let canonical: URL
  try {
    url = new URL(requestUrl)
    canonical = new URL(canonicalOrigin)
  } catch {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  if (!LEGACY_HOSTS.includes(hostname)) return null

  // Vern mot omdirigeringsløkke: før cutover peker BETTER_AUTH_URL fortsatt på
  // det gamle domenet, og da skal ingenting skje.
  if (canonical.hostname.toLowerCase() === hostname) return null

  // Sti, query og fragment følger med — gamle dyplenker skal lande riktig.
  return `${canonical.origin}${url.pathname}${url.search}${url.hash}`
}
