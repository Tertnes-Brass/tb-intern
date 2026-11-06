import { checkForumMentions, forumMembers, forumMentionNames } from './forum-mentions'
import { notifyForum } from './forum-notify'
import { FORUM_ALL, FORUM_ALL_MARKER, forumPlainText } from '../lib/forum-mentions'
import { type ForumSort, FORUM_SORT_VALUES, effectiveForumSort, sortForumTopics } from '../lib/forum-search'
import { type SearchDoc, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, searchDocs } from '../lib/post-search'
import { mentionMarker, mentionMatches, rankMentionCandidates } from '../lib/mentions'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { forumFollows as follows, forumTopics as topics, forumReplies as replies, forumReplyReads as reads, user } from '../db/schema'
import { canEditForumText, canModerateForum, followsForumTopic } from '../lib/forum'
import { replyPlacement } from '../lib/threads'
import { requireMe, requirePermission } from './access'

const id = z.string().min(1).max(100)
const body = z.string().trim().min(1, 'Skriv en tekst.').max(20000)
const page = z.number().int().min(0).max(100000).default(0)
const topicInput = z.object({ title: z.string().trim().min(1).max(180), body })
const PAGE_SIZE = 30
/** Samme tekst som raden viser når kontoen er slettet. */
const FORMER_MEMBER = 'Tidligere medlem'

/** Kolonnene i en trådrad — delt av lista og søket, så tallene alltid er de samme. */
function topicColumns(meId: string) {
  return {
    id: topics.id, title: topics.title, locked: topics.locked,
    author: user.name, activityAt: topics.activityAt, createdAt: topics.createdAt,
    unreadMentionCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
      and (r.author_id is null or r.author_id <> ${meId})
      and (instr(r.body, ${mentionMarker(meId)}) > 0 or instr(r.body, ${FORUM_ALL_MARKER}) > 0)
      and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${meId}))`,
    unreadCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
      and (r.author_id is null or r.author_id <> ${meId})
      and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${meId}))`,
    replyCount: sql<number>`(select count(*) from forum_replies where topic_id = ${topics.id})`,
  }
}

/** Rekkefølgen i SQL — samme regel som `sortForumTopics` bruker på søketreffene. */
function topicOrder(sort: ForumSort) {
  const activity = [desc(topics.activityAt), desc(topics.id)]
  if (sort === 'nye') return [desc(topics.createdAt), ...activity]
  if (sort === 'aktive') return [desc(sql`(select count(*) from forum_replies where topic_id = ${topics.id})`), ...activity]
  return activity
}

