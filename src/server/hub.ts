import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { posts, projectWorks, projects } from '../db/schema'
import { type HubArea, type HubCalendar, type HubEvent, type HubPost, type HubProject, areasFor, eventsAfter } from '../lib/hub'
import type { CalendarEvent } from '../lib/ical'
import { excerpt } from '../lib/posts'
import { hasPermission, requireMe } from './access'
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
/** Beskjeder øverst. Tre er nok til å vise at det finnes flere uten å bli en feed. */
const LATEST_POSTS = 3

export type HubPayload = {
  /** De siste publiserte beskjedene brukeren har lov til å se. */
  posts: HubPost[]
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

  // `posts.publish` gir også innsyn i beskjeder merket for styret. Utkast
  // (published_at IS NULL) kommer aldri på hub-en, uansett rettighet.
  const canSeeBoardPosts = hasPermission(me, 'posts.publish')

  // Kalender, prosjekter og beskjeder er uavhengige kilder — hent dem samtidig.
  const [calendar, upcomingRows, postRows] = await Promise.all([
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
    d
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        importance: posts.importance,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(
        and(
          isNotNull(posts.publishedAt),
          canSeeBoardPosts ? undefined : eq(posts.audience, 'all'),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(LATEST_POSTS),
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
    posts: postRows.map((p) => ({
      id: p.id,
      title: p.title,
      excerpt: excerpt(p.body, 120),
      publishedAt: p.publishedAt!.getTime(),
      important: p.importance === 'important',
    })),
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
