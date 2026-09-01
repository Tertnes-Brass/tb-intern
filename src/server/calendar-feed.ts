import { env } from 'cloudflare:workers'
import { calendarWindow } from '../lib/calendar-window'
import { type CalendarEvent, expandEvents } from '../lib/ical'

/**
 * Henting og tolkning av kalenderfeeden. Ligger i sin egen modul, atskilt fra
 * serverfunksjonene i `calendar.ts`, fordi `loadCalendar` må kunne kalles fra
 * andre serverfunksjoner (`getHub`) — en serverfunksjon skal ikke kalle en
 * annen. Et *levende* eksport her ville dratt `cloudflare:workers` med inn i
 * klientbygget via rutene som importerer `calendar.ts`; med delingen ser
 * klienten bare serverfunksjonene, og denne filen forblir ren serverkode.
 *
 * Kalenderen hentes fra Google Calendar sin «Hemmelige adresse i iCal-format»
 * (`CALENDAR_ICS_URL`, en Workers-secret). Korpset fortsetter å redigere i
 * Google; internsiden er kun en leser.
 *
 * URL-en er hemmelig fordi den gir full lesetilgang til kalenderen uten
 * innlogging. Den skal derfor aldri returneres til klienten, aldri logges, og
 * aldri brukes som cache-nøkkel. `CALENDAR_EMBED_URL` er derimot den offentlige
 * embed-adressen og kan trygt sendes til nettleseren.
 */

/**
 * Vinduet (fra i går, fire måneder frem) og taket på antall forekomster bor i
 * `lib/calendar-window.ts` — se begrunnelsene der. Hub-forsiden bruker samme
 * `loadCalendar`, men sender bare de fire neste hendelsene til klienten
 * (`eventsAfter` i `getHub`), så det lengre vinduet gjør ikke hub-payloaden
 * større.
 */

/** Feeden er treg og endrer seg sjelden; ti minutter er rikelig ferskt for en korpskalender. */
const CACHE_TTL_SECONDS = 600
/**
 * Syntetisk cache-nøkkel. Domenet finnes ikke og treffes aldri av en request —
 * poenget er at nøkkelen er stabil og *ikke* inneholder den hemmelige URL-en.
 */
const CACHE_KEY = 'https://calendar.tb-notearkiv.internal/feed.ics'

export type CalendarPayload = {
  /** `CALENDAR_ICS_URL` er satt. */
  configured: boolean
  /** Henting eller parsing feilet — UI-et viser en rolig feilmelding. */
  error: boolean
  embedUrl: string | null
  next: CalendarEvent | null
  events: CalendarEvent[]
}

function icsUrl(): string | null {
  const value = env.CALENDAR_ICS_URL?.trim()
  return value ? value : null
}

function embedUrl(): string | null {
  const value = env.CALENDAR_EMBED_URL?.trim()
  return value && /^https:\/\//i.test(value) ? value : null
}

/** Bare det vi bruker — holder koden uavhengig av DOM- kontra Workers-typen for `Cache`. */
type FeedCache = {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

/** Åpner cachen hvis runtime har en. Miniflare og prod har det; node-tester har det ikke. */
function defaultCache(): FeedCache | null {
  try {
    return (globalThis as { caches?: { default?: FeedCache } }).caches?.default ?? null
  } catch {
    return null
  }
}

/**
 * Henter feeden med to lag cache: Workers sin edge-cache på selve fetch-en
 * (`cf.cacheTtl`, virker kun i prod) og `caches.default` under en nøkkel uten
 * hemmeligheter (virker også i `pnpm dev`/miniflare). Faller pent tilbake til
 * ren henting hvis cache-API-et mangler.
 */
async function fetchFeed(url: string): Promise<string> {
  const cache = defaultCache()
  const cacheKey = new Request(CACHE_KEY, { method: 'GET' })

  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) return await hit.text()
    } catch {
      // Cache-oppslag skal aldri velte sidevisningen.
    }
  }

  const response = await fetch(url, {
    headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  })
  if (!response.ok) throw new Error(`Kalenderfeeden svarte ${response.status}`)
  const text = await response.text()

  if (cache) {
    try {
      await cache.put(
        cacheKey,
        new Response(text, {
          headers: {
            'content-type': 'text/calendar; charset=utf-8',
            'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
          },
        }),
      )
    } catch {
      // Cache-skriving er en optimalisering, ikke en forutsetning.
    }
  }

  return text
}

/** Forekomstene i vinduet + «neste» = første som ikke er ferdig ennå. */
function expand(ics: string, now: number): { next: CalendarEvent | null; events: CalendarEvent[] } {
  const events = expandEvents(ics, calendarWindow(now))
  return { next: events.find((e) => Date.parse(e.end ?? e.start) >= now) ?? null, events }
}

/**
 * Felles kjerne for `getCalendar`, `getNextEvent` og `getHub`. Kaster aldri:
 * manglende konfigurasjon og feil i feeden er tilstander UI-et skal kunne vise.
 * Gjør ingen tilgangssjekk selv — kalleren eier `requireMe()`.
 */
export async function loadCalendar(now: number): Promise<CalendarPayload> {
  const url = icsUrl()
  if (!url) {
    // I dev uten secret: en generert demofeed, slik at kalenderen — og
    // demo-øvingsplanen som henger på en forekomst i den (#82) — faktisk har
    // noe å vise. `import.meta.env.DEV` er statisk `false` i produksjonsbygget,
    // så både grenen og `./dev-calendar` faller bort der.
    if (import.meta.env.DEV) {
      const { devCalendarIcs } = await import('./dev-calendar')
      return { configured: true, error: false, embedUrl: embedUrl(), ...expand(devCalendarIcs(now), now) }
    }
    return { configured: false, error: false, embedUrl: embedUrl(), next: null, events: [] }
  }

  try {
    const ics = await fetchFeed(url)
    return { configured: true, error: false, embedUrl: embedUrl(), ...expand(ics, now) }
  } catch (error) {
    // Aldri logg URL-en — den er hemmelig og havner i Workers-loggene.
    console.error('[kalender] Klarte ikke hente eller tolke kalenderfeeden:', (error as Error).message)
    return { configured: true, error: true, embedUrl: embedUrl(), next: null, events: [] }
  }
}
