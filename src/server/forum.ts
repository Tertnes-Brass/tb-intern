import { checkForumMentions, forumMembers, forumMentionNames } from './forum-mentions'
import { FORUM_ALL, FORUM_ALL_MARKER } from '../lib/forum-mentions'
import { mentionMarker, mentionMatches, rankMentionCandidates } from '../lib/mentions'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { forumTopics as topics, forumReplies as replies, forumReplyReads as reads, user } from '../db/schema'
import { canEditForumText, canModerateForum } from '../lib/forum'
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
  return { ...topic, mentions, canEdit: canEditForumText(me, topic.topic.authorId, topic.topic.locked), canModerate: canModerateForum(me.permissions),
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
  await d.update(topics).set({ activityAt: sql`max(${topics.activityAt}, ${now})` }).where(eq(topics.id, data.topicId))
  return { page: 0 }
})

export const editForumText = createServerFn({ method: 'POST' }).validator(z.object({ id, kind: z.enum(['topic', 'reply']), body })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  await checkForumMentions(data.body)
  const moderator = canModerateForum(me.permissions)
  if (data.kind === 'topic') {
    const result = await d.update(topics).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(topics.id, data.id),
      moderator ? undefined : and(eq(topics.authorId, me.id), eq(topics.locked, false)))).returning({ id: topics.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  } else {
    const result = await d.update(replies).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(replies.id, data.id),
      moderator ? undefined : and(eq(replies.authorId, me.id), sql`exists (select 1 from forum_topics where id = ${replies.topicId} and locked = 0)`))).returning({ id: replies.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  }
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
