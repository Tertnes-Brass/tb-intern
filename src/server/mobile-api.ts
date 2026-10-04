import { and, eq, inArray } from 'drizzle-orm'
import { isRedirect } from '@tanstack/react-router'
import { z } from 'zod'
import { db } from '../db'
import { eventAttendance } from '../db/schema'
import { ATTENDANCE_STATUSES } from '../lib/attendance'
import { postPlainText } from '../lib/markdown'
import { mentionPlainText } from '../lib/mentions'
import { isOccurrenceKey } from '../lib/occurrence'
import { checkMobileRequest, MobileError, mobileBody, mobileFailure, mobileJSON } from '../lib/mobile-http'
import { currentUser } from './access'
import { loadCalendar } from './calendar-feed'
import { setMyAttendance } from './event-meta'
import { addComment, createPost, getPost, listPosts, publishPost, toggleReaction, type PostListItem } from './posts'
import { getHome } from './projects'
import { memberScreen } from './mobile-member-screens'
import { boardScreen } from './mobile-board-screens'
import { otherScreen } from './mobile-other-screens'
import { runMobileAction } from './mobile-actions'
import { mobileMentions, mentionQuery } from './mobile-mentions'
import { mobileChoices, choiceQuery } from './mobile-choices'

const textInput = z.object({ body: z.string().trim().min(1).max(20_000) }).strict()
const responseInput = z.object({ status: z.enum(ATTENDANCE_STATUSES).nullable() }).strict()

function mobilePost(post: PostListItem) {
  return {
    id: post.id, author: post.fromArchive ? `Notearkivar · ${post.author.name}` : post.author.name, official: post.official, fromArchive: post.fromArchive,
    heading: post.heading, body: post.excerpt,
    date: post.publishedAt ?? post.createdAt,
    likes: post.likeCount, liked: post.likedByMe, commentCount: post.commentCount,
    imagePaths: post.images.map((image) => `/api/post-images/${encodeURIComponent(image.id)}`),
  }
}

/** Called only by a server route, never exported to a browser bundle.
 * Reuses the existing authenticated operations/validators rather than copying
 * their authorization rules or exposing TanStack's deployment-specific RPC URLs.
 */
