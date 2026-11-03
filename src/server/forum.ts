import { checkForumMentions, forumMembers, forumMentionNames } from './forum-mentions'
import { notifyForum } from './forum-notify'
import { FORUM_ALL, FORUM_ALL_MARKER } from '../lib/forum-mentions'
import { mentionMarker, mentionMatches, rankMentionCandidates } from '../lib/mentions'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { forumFollows as follows, forumTopics as topics, forumReplies as replies, forumReplyReads as reads, user } from '../db/schema'
import { canEditForumText, canModerateForum, followsForumTopic } from '../lib/forum'
import { requireMe, requirePermission } from './access'

const id = z.string().min(1).max(100)
const body = z.string().trim().min(1, 'Skriv en tekst.').max(20000)
const page = z.number().int().min(0).max(100000).default(0)
const topicInput = z.object({ title: z.string().trim().min(1).max(180), body })
const PAGE_SIZE = 30

export const listForum = createServerFn().validator(z.object({ page })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  const rows = await d.select({ id: topics.id, title: topics.title, locked: topics.locked,
      author: user.name, activityAt: topics.activityAt,
      unreadMentionCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
        and (r.author_id is null or r.author_id <> ${me.id})
        and (instr(r.body, ${mentionMarker(me.id)}) > 0 or instr(r.body, ${FORUM_ALL_MARKER}) > 0)
        and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${me.id}))`,
      unreadCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
        and (r.author_id is null or r.author_id <> ${me.id})
        and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${me.id}))`,
      replyCount: sql<number>`(select count(*) from forum_replies where topic_id = ${topics.id})`,
    }).from(topics).leftJoin(user, eq(user.id, topics.authorId))
      .orderBy(desc(topics.activityAt), desc(topics.id)).limit(PAGE_SIZE + 1).offset(data.page * PAGE_SIZE)
  return { topics: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, canModerate: canModerateForum(me.permissions) }
})

export const createForumTopic = createServerFn({ method: 'POST' }).validator(topicInput).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  await checkForumMentions(data.body)
  const topicId = crypto.randomUUID()
  const now = Date.now()
  await d.insert(topics).values({ ...data, id: topicId, authorId: me.id, createdAt: now, updatedAt: now, activityAt: now })
  await notifyForum({ topicId, topicTitle: data.title, replyId: null, authorId: me.id, authorName: me.name, body: data.body })
  return { id: topicId }
})

export const getForumTopic = createServerFn().validator(z.object({ id, page })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  const topic = await d.select({ topic: topics, author: user.name }).from(topics)
    .leftJoin(user, eq(user.id, topics.authorId)).where(eq(topics.id, data.id)).get()
  if (!topic) throw new Error('Emnet finnes ikke.')
  const rows = await d.select({ reply: replies, author: user.name,
    unread: sql<number>`(${replies.authorId} is null or ${replies.authorId} <> ${me.id}) and not exists
      (select 1 from forum_reply_reads rr where rr.reply_id = ${replies.id} and rr.user_id = ${me.id})`,
  }).from(replies).leftJoin(user, eq(user.id, replies.authorId))
    .where(eq(replies.topicId, data.id)).orderBy(desc(replies.createdAt), desc(replies.id)).limit(PAGE_SIZE + 1).offset(data.page * PAGE_SIZE)
  const mentions = await forumMentionNames([topic.topic.body, ...rows.slice(0, PAGE_SIZE).map((r) => r.reply.body)])
  const [follow, participated] = await Promise.all([
    d.select({ following: follows.following }).from(follows).where(and(eq(follows.topicId, data.id), eq(follows.userId, me.id))).get(),
    topic.topic.authorId === me.id ? true
      : d.select({ id: replies.id }).from(replies).where(and(eq(replies.topicId, data.id), eq(replies.authorId, me.id))).limit(1).get().then(Boolean),
  ])
  const following = followsForumTopic({ explicit: follow?.following ?? null, participated })
  return { ...topic, mentions, following, canEdit: canEditForumText(me, topic.topic.authorId, topic.topic.locked), canModerate: canModerateForum(me.permissions),
    replies: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, canEdit: canEditForumText(me, r.reply.authorId, topic.topic.locked) })), hasMore: rows.length > PAGE_SIZE }
})

