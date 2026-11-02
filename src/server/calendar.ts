import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { eventAttendance, eventSetlist } from '../db/schema'
import type { CalendarEvent } from '../lib/ical'
import { requireMe } from './access'
import { type CalendarPayload, loadCalendar } from './calendar-feed'

/**
 * Serverfunksjonene for Kalender-området. Selve hentingen og tolkningen av
 * feeden bor i `calendar-feed.ts` — se kommentaren der for hvorfor. De lokale
 * dataene på en enkelt forekomst (øvingsplan, oppmøte) bor i `event-meta.ts`.
 */

export type { CalendarPayload }

/** Hele kalendervinduet: fra i går og fire måneder frem (`lib/calendar-window.ts`). */
export const getCalendar = createServerFn().handler(
  async (): Promise<CalendarPayload & { keysWithPlan: string[]; myAbsentKeys: string[] }> => {
    const me = await requireMe()
    const d = db()
    const [payload, rows, absent] = await Promise.all([
      loadCalendar(Date.now()),
      // Nøklene med minst ett punkt i øvingsplanen — bare til den diskrete
      // markøren i lista. Ingen innhold, ingen navn: markøren sier at det finnes
      // en plan, og planen selv er uansett åpen for alle innloggede.
      d.selectDistinct({ occurrenceKey: eventSetlist.occurrenceKey }).from(eventSetlist),
      // Mitt eget fravær. Siden alle regnes som kommer, er det dette lista må
      // vise: «har jeg allerede meldt fra for torsdag?». Aldri andres.
      d
        .select({ occurrenceKey: eventAttendance.occurrenceKey })
        .from(eventAttendance)
        .where(and(eq(eventAttendance.userId, me.id), eq(eventAttendance.status, 'not_attending'))),
    ])
    return {
      ...payload,
      keysWithPlan: rows.map((r) => r.occurrenceKey),
      myAbsentKeys: absent.map((r) => r.occurrenceKey),
    }
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
