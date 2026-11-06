import { checkForumMentions, forumMembers, forumMentionNames } from './forum-mentions'
import { notifyForum } from './forum-notify'
import { FORUM_ALL, FORUM_ALL_MARKER, forumPlainText } from '../lib/forum-mentions'
import { type ForumSort, FORUM_SORT_VALUES, effectiveForumSort, sortForumTopics } from '../lib/forum-search'
import { type SearchDoc, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, searchDocs } from '../lib/post-search'
import { mentionMarker, mentionMatches, rankMentionCandidates } from '../lib/mentions'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { forumFollows as follows, forumTopics as topics, forumReplies as replies, forumReplyReads as reads, user } from '../db/schema'
import { FORUM_TOPIC_GONE, canEditForumText, canModerateForum, followsForumTopic } from '../lib/forum'
import { replyPlacement } from '../lib/threads'
import { EMPTY_MESSAGE, MAX_MEDIA_PER_ITEM, hasMessageContent, mediaLabel } from '../lib/message-media'
import { requireMe, requirePermission } from './access'
import { claimMessageMedia, deleteMediaFor, hasMedia, mediaFor, releaseMessageMedia } from './message-media'
import { deleteReactionsFor, reactionsFor } from './reaction-store'

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
/** Samme tekst som raden viser når kontoen er slettet. */
const FORMER_MEMBER = 'Tidligere medlem'

/** Svarene i tråden, uten «slettet»-merkene. */
const liveReplyCount = sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id} and r.deleted_at is null)`

/**
 * Kolonnene i en trådrad — delt av lista og søket, så tallene alltid er de
 * samme. Et «slettet»-merke (`deleted_at`) er verken et svar eller ulest.
 */
function topicColumns(meId: string) {
  return {
    id: topics.id, title: topics.title, locked: topics.locked,
    author: user.name, activityAt: topics.activityAt, createdAt: topics.createdAt,
    /** Trådstarten er slettet (tittelen og svarene står). */
    deletedAt: topics.deletedAt,
    unreadMentionCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
      and r.deleted_at is null and (r.author_id is null or r.author_id <> ${meId})
      and (instr(r.body, ${mentionMarker(meId)}) > 0 or instr(r.body, ${FORUM_ALL_MARKER}) > 0)
      and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${meId}))`,
    unreadCount: sql<number>`(select count(*) from forum_replies r where r.topic_id = ${topics.id}
      and r.deleted_at is null and (r.author_id is null or r.author_id <> ${meId})
      and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${meId}))`,
    replyCount: liveReplyCount,
  }
}

