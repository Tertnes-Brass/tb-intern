import { checkForumMentions, forumMembers, forumMentionNames } from './forum-mentions'
import { notifyForum } from './forum-notify'
import { FORUM_ALL, FORUM_ALL_MARKER } from '../lib/forum-mentions'
import { mentionMarker, mentionMatches, rankMentionCandidates } from '../lib/mentions'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { forumFollows as follows, forumTopics as topics, forumReplies as replies, forumReplyReads as reads, user } from '../db/schema'
import { canEditForumText, canModerateForum, followsForumTopic } from '../lib/forum'
import { replyPlacement } from '../lib/threads'
import { EMPTY_MESSAGE, MAX_MEDIA_PER_ITEM, hasMessageContent, mediaLabel } from '../lib/message-media'
import { requireMe, requirePermission } from './access'
import { claimMessageMedia, hasMedia, mediaFor, releaseMessageMedia } from './message-media'
import { reactionsFor } from './reaction-store'

const id = z.string().min(1).max(100)
// Teksten kan være tom når innlegget har et bilde eller en GIF (`hasMessageContent`).
const body = z.string().trim().max(20000)
/** Bildene som er lastet opp til innlegget, i rekkefølge. Serveren kobler dem (`claimMessageMedia`). */
const mediaIds = z.array(id).max(MAX_MEDIA_PER_ITEM).default([])
const page = z.number().int().min(0).max(100000).default(0)
/** Tekst eller bilde — en valideringsfeil (400), ikke en serverfeil. */
const withContent = <T extends { body: string; mediaIds: string[] }>(data: T) => hasMessageContent(data.body, data.mediaIds)
const contentError = { message: EMPTY_MESSAGE, path: ['body'] }
const topicInput = z.object({ title: z.string().trim().min(1).max(180), body, mediaIds }).refine(withContent, contentError)
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
  // Bildene kobles FØR raden skrives: koblingen er en compare-and-set, så to
  // innsendinger av samme utkast aldri gir to tråder med de samme bildene.
  await claimMessageMedia({ ids: data.mediaIds, ownerId: me.id, kind: 'forum_topic', targetId: topicId })
  try {
    await d.insert(topics).values({ title: data.title, body: data.body, id: topicId, authorId: me.id, createdAt: now, updatedAt: now, activityAt: now })
  } catch (err) {
    await releaseMessageMedia(topicId)
    throw err
  }
  await notifyForum({ topicId, topicTitle: data.title, replyId: null, authorId: me.id, authorName: me.name, body: data.body })
  return { id: topicId }
})

/**
 * Hvilken side står svaret på, og under hvilket svar? Sidene telles i svar
 * rett på tråden (røtter), nyeste først — et svar på et svar står alltid på
 * samme side som roten sin. Null når svaret ikke finnes i denne tråden.
 */
async function locateReply(topicId: string, replyId: string): Promise<{ page: number; rootId: string } | null> {
  const d = db()
  const target = await d.select({ id: replies.id, parentId: replies.parentId }).from(replies)
    .where(and(eq(replies.id, replyId), eq(replies.topicId, topicId))).get()
  if (!target) return null
  const root = await d.select({ id: replies.id, createdAt: replies.createdAt }).from(replies)
    .where(and(eq(replies.id, target.parentId ?? target.id), eq(replies.topicId, topicId))).get()
  if (!root) return null
  const newer = await d.select({ n: sql<number>`count(*)` }).from(replies).where(and(eq(replies.topicId, topicId), isNull(replies.parentId),
    sql`(${replies.createdAt} > ${root.createdAt} or (${replies.createdAt} = ${root.createdAt} and ${replies.id} > ${root.id}))`)).get()
  return { page: Math.floor((newer?.n ?? 0) / PAGE_SIZE), rootId: root.id }
}

/**
 * Tråden med én side svar. `svar` er et bestemt svar (fra et varsel eller etter
 * at man selv har svart): da er det den siden som returneres, uansett `page`,
 * og `focus` sier hvilket svar skjermen skal rulle til. En `svar` som ikke
 * finnes i tråden ignoreres stille — lenken kan være gammel.
 */
