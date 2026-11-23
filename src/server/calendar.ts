import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { eventAttendance, eventSetlist } from '../db/schema'
import { calendarWindow } from '../lib/calendar-window'
import { toOsloDate } from '../lib/format'
import { type AgendaEvent, firstUnfinished, mergeGigEvents } from '../lib/gig-calendar'
import type { CalendarEvent } from '../lib/ical'
import { requireMe } from './access'
import { type CalendarPayload, loadCalendar } from './calendar-feed'
import { myGigEvents } from './project-crew-store'

/**
 * Serverfunksjonene for Kalender-området. Selve hentingen og tolkningen av
 * feeden bor i `calendar-feed.ts` — se kommentaren der for hvorfor. De lokale
 * dataene på en enkelt forekomst (øvingsplan, oppmøte) bor i `event-meta.ts`.
 */

export type { CalendarPayload }

/** Hele kalendervinduet: fra i går og fire måneder frem (`lib/calendar-window.ts`). */
export const getCalendar = createServerFn().handler(
  async (): Promise<
    Omit<CalendarPayload, 'events' | 'next'> & {
      events: AgendaEvent[]
      next: AgendaEvent | null
      keysWithPlan: string[]
      myAbsentKeys: string[]
    }
  > => {
    const me = await requireMe()
    const d = db()
    const now = Date.now()
    const window = calendarWindow(now)
    const [payload, gigs, rows, absent] = await Promise.all([
      loadCalendar(now),
      // Spilleoppdragene jeg er med på. De står ikke i Google-kalenderen.
      myGigEvents(d, me.id, toOsloDate(window.from), toOsloDate(window.to)),
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
    const events = mergeGigEvents<AgendaEvent>(payload.events, gigs)
    return {
      ...payload,
      events,
      next: firstUnfinished(events, now),
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
