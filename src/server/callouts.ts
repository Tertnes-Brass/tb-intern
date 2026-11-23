import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { calloutResponses, notificationPreferences, postCallouts, posts, projectCrew, projects } from '../db/schema'
import { CALLOUT_NOTE_MAX, CALLOUT_STATUSES, calloutState, canManageCallout, normalizeCalloutNote } from '../lib/callouts'
import { toOsloDate } from '../lib/format'
import { GIG_KIND } from '../lib/project-access'
import { PUSH_TTL, crewDropoutPushMessage } from '../lib/push'
import { canReadPost } from '../lib/posts'
import { hasPermission, requireMe, requirePermission } from './access'
import { sendPushToUsers } from './push-send'

/**
 * Svarene på «Kan du?». Kun serverfunksjoner eksporteres herfra, så modulen
 * trygt kan importeres fra en rute. Reglene ligger i `src/lib/callouts.ts`,
 * innsynet i `callout-store.ts`.
 */

const NOT_FOUND = 'Fant ikke beskjeden'

async function readableCallout(postId: string) {
  const me = await requireMe()
  const d = db()
  const row = (
    await d
      .select({
        postId: posts.id,
        title: posts.title,
        audience: posts.audience,
        publishedAt: posts.publishedAt,
        authorId: posts.authorId,
        kind: postCallouts.kind,
        projectId: postCallouts.projectId,
        ownDate: postCallouts.eventDate,
        ownTime: postCallouts.startTime,
        respondBy: postCallouts.respondBy,
        closedAt: postCallouts.closedAt,
        projectDate: projects.eventDate,
        projectTime: projects.startTime,
      })
      .from(postCallouts)
      .innerJoin(posts, eq(postCallouts.postId, posts.id))
      .leftJoin(projects, eq(postCallouts.projectId, projects.id))
      .where(eq(postCallouts.postId, postId))
      .limit(1)
  )[0]
  // Samme svar for «finnes ikke» og «ikke for deg», som ellers på veggen.
  if (
    !row ||
    !row.publishedAt ||
    !canReadPost({ audience: row.audience, publishedAt: row.publishedAt.getTime() }, hasPermission(me, 'posts.publish'))
  ) {
    throw new Error(NOT_FOUND)
  }
  const linked = row.projectId !== null
  const timing = {
    eventDate: linked ? row.projectDate : row.ownDate,
    startTime: linked ? row.projectTime : row.ownTime,
    respondBy: row.respondBy,
    closedAt: row.closedAt?.getTime() ?? null,
  }
  return { me, d, row, timing }
}

/** Mitt svar. `status: null` trekker svaret, så lenge det er åpent. */
export const respondToCallout = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      postId: z.string().min(1),
      status: z.enum(CALLOUT_STATUSES).nullable(),
      note: z.string().max(CALLOUT_NOTE_MAX * 2).nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const { me, d, row, timing } = await readableCallout(data.postId)
    const state = calloutState(timing, Date.now())
    const where = and(eq(calloutResponses.postId, row.postId), eq(calloutResponses.userId, me.id))

    if (data.status === null) {
      if (!state.canClear) throw new Error(state.message)
      await d.delete(calloutResponses).where(where)
      return { ok: true }
    }

    const before = (await d.select().from(calloutResponses).where(where).limit(1))[0]
    // Et uendret svar med ny merknad er lov også når det ikke kan settes på nytt.
    if (!state.allowed.includes(data.status) && before?.status !== data.status) {
      throw new Error(state.message || 'Svaret kan ikke endres nå')
    }
    if (state.phase === 'past') throw new Error(state.message)

    const note = data.note === undefined ? (before?.note ?? null) : normalizeCalloutNote(data.note)
    const now = new Date()
    await d
      .insert(calloutResponses)
      .values({ postId: row.postId, userId: me.id, status: data.status, note, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [calloutResponses.postId, calloutResponses.userId],
        set: { status: data.status, note, updatedAt: now },
      })

    // Noen i besetningen faller fra: den ansvarlige må få vite det med en gang.
    if (data.status === 'no' && before?.status !== 'no' && row.projectId && row.authorId && row.authorId !== me.id) {
      const inCrew = await d
        .select({ userId: projectCrew.userId })
        .from(projectCrew)
        .where(and(eq(projectCrew.projectId, row.projectId), eq(projectCrew.userId, me.id)))
        .limit(1)
      if (inCrew.length > 0) {
        try {
          const pref = (
            await d
              .select({ mentions: notificationPreferences.mentions })
              .from(notificationPreferences)
              .where(eq(notificationPreferences.userId, row.authorId))
              .limit(1)
          )[0]
          if (pref?.mentions !== 'off') {
            await sendPushToUsers(
              [row.authorId],
              crewDropoutPushMessage({ postId: row.postId, name: me.name, title: row.title ?? 'oppdraget' }),
              { ttl: PUSH_TTL.mention, urgency: 'high' },
            )
          }
        } catch (err) {
          // Svaret er lagret; et varsel som feiler skal ikke velte det.
          console.error('[kan du] kunne ikke varsle om frafall:', err)
        }
      }
    }
    return { ok: true }
  })

/** Stenger eller åpner svarene. Bare den ansvarlige. */
export const setCalloutClosed = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string().min(1), closed: z.boolean() }))
  .handler(async ({ data }) => {
    const { me, d, row } = await readableCallout(data.postId)
    if (!canManageCallout(me, { authorId: row.authorId, kind: row.kind })) throw new Error('Bare den ansvarlige kan stenge svarene')
    await d
      .update(postCallouts)
      .set({ closedAt: data.closed ? new Date() : null, updatedAt: new Date() })
      .where(eq(postCallouts.postId, row.postId))
    return { ok: true }
  })

/** Kommende oppdrag uten spørsmål, til valget i skriveflaten. */
export const listAskableGigs = createServerFn().handler(async () => {
  await requirePermission('projects.manage')
  const rows = await db()
    .select({
      id: projects.id,
      name: projects.name,
      eventDate: projects.eventDate,
      startTime: projects.startTime,
      venue: projects.venue,
    })
    .from(projects)
    .leftJoin(postCallouts, eq(postCallouts.projectId, projects.id))
    .where(and(eq(projects.kind, GIG_KIND), gte(projects.eventDate, toOsloDate(Date.now())), isNull(postCallouts.postId)))
    .orderBy(asc(projects.eventDate))
  return rows
})

