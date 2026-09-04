import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { eventSetlist } from '../db/schema'
import type { CalendarEvent } from '../lib/ical'
import type { SocialListItem } from '../lib/social'
import { requireMe } from './access'
import { type CalendarPayload, loadCalendar } from './calendar-feed'
import { loadSocialEvents } from './social-feed'

/**
 * Serverfunksjonene for Kalender-området. Selve hentingen og tolkningen av
 * feeden bor i `calendar-feed.ts` — se kommentaren der for hvorfor. De lokale
 * dataene på en enkelt forekomst (øvingsplan, oppmøte) bor i `event-meta.ts`.
 */

export type { CalendarPayload }

/** Hele kalendervinduet: fra i går og fire måneder frem (`lib/calendar-window.ts`). */
export const getCalendar = createServerFn().handler(
  async (): Promise<CalendarPayload & { keysWithPlan: string[]; social: SocialListItem[] }> => {
    const me = await requireMe()
    const now = Date.now()
    const [payload, rows, social] = await Promise.all([
      loadCalendar(now),
      // Nøklene med minst ett punkt i øvingsplanen — bare til den diskrete
      // markøren i lista. Ingen innhold, ingen navn: markøren sier at det finnes
      // en plan, og planen selv er uansett åpen for alle innloggede.
      db().selectDistinct({ occurrenceKey: eventSetlist.occurrenceKey }).from(eventSetlist),
      // De sosiale arrangementene (#31) er en egen, lokal kilde og hentes
      // uavhengig av feeden — nettopp derfor overlever de at Google er nede.
      loadSocialEvents(now, me.id),
    ])
    return { ...payload, keysWithPlan: rows.map((r) => r.occurrenceKey), social }
  },
)

/** Kun neste hendelse — til hub-forsiden, som ikke trenger hele lista. */
export const getNextEvent = createServerFn().handler(
  async (): Promise<{ configured: boolean; error: boolean; next: CalendarEvent | null }> => {
    await requireMe()
    const { configured, error, next } = await loadCalendar(Date.now())
    return { configured, error, next }
  },
)
