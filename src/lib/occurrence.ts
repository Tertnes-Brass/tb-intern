/**
 * Stabil identitet for ÉN forekomst av en kalenderhendelse (#82).
 *
 * Alt lokalt vi henger på kalenderen — øvingsplan, oppmøte, fravær,
 * prosjektkobling — peker på en `occurrenceKey`. Nøkkelen må derfor overleve at
 * feeden leses på nytt, at vinduet flyttes, at cachen tømmes og at hendelsen
 * blir *flyttet* i Google. Den er nettopp derfor ikke `CalendarEvent.id`:
 *
 * - `id` er `uid#<faktisk start>` for gjentakende forekomster. Flytter dirigenten
 *   øvelsen fra 19:00 til 18:00 (Google skriver da en egen VEVENT med
 *   `RECURRENCE-ID` = det OPPRINNELIGE tidspunktet), endrer `id` seg — og
 *   øvingsplanen ville blitt hengende igjen på et tidspunkt som ikke finnes.
 * - `occurrenceKey` bygges av `uid` + forekomstens **opprinnelige** start, altså
 *   `RECURRENCE-ID`-verdien for en flyttet forekomst. Den er uendret etter en
 *   flytting.
 *
 * Formatet er `base64url(uid)` for en enkelthendelse, og
 * `base64url(uid).YYYYMMDDTHHMMSSZ` for en forekomst i en serie.
 *
 * - **Deterministisk:** ingen tilfeldighet, ingen tellere, ingen database. To
 *   parseringer av samme feed gir samme nøkkel, og en database som mistet
 *   kalenderen finner tilbake til radene sine når feeden kommer igjen.
 * - **URL-trygg:** base64url-alfabetet (`A–Z a–z 0–9 - _`) og `.` er alle
 *   «unreserved» i RFC 3986, så nøkkelen kan stå rå i `/kalender/$eventId` uten
 *   prosentkoding. UID-en fra Google inneholder `@` og av og til `_` og `%`, og
 *   kunne ikke stått rå.
 * - **Reversibel:** `parseOccurrenceKey` gir uid-en tilbake. Vi lagrer riktignok
 *   `uid` i `event_meta` også (snapshotet skal kunne leses uten feeden), men en
 *   nøkkel som kan tolkes er lettere å feilsøke enn en hash — og en hash ville
 *   ikke gitt noe ekstra: `uid` er ingen hemmelighet for den som er logget inn.
 */

/** Base64url uten `=`-polstring. `btoa` finnes både i workerd og i node. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** `2026-03-25T18:00:00.000Z` → `20260325T180000Z` (iCalendar-formen, uten skilletegn). */
function compactUtc(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** `20260325T180000Z` → `2026-03-25T18:00:00.000Z`. */
function expandUtc(compact: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(compact)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss] = m
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * Nøkkelen for en forekomst.
 *
 * @param uid iCalendar-UID-en. Den samme for hele en gjentakende serie.
 * @param originalStart Forekomstens OPPRINNELIGE start (ISO-8601), eller `null`
 *   for en hendelse uten gjentakelse. For en flyttet forekomst er dette
 *   `RECURRENCE-ID`-verdien — ikke det nye tidspunktet.
 */
export function occurrenceKey(uid: string, originalStart: string | null): string {
  const encoded = toBase64Url(uid)
  if (!originalStart) return encoded
  const stamp = compactUtc(originalStart)
  // En ugyldig dato skal ikke gi en nøkkel som ser gyldig ut; da er
  // enkelthendelse-formen det ærlige svaret.
  return stamp ? `${encoded}.${stamp}` : encoded
}

export type ParsedOccurrenceKey = {
  uid: string
  /** Opprinnelig start i UTC, eller `null` for en enkelthendelse. */
  originalStart: string | null
}

export function parseOccurrenceKey(key: string): ParsedOccurrenceKey | null {
  if (!isOccurrenceKey(key)) return null
  const dot = key.indexOf('.')
  const encoded = dot === -1 ? key : key.slice(0, dot)
  const uid = fromBase64Url(encoded)
  if (!uid) return null
  if (dot === -1) return { uid, originalStart: null }
  const originalStart = expandUtc(key.slice(dot + 1))
  return originalStart ? { uid, originalStart } : null
}

/**
 * Formsjekk. Brukt i `validator(zod)` på hver serverfunksjon som tar en nøkkel,
 * slik at et rått kall ikke kan bruke ruteparameteren som et fritt tekstfelt.
 * Taket på 512 tegn er romslig: en Google-UID er 30–80 tegn (≈110 base64url).
 */
export function isOccurrenceKey(value: string): boolean {
  return value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+(?:\.\d{8}T\d{6}Z)?$/.test(value)
}
