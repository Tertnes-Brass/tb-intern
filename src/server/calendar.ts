import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { type CalendarEvent, expandEvents } from '../lib/ical'
import { requireMe } from './access'

/**
 * Kalenderen hentes fra Google Calendar sin «Hemmelige adresse i iCal-format»
 * (`CALENDAR_ICS_URL`, en Workers-secret). Korpset fortsetter å redigere i
 * Google; internsiden er kun en leser.
 *
 * URL-en er hemmelig fordi den gir full lesetilgang til kalenderen uten
 * innlogging. Den skal derfor aldri returneres til klienten, aldri logges, og
 * aldri brukes som cache-nøkkel. `CALENDAR_EMBED_URL` er derimot den offentlige
 * embed-adressen og kan trygt sendes til nettleseren.
 */

/** Vinduet forsiden viser: fra i går (så dagens hendelse ikke forsvinner) og åtte uker frem. */
const WINDOW_BACK_MS = 86_400_000
const WINDOW_FORWARD_MS = 8 * 7 * 86_400_000
const MAX_EVENTS = 200

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

/**
 * Felles kjerne for `getCalendar` og `getNextEvent`. Kaster aldri: manglende
 * konfigurasjon og feil i feeden er tilstander UI-et skal kunne vise.
 */
async function loadCalendar(now: number): Promise<CalendarPayload> {
  const url = icsUrl()
  if (!url) return { configured: false, error: false, embedUrl: embedUrl(), next: null, events: [] }

  try {
    const ics = await fetchFeed(url)
    const events = expandEvents(ics, {
      from: now - WINDOW_BACK_MS,
      to: now + WINDOW_FORWARD_MS,
      max: MAX_EVENTS,
    })
    // «Neste» = første hendelse som ikke er ferdig ennå.
    const next = events.find((e) => Date.parse(e.end ?? e.start) >= now) ?? null
    return { configured: true, error: false, embedUrl: embedUrl(), next, events }
  } catch (error) {
    // Aldri logg URL-en — den er hemmelig og havner i Workers-loggene.
    console.error('[kalender] Klarte ikke hente eller tolke kalenderfeeden:', (error as Error).message)
    return { configured: true, error: true, embedUrl: embedUrl(), next: null, events: [] }
  }
}

/** Hele kalendervinduet: fra i går og åtte uker frem, maks 200 forekomster. */
export const getCalendar = createServerFn().handler(async (): Promise<CalendarPayload> => {
  await requireMe()
  return loadCalendar(Date.now())
})

/** Kun neste hendelse — til hub-forsiden, som ikke trenger hele lista. */
export const getNextEvent = createServerFn().handler(
  async (): Promise<{ configured: boolean; error: boolean; next: CalendarEvent | null }> => {
    await requireMe()
    const { configured, error, next } = await loadCalendar(Date.now())
    return { configured, error, next }
  },
)