export async function handleMobileAPI(request: Request, path: string): Promise<Response> {
  try {
    checkMobileRequest(request)
    const me = await currentUser()
    if (!me) throw new MobileError(401, 'session_required', 'Økten er utløpt, eller medlemskapet er ikke aktivt.')
    const segments = path.split('/').filter(Boolean)

    if (path === 'workspace' && request.method === 'GET') {
      const query = new URL(request.url).searchParams
      const screenPath = (query.get('screen') ?? 'more').split('/').filter(Boolean)
      const screen = await memberScreen(screenPath, me, query)
        ?? await boardScreen(screenPath, me, query)
        ?? await otherScreen(screenPath, me, query)
      if (!screen) throw new MobileError(404, 'not_found', 'Siden finnes ikke.')
      return mobileJSON(screen)
    }
    if (path === 'workspace/action' && request.method === 'POST') {
      const input = await mobileBody(request, z.object({
        operation: z.string().min(1).max(100), values: z.record(z.string(), z.unknown()),
        mentions: z.array(z.object({ id:z.string().max(128), name:z.string().max(200) }).strict()).max(10).optional(),
      }).strict())
      return mobileJSON(await runMobileAction(input.operation, input.values, input.mentions))
    }
    if (path === 'workspace/choices' && request.method === 'POST') {
      return mobileJSON(await mobileChoices(await mobileBody(request, choiceQuery)))
    }
    if (path === 'workspace/mentions' && request.method === 'POST') {
      return mobileJSON(await mobileMentions(await mobileBody(request, mentionQuery)))
    }

    if (request.method === 'GET' && path === 'snapshot') {
      const [calendar, wall, music] = await Promise.all([loadCalendar(Date.now()), listPosts(), getHome()])
      const visibleEvents = calendar.events.filter((event) => Date.parse(event.end ?? event.start) >= Date.now())
      const keys = visibleEvents.map((event) => event.occurrenceKey)
      const responses = keys.length ? await db().select({ key: eventAttendance.occurrenceKey, status: eventAttendance.status })
        .from(eventAttendance).where(and(eq(eventAttendance.userId, me.id), inArray(eventAttendance.occurrenceKey, keys))) : []
      const attendance = Object.fromEntries(responses.map((row) => [row.key, row.status]))
      return mobileJSON({
        version: 1,
        member: { id: me.id, name: me.name, email: me.email, role: me.roleName, canSwitchEnvironment: me.permissions.includes('*'), parts: me.parts.map((part) => part.nameNo) },
        calendarAvailable: calendar.configured && !calendar.error,
        events: visibleEvents.map((event) => ({
          id: event.occurrenceKey, title: event.title, date: Date.parse(event.start),
          allDay: event.allDay, location: event.location ?? '', description: event.description ?? '',
          attendance: attendance[event.occurrenceKey] ?? null,
        })),
        posts: wall.posts.map(mobilePost),
        projectName: music.nextProject?.name ?? null,
        scores: music.repertoire.flatMap((work) => [
          ...work.partFiles.map((file) => ({ id: file.id, title: work.title, subtitle: work.composer ?? '', part: file.partName ?? 'Stemme', pageCount: file.pageCount, path: `/api/files/${encodeURIComponent(file.id)}` })),
          ...(work.scoreFileId ? [{ id: work.scoreFileId, title: work.title, subtitle: work.composer ?? '', part: 'Partitur', pageCount: null, path: `/api/files/${encodeURIComponent(work.scoreFileId)}` }] : []),
        ]),
      })
    }

    if (segments[0] === 'events' && segments.length === 3 && segments[2] === 'attendance' && request.method === 'PUT') {
      const key = segments[1]!
      if (!isOccurrenceKey(key)) throw new MobileError(400, 'invalid_input', 'Ugyldig aktivitet.')
      const { status } = await mobileBody(request, responseInput)
      const calendar = await loadCalendar(Date.now())
      if (!calendar.configured || calendar.error) throw new MobileError(503, 'calendar_unavailable', 'Kalenderen er midlertidig utilgjengelig.')
      if (!calendar.events.some((event) => event.occurrenceKey === key)) throw new MobileError(404, 'not_found', 'Aktiviteten er ikke tilgjengelig.')
      await setMyAttendance({ data: { occurrenceKey: key, status } })
      return mobileJSON({ ok: true, status })
    }

    if (path === 'posts' && request.method === 'POST') {
      const data = await mobileBody(request, textInput)
      // A separate publish request lets the client retain/retry the same draft.
      return mobileJSON(await createPost({ data: { body: data.body, format: 'plain_text', audience: 'all', importance: 'normal', official: false } }), 201)
    }
    if (segments[0] === 'posts' && segments[1]) {
      const id = segments[1]
      if (segments.length === 2 && request.method === 'GET') {
        const result = await getPost({ data: { id } })
        return mobileJSON({
          post: { ...mobilePost(result.post), body: mentionPlainText(postPlainText(result.post.body, result.post.format), result.post.mentions), ...(result.post.format === 'markdown' ? { markdown: mentionPlainText(result.post.body, result.post.mentions) } : {}) },
          comments: result.comments.map((comment) => ({ id: comment.id, author: comment.author.name, body: mentionPlainText(comment.body, comment.mentions), date: comment.createdAt })),
        })
      }
      if (segments.length === 3 && request.method === 'POST') {
        if (segments[2] === 'like') {
          await mobileBody(request, z.object({}).strict())
          return mobileJSON(await toggleReaction({ data: { postId: id } }))
        }
        if (segments[2] === 'publish') {
          await mobileBody(request, z.object({}).strict())
          await publishPost({ data: { id, sendEmail: false } })
          return mobileJSON({ ok: true })
        }
        if (segments[2] === 'comments') {
          const data = await mobileBody(request, z.object({ body: z.string().trim().min(1).max(4000) }).strict())
          await addComment({ data: { postId: id, body: data.body } })
          return mobileJSON({ ok: true }, 201)
        }
      }
    }
    throw new MobileError(404, 'not_found', 'Ukjent API-endepunkt.')
  } catch (error) {
    if (isRedirect(error)) return mobileFailure(new MobileError(401, 'session_required', 'Logg inn på nytt.'))
    return mobileFailure(error)
  }
}