export const listForum = createServerFn()
  .validator(z.object({ page, sort: z.enum(FORUM_SORT_VALUES).optional() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const rows = await db().select(topicColumns(me.id)).from(topics).leftJoin(user, eq(user.id, topics.authorId))
      .orderBy(...topicOrder(effectiveForumSort(data.sort, false))).limit(PAGE_SIZE + 1).offset(data.page * PAGE_SIZE)
    return { topics: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, canModerate: canModerateForum(me.permissions) }
  })

/** Flere treff enn dette er ikke et søk, men en liste — da hjelper et ord til mer enn å bla. */
const SEARCH_LIMIT = 100

/**
 * Søk i forumet: tittel, trådstarten, hvem som startet den og alle svarene —
 * som ren tekst med dagens navn i omtalene (`forumPlainText`), så markører
 * verken treffer eller vises. Alle medlemmer leser hele forumet, så det finnes
 * ingen målgruppe å filtrere på (motsatt veggens `searchPosts`).
 *
 * Rangeringen og utdraget er de samme som på veggen (`searchDocs`). Står
 * treffet i et svar, har treffet svarets id, så raden kan lenke rett dit
 * (`?svar=`). Maks `SEARCH_LIMIT` treff, de beste; deretter sortering.
 */
export const searchForum = createServerFn()
  .validator(z.object({ q: z.string().trim().min(SEARCH_MIN_LENGTH).max(SEARCH_MAX_LENGTH), sort: z.enum(FORUM_SORT_VALUES).optional() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    // Hele forumet, uten `inArray` over id-er (D1 tillater maks 100 parametere).
    const [rows, bodies, replyRows, people] = await Promise.all([
      d.select(topicColumns(me.id)).from(topics).leftJoin(user, eq(user.id, topics.authorId)),
      d.select({ id: topics.id, body: topics.body }).from(topics),
      d.select({ id: replies.id, topicId: replies.topicId, body: replies.body, author: user.name })
        .from(replies).leftJoin(user, eq(user.id, replies.authorId)).orderBy(asc(replies.createdAt), asc(replies.id)),
      // Navnene til omtalene; brukes bare til å gjøre markører om til «@Navn».
      d.select({ id: user.id, name: user.name }).from(user),
    ])
    const bodyOf = new Map(bodies.map((b) => [b.id, b.body]))
    const repliesOf = new Map<string, SearchDoc['comments']>()
    for (const r of replyRows) {
      const list = repliesOf.get(r.topicId) ?? []
      list.push({ id: r.id, author: r.author ?? FORMER_MEMBER, text: forumPlainText(r.body, people) })
      repliesOf.set(r.topicId, list)
    }
    const docs: SearchDoc[] = rows.map((t) => ({
      id: t.id,
      title: t.title,
      body: forumPlainText(bodyOf.get(t.id) ?? '', people),
      // Raden viser ingen tekst fra innlegget — et treff der får alltid et utdrag.
      excerpt: '',
      sender: t.author ?? FORMER_MEMBER,
      author: t.author ?? FORMER_MEMBER,
      comments: repliesOf.get(t.id) ?? [],
      publishedAt: t.activityAt,
    }))
    const ranked = searchDocs(docs, data.q)
    const byId = new Map(rows.map((t) => [t.id, t]))
    const results = ranked.slice(0, SEARCH_LIMIT).flatMap((r) => {
      const topic = byId.get(r.id)
      return topic ? [{ ...topic, hit: r.hit }] : []
    })
    return {
      query: data.q,
      topics: sortForumTopics(results, effectiveForumSort(data.sort, true)),
      total: ranked.length,
      limited: ranked.length > SEARCH_LIMIT,
    }
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
  const [follow, participated] = await Promise.all([
    d.select({ following: follows.following }).from(follows).where(and(eq(follows.topicId, data.id), eq(follows.userId, me.id))).get(),
    topic.topic.authorId === me.id ? true
      : d.select({ id: replies.id }).from(replies).where(and(eq(replies.topicId, data.id), eq(replies.authorId, me.id))).limit(1).get().then(Boolean),
  ])
  const following = followsForumTopic({ explicit: follow?.following ?? null, participated })
  const view = (r: (typeof rows)[number]) => ({ ...r, canEdit: canEditForumText(me, r.reply.authorId, topic.topic.locked) })
  const children = new Map<string, ReturnType<typeof view>[]>()
  for (const r of childRows) children.set(r.reply.parentId!, [...(children.get(r.reply.parentId!) ?? []), view(r)])
  return { ...topic, mentions, following, canEdit: canEditForumText(me, topic.topic.authorId, topic.topic.locked), canModerate: canModerateForum(me.permissions),
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
  .validator(z.object({ topicId: id, body, replyToId: id.nullish() }))
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
    // The INSERT itself checks the lock, so a concurrent moderator lock cannot be bypassed.
    const result = await d.run(sql`insert into forum_replies (id, topic_id, author_id, body, parent_id, reply_to_id, created_at, updated_at)
      select ${replyId}, id, ${me.id}, ${data.body}, ${placement.parentId}, ${placement.replyToId}, ${now}, ${now}
      from forum_topics where id = ${data.topicId} and locked = 0`)
    if (!result.meta.changes) throw new Error('Emnet er låst eller finnes ikke.')
    const [topic] = await d.update(topics).set({ activityAt: sql`max(${topics.activityAt}, ${now})` }).where(eq(topics.id, data.topicId))
      .returning({ title: topics.title })
    await notifyForum({ topicId: data.topicId, topicTitle: topic?.title ?? '', replyId, repliedTo: target?.authorId ?? null,
      authorId: me.id, authorName: me.name, body: data.body })
    return { id: replyId, page: (await locateReply(data.topicId, replyId))?.page ?? 0 }
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