/** Rekkefølgen i SQL — samme regel som `sortForumTopics` bruker på søketreffene. */
function topicOrder(sort: ForumSort) {
  const activity = [desc(topics.activityAt), desc(topics.id)]
  if (sort === 'nye') return [desc(topics.createdAt), ...activity]
  if (sort === 'aktive') return [desc(liveReplyCount), ...activity]
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
      // «Slettet»-merkene har verken tekst eller forfatter å finne.
      d.select({ id: replies.id, topicId: replies.topicId, body: replies.body, author: user.name })
        .from(replies).leftJoin(user, eq(user.id, replies.authorId)).where(isNull(replies.deletedAt))
        .orderBy(asc(replies.createdAt), asc(replies.id)),
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
      // En slettet trådstart har ingen forfatter; «Tidligere medlem» skal ikke gi treff.
      sender: t.deletedAt ? '' : t.author ?? FORMER_MEMBER,
      author: t.deletedAt ? '' : t.author ?? FORMER_MEMBER,
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
  if (!topic) throw new Error(FORUM_TOPIC_GONE)
  const located = data.svar ? await locateReply(data.id, data.svar) : null
  const pageNo = located?.page ?? data.page
  const columns = { reply: replies, author: user.name,
    unread: sql<number>`${replies.deletedAt} is null and (${replies.authorId} is null or ${replies.authorId} <> ${me.id}) and not exists
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
  const [follow, participated, counts] = await Promise.all([
    d.select({ following: follows.following }).from(follows).where(and(eq(follows.topicId, data.id), eq(follows.userId, me.id))).get(),
    topic.topic.authorId === me.id ? true
      : d.select({ id: replies.id }).from(replies).where(and(eq(replies.topicId, data.id), eq(replies.authorId, me.id))).limit(1).get().then(Boolean),
    d.select({ all: sql<number>`count(*)`, live: sql<number>`coalesce(sum(${replies.deletedAt} is null), 0)` })
      .from(replies).where(eq(replies.topicId, data.id)).get(),
  ])
  const following = followsForumTopic({ explicit: follow?.following ?? null, participated })
  // Et «slettet»-merke kan verken redigeres, slettes på nytt eller få svar.
  const view = (r: (typeof rows)[number]) => ({ ...r, deleted: r.reply.deletedAt !== null,
    canEdit: r.reply.deletedAt === null && canEditForumText(me, r.reply.authorId, topic.topic.locked) })
  const topicDeleted = topic.topic.deletedAt !== null
  const children = new Map<string, ReturnType<typeof view>[]>()
  for (const r of childRows) children.set(r.reply.parentId!, [...(children.get(r.reply.parentId!) ?? []), view(r)])
  return { ...topic, mentions, following,
    /** Bildene i tråden og i svarene på siden, `id → bilder` (tråd-id og svar-id-er er UUID-er og kolliderer ikke). */
    media: Object.fromEntries([...topicMedia, ...replyMedia]),
    /** Emoji-reaksjonene, `id → oppsummering` (samme nøkler som `media`). */
    reactions: Object.fromEntries([...topicReactions, ...replyReactions]),
    deleted: topicDeleted,
    /** Svarene i hele tråden, uten merkene — til bekreftelsen før en moderator sletter alt. */
    replyCount: counts?.live ?? 0,
    /** Står det svar (eller merker) i tråden? Da blir en slettet trådstart et merke, ikke borte. */
    hasReplies: (counts?.all ?? 0) > 0,
    canEdit: !topicDeleted && canEditForumText(me, topic.topic.authorId, topic.topic.locked), canModerate: canModerateForum(me.permissions),
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
      ? await d.select({ id: replies.id, parentId: replies.parentId, authorId: replies.authorId, deletedAt: replies.deletedAt }).from(replies)
        .where(and(eq(replies.id, data.replyToId), eq(replies.topicId, data.topicId))).get()
      : null
    if (data.replyToId && !target) throw new Error('Svaret du svarer på finnes ikke i denne tråden.')
    if (target?.deletedAt) throw new Error('Svaret du svarer på er slettet.')
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
    const result = await d.update(topics).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(topics.id, data.id), isNull(topics.deletedAt),
      moderator ? undefined : and(eq(topics.authorId, me.id), eq(topics.locked, false)))).returning({ id: topics.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  } else {
    const result = await d.update(replies).set({ body: data.body, updatedAt: Date.now() }).where(and(eq(replies.id, data.id), isNull(replies.deletedAt),
      moderator ? undefined : and(eq(replies.authorId, me.id), sql`exists (select 1 from forum_topics where id = ${replies.topicId} and locked = 0)`))).returning({ id: replies.id })
    if (!result.length) throw new Error('Du kan ikke redigere denne teksten.')
  }
  if (before) await notifyForum({ topicId: before.topicId, topicTitle: before.title, replyId: data.kind === 'reply' ? data.id : null, authorId: me.id,
    authorName: me.name, body: data.body, previousBody: before.body })
})

/** Ingen andre svar peker på dette — verken som rot (`parent_id`) eller som svar (`reply_to_id`). */
const unreferenced = (replyId: string) =>
  sql`not exists (select 1 from forum_replies c where c.parent_id = ${replyId} or c.reply_to_id = ${replyId})`

/**
 * Rydder «slettet»-merker som ikke lenger holder noe sammen, oppover fra et
 * svar som ble slettet helt (svaret det svarte på → roten) — og til slutt
 * trådstarten, når den er et merke og tråden står uten svar. Et merke kan bli
 * fritt først når et ANNET merke er ryddet, så en id kan dukke opp i køen
 * igjen; løkken ender likevel, for noe legges bare i køen når en rad faktisk
 * ble slettet, og hver rad kan slettes én gang. Sant når tråden er borte.
 *
 * Merkene har allerede mistet bildene og reaksjonene sine, og lesekvitteringene
 * og følgerne går via cascade.
 */
async function sweepForumMarkers(topicId: string, start: Array<string | null>): Promise<boolean> {
  const d = db()
  const queue = start.filter((x): x is string => !!x)
  while (queue.length) {
    const replyId = queue.shift()!
    const marker = await d.select({ parentId: replies.parentId, replyToId: replies.replyToId }).from(replies)
      .where(and(eq(replies.id, replyId), isNotNull(replies.deletedAt))).get()
    if (!marker) continue
    const gone = await d.run(sql`delete from forum_replies where id = ${replyId} and deleted_at is not null and ${unreferenced(replyId)}`)
    if (gone.meta.changes) queue.push(...[marker.parentId, marker.replyToId].filter((x): x is string => !!x))
  }
  const topicGone = await d.run(sql`delete from forum_topics where id = ${topicId} and deleted_at is not null
    and not exists (select 1 from forum_replies where topic_id = ${topicId})`)
  return topicGone.meta.changes > 0
}

/**
 * Sletter et svar eller en trådstart. Samme regel som å redigere
 * (`canEditForumText`): egen tekst så lenge tråden er åpen, alt for en
 * moderator.
 *
 * - **Svar:** har noen svart på det, blir det et «slettet»-merke — teksten,
 *   forfatteren, bildene og reaksjonene fjernes, men raden står, så svarene
 *   under beholder sammenhengen (som kommentarene på veggen). Ellers forsvinner
 *   det helt, og merker som dermed ikke holder noe sammen lenger, ryddes med.
 * - **Trådstart:** uten svar forsvinner hele tråden. Med svar blir trådstarten
 *   et merke: tittelen står, for svarene trenger en sammenheng (som på Reddit),
 *   men teksten og forfatteren forsvinner. Å fjerne hele samtalen, også andres
 *   svar, er moderatorens `deleteForumThread`.
 *
 * Valget mellom «helt» og «merke» er ÉN `DELETE … WHERE NOT EXISTS`: kommer et
 * svar inn samtidig, blir det et merke i stedet for at svaret mister tråden sin.
 * Svaret sier hva som skjedde; `thread` betyr at tråden er borte.
 */
export const deleteForumText = createServerFn({ method: 'POST' }).validator(z.object({ id, kind: z.enum(['topic', 'reply']) })).handler(async ({ data }) => {
  const me = await requireMe()
  const d = db()
  const now = Date.now()
  if (data.kind === 'topic') {
    const topic = await d.select({ id: topics.id, authorId: topics.authorId, locked: topics.locked }).from(topics)
      .where(and(eq(topics.id, data.id), isNull(topics.deletedAt))).get()
    if (!topic) throw new Error('Fant ikke tråden.')
    if (!canEditForumText(me, topic.authorId, topic.locked)) throw new Error('Du kan bare slette det du selv har skrevet.')
    const removed = await d.run(sql`delete from forum_topics where id = ${topic.id}
      and not exists (select 1 from forum_replies where topic_id = ${topic.id})`)
    if (!removed.meta.changes) {
      await d.update(topics).set({ body: '', authorId: null, deletedAt: now, updatedAt: now }).where(eq(topics.id, topic.id))
    }
    // Et merke har verken bilder eller reaksjoner, akkurat som det ikke har tekst.
    await deleteMediaFor('forum_topic', [topic.id])
    await deleteReactionsFor('forum_topic', [topic.id])
    return { removed: removed.meta.changes ? 'thread' as const : 'marker' as const }
  }
  const reply = await d.select({ id: replies.id, topicId: replies.topicId, authorId: replies.authorId, parentId: replies.parentId,
    replyToId: replies.replyToId, locked: topics.locked })
    .from(replies).innerJoin(topics, eq(topics.id, replies.topicId))
    .where(and(eq(replies.id, data.id), isNull(replies.deletedAt))).get()
  if (!reply) throw new Error('Fant ikke svaret.')
  if (!canEditForumText(me, reply.authorId, reply.locked)) throw new Error('Du kan bare slette det du selv har skrevet.')
  const removed = await d.run(sql`delete from forum_replies where id = ${reply.id} and ${unreferenced(reply.id)}`)
  if (!removed.meta.changes) {
    await d.update(replies).set({ body: '', authorId: null, deletedAt: now, updatedAt: now }).where(eq(replies.id, reply.id))
  }
  await deleteMediaFor('forum_reply', [reply.id])
  await deleteReactionsFor('forum_reply', [reply.id])
  if (!removed.meta.changes) return { removed: 'marker' as const }
  return { removed: (await sweepForumMarkers(reply.topicId, [reply.replyToId, reply.parentId])) ? 'thread' as const : 'reply' as const }
})

/**
 * Moderatorens «Slett hele tråden»: trådstarten og ALLE svarene, også andres.
 * Svarene, lesekvitteringene og følgerne går via cascade; bildene og
 * reaksjonene ryddes her (og av den daglige cron-en hvis noe glipper).
 */
export const deleteForumThread = createServerFn({ method: 'POST' }).validator(z.object({ id })).handler(async ({ data }) => {
  await requirePermission('forum.moderate')
  const d = db()
  const replyIds = (await d.select({ id: replies.id }).from(replies).where(eq(replies.topicId, data.id))).map((r) => r.id)
  const removed = await d.delete(topics).where(eq(topics.id, data.id)).returning({ id: topics.id })
  if (!removed.length) throw new Error('Fant ikke tråden.')
  await deleteMediaFor('forum_topic', [data.id])
  await deleteMediaFor('forum_reply', replyIds)
  await deleteReactionsFor('forum_topic', [data.id])
  await deleteReactionsFor('forum_reply', replyIds)
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