export const replyToForum = createServerFn({ method: 'POST' }).validator(z.object({ topicId: id, body })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  await checkForumMentions(data.body)
  const replyId = crypto.randomUUID()
  const now = Date.now()
  // The INSERT itself checks the lock, so a concurrent moderator lock cannot be bypassed.
  const result = await d.run(sql`insert into forum_replies (id, topic_id, author_id, body, created_at, updated_at)
    select ${replyId}, id, ${me.id}, ${data.body}, ${now}, ${now} from forum_topics where id = ${data.topicId} and locked = 0`)
  if (!result.meta.changes) throw new Error('Emnet er låst eller finnes ikke.')
  const [topic] = await d.update(topics).set({ activityAt: sql`max(${topics.activityAt}, ${now})` }).where(eq(topics.id, data.topicId))
    .returning({ title: topics.title })
  await notifyForum({ topicId: data.topicId, topicTitle: topic?.title ?? '', replyId, authorId: me.id, authorName: me.name, body: data.body })
  return { page: 0 }
})

export const editForumText = createServerFn({ method: 'POST' }).validator(z.object({ id, kind: z.enum(['topic', 'reply']), body })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  await checkForumMentions(data.body)
  const moderator = canModerateForum(me.permissions)
  // Teksten før redigeringen: bare omtaler som er NYE skal varsles.
  const before = data.kind === 'topic'
    ? await d.select({ body: topics.body, topicId: topics.id, title: topics.title }).from(topics).where(eq(topics.id, data.id)).get()
    : await d.select({ body: replies.body, topicId: replies.topicId, title: topics.title }).from(replies)
      .innerJoin(topics, eq(topics.id, replies.topicId)).where(eq(replies.id, data.id)).get()
  if (data.kind === 'topic') {
    const result = await d.update(topics).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(topics.id, data.id),
      moderator ? undefined : and(eq(topics.authorId, me.id), eq(topics.locked, false)))).returning({ id: topics.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  } else {
    const result = await d.update(replies).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(replies.id, data.id),
      moderator ? undefined : and(eq(replies.authorId, me.id), sql`exists (select 1 from forum_topics where id = ${replies.topicId} and locked = 0)`))).returning({ id: replies.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  }
  if (before) await notifyForum({ topicId: before.topicId, topicTitle: before.title, replyId: null, authorId: me.id,
    authorName: me.name, body: data.body, previousBody: before.body })
})

/**
 * «Følg tråden» / «Slå av varsler». Raden er alltid eksplisitt, også når den
 * sier det samme som standarden — `updated_at` er da tidspunktet man begynte å
 * følge, som `notifyForum` måler «lest seg opp» fra.
 */
export const setForumFollow = createServerFn({ method: 'POST' }).validator(z.object({ topicId: id, following: z.boolean() })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  const topic = await d.select({ id: topics.id }).from(topics).where(eq(topics.id, data.topicId)).get()
  if (!topic) throw new Error('Emnet finnes ikke.')
  const now = Date.now()
  await d.insert(follows).values({ topicId: data.topicId, userId: me.id, following: data.following, updatedAt: now })
    .onConflictDoUpdate({ target: [follows.topicId, follows.userId], set: { following: data.following, updatedAt: now } })
  return { following: data.following }
})

export const setForumLock = createServerFn({ method: 'POST' }).validator(z.object({ id, locked: z.boolean() })).handler(async ({ data }) => {
  await requirePermission('forum.moderate')
  const result = await db().update(topics).set({ locked: data.locked }).where(eq(topics.id, data.id)).returning({ id: topics.id })
  if (!result.length) throw new Error('Emnet finnes ikke.')
})

/** Only the current member's receipts; GET/preloading never marks anything read. */
export const markForumRepliesRead = createServerFn({ method: 'POST' })
  .validator(z.object({ topicId: id, replyIds: z.array(id).min(1).max(PAGE_SIZE) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const existing = await d.select({ id: replies.id }).from(replies)
      .where(and(eq(replies.topicId, data.topicId), inArray(replies.id, data.replyIds)))
    if (existing.length) await d.insert(reads).values(existing.map((r) => ({ userId: me.id, replyId: r.id }))).onConflictDoNothing()
  })

export const searchForumMentions = createServerFn()
  .validator(z.object({ query: z.string().max(60) }))
  .handler(async ({ data }) => {
    await requireMe()
    const members = rankMentionCandidates(await forumMembers(), data.query, 8)
    return mentionMatches(FORUM_ALL.name, data.query) ? [FORUM_ALL, ...members] : members
  })
