import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db'
import { projectWorks, projects } from '../db/schema'
import { type HubArea, type HubCalendar, type HubEvent, type HubProject, areasFor, eventsAfter } from '../lib/hub'
import type { CalendarEvent } from '../lib/ical'
import { requireMe } from './access'
import { loadCalendar } from './calendar-feed'

/**
 * Datagrunnlaget for hub-forsiden `/`. Hub-en er plattformflaten: den viser det
 * neste og veien videre, ikke hvert områdes oversikt i miniatyr
 * (docs/designprinsipper.md §4 og §7 pkt 3). Derfor er payloaden bevisst liten —
 * repertoarlisten bor på `/noter`, hele kalenderen på `/kalender`.
 */

/** Hendelser under hero. Fire er nok til å fylle en skjerm uten å bli en kalender. */
const UPCOMING_EVENTS = 4
/** Prosjekter under hero når kalenderen ikke er tilgjengelig. */
const UPCOMING_PROJECTS = 4

export type HubPayload = {
  me: {
    name: string
    roleName: string
    parts: Array<{ id: string; nameNo: string }>
  }
  /** Snarveiene brukeren har tilgang til, utledet av rettighetene (`areasFor`). */
  areas: HubArea[]
  calendar: HubCalendar
  nextProject: HubProject | null
  upcomingProjects: Array<{ id: string; name: string; eventDate: string; venue: string | null }>
}

/** Kalenderfeeden har flere felt enn hub-en viser; send bare det som brukes. */
function toHubEvent(event: CalendarEvent): HubEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
  }
}

type DatedProject = { id: string; name: string; eventDate: string; venue: string | null; description: string | null }

export const getHub = createServerFn().handler(async (): Promise<HubPayload> => {
  const me = await requireMe()
  const d = db()
  const today = new Date().toISOString().slice(0, 10)

  // Kalender og prosjekter er uavhengige kilder — hent dem samtidig.
  const [calendar, upcomingRows] = await Promise.all([
    loadCalendar(Date.now()),
    d
      .select({
        id: projects.id,
        name: projects.name,
        eventDate: projects.eventDate,
        venue: projects.venue,
        description: projects.description,
      })
      .from(projects)
      .where(and(eq(projects.isPublished, true), gte(projects.eventDate, today)))
      .orderBy(asc(projects.eventDate))
      .limit(UPCOMING_PROJECTS + 1),
  ])

  // `gte` utelukker allerede NULL-datoer i SQL; filteret gjør det sant for typen òg.
  const upcoming = upcomingRows.filter((p): p is DatedProject => p.eventDate !== null)
  const next = upcoming[0] ?? null

  const workCount = next
    ? await d
        .select({ n: sql<number>`count(*)` })
        .from(projectWorks)
        .where(eq(projectWorks.projectId, next.id))
        .then((rows) => rows[0]?.n ?? 0)
    : 0

  const nextEvent = calendar.next ? toHubEvent(calendar.next) : null
  const events = calendar.events.map(toHubEvent)

  return {
    me: {
      name: me.name,
      roleName: me.roleName,
      parts: me.parts.map((p) => ({ id: p.id, nameNo: p.nameNo })),
    },
    areas: areasFor(me.permissions),
    calendar: {
      configured: calendar.configured,
      error: calendar.error,
      next: nextEvent,
      upcoming: eventsAfter(events, nextEvent, UPCOMING_EVENTS),
    },
    nextProject: next ? { ...next, workCount } : null,
    upcomingProjects: upcoming.slice(1, 1 + UPCOMING_PROJECTS),
  }
})