export const getForumTopic = createServerFn().validator(z.object({ id, page, svar: id.optional() })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  const topic = await d.select({ topic: topics, author: user.name }).from(topics)
    .leftJoin(user, eq(user.id, topics.authorId)).where(eq(topics.id, data.id)).get()
  if (!topic) throw new Error('Emnet finnes ikke.')
  const located = data.svar ? await locateReply(data.id, data.svar) : null
  const pageNo = located?.page ?? data.page
  const columns = { reply: replies, author: user.name,
    unread: sql<number>`(${replies.authorId} is null or ${replies.authorId} <> ${me.id}) and not exists
      (select 1 from forum_reply_reads rr where rr.reply_id = ${replies.id} and rr.user_id = ${me.id})`,
  }
  const rows = await d.select(columns).from(replies).leftJoin(user, eq(user.id, replies.authorId))
    .where(and(eq(replies.topicId, data.id), isNull(replies.parentId)))
    .orderBy(desc(replies.createdAt), desc(replies.id)).limit(PAGE_SIZE + 1).offset(pageNo * PAGE_SIZE)
  const roots = rows.slice(0, PAGE_SIZE)
  // Alle svarene under røttene på siden, eldst først. Ingen egen paginering:
  // en undertråd foldes på skjermen (`foldChildren`), ikke over flere sider.
  const childRows = roots.length ? await d.select(columns).from(replies).leftJoin(user, eq(user.id, replies.authorId))
    .where(and(eq(replies.topicId, data.id), inArray(replies.parentId, roots.map((r) => r.reply.id))))
    .orderBy(asc(replies.createdAt), asc(replies.id)) : []
  const mentions = await forumMentionNames([topic.topic.body, ...roots.map((r) => r.reply.body), ...childRows.map((r) => r.reply.body)])
  const replyIds = [...roots, ...childRows].map((r) => r.reply.id)
  const [topicMedia, replyMedia, topicReactions, replyReactions] = await Promise.all([
    mediaFor('forum_topic', [topic.topic.id]),
    mediaFor('forum_reply', replyIds),
    reactionsFor('forum_topic', [topic.topic.id], me.id),
    reactionsFor('forum_reply', replyIds, me.id),
  ])
  const [follow, participated] = await Promise.all([
    d.select({ following: follows.following }).from(follows).where(and(eq(follows.topicId, data.id), eq(follows.userId, me.id))).get(),
    topic.topic.authorId === me.id ? true
      : d.select({ id: replies.id }).from(replies).where(and(eq(replies.topicId, data.id), eq(replies.authorId, me.id))).limit(1).get().then(Boolean),
  ])
  const following = followsForumTopic({ explicit: follow?.following ?? null, participated })
  const view = (r: (typeof rows)[number]) => ({ ...r, canEdit: canEditForumText(me, r.reply.authorId, topic.topic.locked) })
  const children = new Map<string, ReturnType<typeof view>[]>()
  for (const r of childRows) children.set(r.reply.parentId!, [...(children.get(r.reply.parentId!) ?? []), view(r)])
  return { ...topic, mentions, following,
    /** Bildene i tråden og i svarene på siden, `id → bilder` (tråd-id og svar-id-er er UUID-er og kolliderer ikke). */
    media: Object.fromEntries([...topicMedia, ...replyMedia]),
    /** Emoji-reaksjonene, `id → oppsummering` (samme nøkler som `media`). */
    reactions: Object.fromEntries([...topicReactions, ...replyReactions]), canEdit: canEditForumText(me, topic.topic.authorId, topic.topic.locked), canModerate: canModerateForum(me.permissions),
    page: pageNo, focus: located ? data.svar! : null,
    replies: roots.map((r) => ({ ...view(r), children: children.get(r.reply.id) ?? [] })), hasMore: rows.length > PAGE_SIZE }
})

/**
 * Nytt svar. Uten `replyToId` er det et svar rett på tråden; med, et svar på et
 * annet svar — da avgjør `replyPlacement` hvor det står (alltid under en rot,
 * aldri dypere), og klienten kan ikke velge `parentId` selv. Svaret må høre til
 * SAMME tråd, ellers kunne et rått kall hengt et svar inn i en annen samtale.
 * Svaret er `{ id, page }`: siden det nye svaret står på.
 */
export const replyToForum = createServerFn({ method: 'POST' })
  .validator(z.object({ topicId: id, body, replyToId: id.nullish(), mediaIds }).refine(withContent, contentError))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    await checkForumMentions(data.body)
    const target = data.replyToId
      ? await d.select({ id: replies.id, parentId: replies.parentId, authorId: replies.authorId }).from(replies)
        .where(and(eq(replies.id, data.replyToId), eq(replies.topicId, data.topicId))).get()
      : null
    if (data.replyToId && !target) throw new Error('Svaret du svarer på finnes ikke i denne tråden.')
    const placement = target ? replyPlacement(target) : { parentId: null, replyToId: null }
    const replyId = crypto.randomUUID()
    const now = Date.now()
    const media = await claimMessageMedia({ ids: data.mediaIds, ownerId: me.id, kind: 'forum_reply', targetId: replyId })
    // The INSERT itself checks the lock, so a concurrent moderator lock cannot be bypassed.
    const result = await d.run(sql`insert into forum_replies (id, topic_id, author_id, body, parent_id, reply_to_id, created_at, updated_at)
      select ${replyId}, id, ${me.id}, ${data.body}, ${placement.parentId}, ${placement.replyToId}, ${now}, ${now}
      from forum_topics where id = ${data.topicId} and locked = 0`).catch(async (err: unknown) => {
      await releaseMessageMedia(replyId)
      throw err
    })
    if (!result.meta.changes) {
      // Bildene blir utkast igjen, så de kan sendes et annet sted (eller ryddes).
      await releaseMessageMedia(replyId)
      throw new Error('Emnet er låst eller finnes ikke.')
    }
    const [topic] = await d.update(topics).set({ activityAt: sql`max(${topics.activityAt}, ${now})` }).where(eq(topics.id, data.topicId))
      .returning({ title: topics.title })
    await notifyForum({ topicId: data.topicId, topicTitle: topic?.title ?? '', replyId, repliedTo: target?.authorId ?? null,
      authorId: me.id, authorName: me.name, body: data.body, mediaLabel: mediaLabel(media) })
    return { id: replyId, page: (await locateReply(data.topicId, replyId))?.page ?? 0 }
  })

export const editForumText = createServerFn({ method: 'POST' }).validator(z.object({ id, kind: z.enum(['topic', 'reply']), body })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  // Bildene redigeres ikke her; teksten kan bare bli tom når det står et bilde igjen.
  if (!data.body && !(await hasMedia(data.kind === 'topic' ? 'forum_topic' : 'forum_reply', data.id))) throw new Error('Skriv en tekst.')
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
  if (before) await notifyForum({ topicId: before.topicId, topicTitle: before.title, replyId: data.kind === 'reply' ? data.id : null, authorId: me.id,
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
