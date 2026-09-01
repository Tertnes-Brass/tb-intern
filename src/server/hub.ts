import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { boardTasks, postComments, postMentions, postReactions, posts, projectWorks, projects, user } from '../db/schema'
import { boardAreaNote } from '../lib/board'
import { type HubArea, type HubCalendar, type HubEvent, type HubPost, type HubProject, areasFor, eventsAfter } from '../lib/hub'
import type { CalendarEvent } from '../lib/ical'
import { postPlainText } from '../lib/markdown'
import { type MentionUser, mentionPlainText } from '../lib/mentions'
import { excerpt, postHeading } from '../lib/posts'
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
/** Veggen øverst. Tre er nok til å vise at det finnes flere uten å bli en feed. */
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
    occurrenceKey: event.occurrenceKey,
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
        format: posts.format,
        importance: posts.importance,
        official: posts.official,
        authorName: user.name,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .leftJoin(user, eq(posts.authorId, user.id))
      .where(
        and(
          isNotNull(posts.publishedAt),
          canSeeBoardPosts ? undefined : eq(posts.audience, 'all'),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(LATEST_POSTS),
  ])

  // Tellerne hentes for de tre innleggene som faktisk vises — ikke for hele veggen.
  const postIds = postRows.map((p) => p.id)
  const [commentRows, reactionRows, mentionRows] = postIds.length
    ? await Promise.all([
        d
          .select({ postId: postComments.postId, n: sql<number>`count(*)` })
          .from(postComments)
          .where(inArray(postComments.postId, postIds))
          .groupBy(postComments.postId),
        d
          .select({ postId: postReactions.postId, n: sql<number>`count(*)` })
          .from(postReactions)
          .where(inArray(postReactions.postId, postIds))
          .groupBy(postReactions.postId),
        // Navnene på de omtalte: utdraget skal vise «@Ola», aldri «@[u:kd9…]».
        d
          .select({ postId: postMentions.postId, id: user.id, name: user.name })
          .from(postMentions)
          .innerJoin(user, eq(postMentions.userId, user.id))
          .where(inArray(postMentions.postId, postIds)),
      ])
    : [[], [], []]
  const commentCounts = new Map(commentRows.map((r) => [r.postId, r.n]))
  const likeCounts = new Map(reactionRows.map((r) => [r.postId, r.n]))
  const mentionsByPost = new Map<string, MentionUser[]>()
  for (const r of mentionRows) {
    mentionsByPost.set(r.postId, [...(mentionsByPost.get(r.postId) ?? []), { id: r.id, name: r.name }])
  }

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

  // Tallene på Styre-kortet hentes bare når rettigheten finnes — et vanlig
  // medlem skal ikke koste en spørring for et område det ikke ser.
  const areas = areasFor(me.permissions, { leadsPartIds: me.leadsPartIds })
  const withBoardNote = hasPermission(me, 'board.manage')
    ? await boardCounts(today).then((counts) =>
        areas.map((area) => (area.to === '/styre' ? { ...area, note: boardAreaNote(counts) ?? undefined } : area)),
      )
    : areas

  return {
    posts: postRows.map((p) => {
      // Markdown strippes til ren tekst før utdraget — hub-en skal aldri vise
      // «#» eller «**» (samme regel som feeden i src/server/posts.ts).
      const plain = mentionPlainText(postPlainText(p.body, p.format), mentionsByPost.get(p.id) ?? [])
      return {
        id: p.id,
        heading: postHeading({ title: p.title, body: plain }),
        excerpt: excerpt(plain, 120),
        publishedAt: p.publishedAt!.getTime(),
        important: p.importance === 'important',
        official: p.official,
        authorName: p.authorName ?? (p.official ? 'Styret' : 'Ukjent'),
        commentCount: commentCounts.get(p.id) ?? 0,
        likeCount: likeCounts.get(p.id) ?? 0,
      }
    }),
    me: {
      name: me.name,
      roleName: me.roleName,
      parts: me.parts.map((p) => ({ id: p.id, nameNo: p.nameNo })),
    },
    areas: withBoardNote,
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

/** Åpne og forfalte styreoppgaver. Én spørring, to tall. */
async function boardCounts(today: string): Promise<{ openTasks: number; overdue: number }> {
  const rows = await db()
    .select({
      openTasks: sql<number>`count(*)`,
      overdue: sql<number>`sum(case when ${boardTasks.dueDate} is not null and ${boardTasks.dueDate} < ${today} then 1 else 0 end)`,
    })
    .from(boardTasks)
    .where(sql`${boardTasks.status} <> 'done'`)
  return { openTasks: rows[0]?.openTasks ?? 0, overdue: rows[0]?.overdue ?? 0 }
}
