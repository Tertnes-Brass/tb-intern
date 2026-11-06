import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { forumReplies, forumTopics, postComments, posts, reactions, user } from '../db/schema'
import { canReadPost } from '../lib/posts'
import { MAX_REACTION_NAMES, type ReactionSummary, type ReactionTarget, summarizeReactions } from '../lib/reactions'
import { type Me, hasPermission } from './access'

/**
 * Reaksjonene, server-siden: hvem kan reagere på hva, oppsummeringen per side,
 * og opprydding. Vanlige eksporter — ingen serverfunksjoner — kalt fra
 * handlerne i posts.ts, forum.ts og reactions.ts. Ingen rutekomponent skal
 * importere denne fila (se AGENTS.md om levende eksporter og klientbygget).
 */

/**
 * Kan `me` reagere på (og dermed se reaksjonene på) dette? Samme regel som å
 * lese det: et publisert innlegg medlemmet kan lese (eller sitt eget), en
 * kommentar som ikke er slettet på et slikt innlegg, eller en forumtråd/-svar
 * som finnes og ikke er et «slettet»-merke. Utkast får ingen reaksjoner. «Finnes ikke» og «ikke for deg» er
 * det samme svaret, så en id ikke kan brukes til å bekrefte at et styreinnlegg
 * finnes.
 */
export async function canReactTo(kind: ReactionTarget, targetId: string, me: Me): Promise<boolean> {
  const d = db()
  const readable = (post: { audience: 'all' | 'board'; publishedAt: Date | null; authorId: string | null }) =>
    post.publishedAt !== null &&
    ((post.authorId !== null && post.authorId === me.id) ||
      canReadPost({ audience: post.audience, publishedAt: post.publishedAt.getTime() }, hasPermission(me, 'posts.publish')))
  switch (kind) {
    case 'post': {
      const post = await d
        .select({ audience: posts.audience, publishedAt: posts.publishedAt, authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, targetId))
        .get()
      return !!post && readable(post)
    }
    case 'post_comment': {
      const post = await d
        .select({ audience: posts.audience, publishedAt: posts.publishedAt, authorId: posts.authorId })
        .from(postComments)
        .innerJoin(posts, eq(postComments.postId, posts.id))
        .where(and(eq(postComments.id, targetId), isNull(postComments.deletedAt)))
        .get()
      return !!post && readable(post)
    }
    case 'forum_topic':
      return !!(await d.select({ id: forumTopics.id }).from(forumTopics).where(and(eq(forumTopics.id, targetId), isNull(forumTopics.deletedAt))).get())
    case 'forum_reply':
      return !!(await d.select({ id: forumReplies.id }).from(forumReplies).where(and(eq(forumReplies.id, targetId), isNull(forumReplies.deletedAt))).get())
  }
}

/**
 * Reaksjonene på en side med innlegg/kommentarer/svar, `id → oppsummering`.
 * Kalles bare ETTER at kalleren har sjekket at medlemmet kan lese dem.
 * `maxNames` er hvor mange navn hver emoji tar med (standard: de første ti).
 */
export async function reactionsFor(
  kind: ReactionTarget,
  targetIds: readonly string[],
  meId: string,
  maxNames: number = MAX_REACTION_NAMES,
): Promise<Map<string, ReactionSummary[]>> {
  const ids = [...new Set(targetIds)]
  const out = new Map<string, ReactionSummary[]>()
  if (ids.length === 0) return out
  const rows: Array<{ targetId: string; emoji: string; userId: string; userName: string | null; createdAt: Date }> = []
  // D1 tar maks 100 bundne parametre per spørring.
  for (let i = 0; i < ids.length; i += 90) {
    rows.push(
      ...(await db()
        .select({ targetId: reactions.targetId, emoji: reactions.emoji, userId: reactions.userId, userName: user.name, createdAt: reactions.createdAt })
        .from(reactions)
        .leftJoin(user, eq(user.id, reactions.userId))
        .where(and(eq(reactions.targetKind, kind), inArray(reactions.targetId, ids.slice(i, i + 90))))
        .orderBy(asc(reactions.createdAt))),
    )
  }
  const grouped = new Map<string, typeof rows>()
  for (const row of rows) grouped.set(row.targetId, [...(grouped.get(row.targetId) ?? []), row])
  for (const [id, list] of grouped) {
    out.set(id, summarizeReactions(list.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })), meId, maxNames))
  }
  return out
}

/** Reaksjonene på rader som er (eller blir) slettet. Kaster aldri — ryddingen tar resten. */
export async function deleteReactionsFor(kind: ReactionTarget, targetIds: readonly string[]): Promise<void> {
  const ids = [...new Set(targetIds)]
  try {
    for (let i = 0; i < ids.length; i += 90) {
      await db().delete(reactions).where(and(eq(reactions.targetKind, kind), inArray(reactions.targetId, ids.slice(i, i + 90))))
    }
  } catch (err) {
    console.error('[reaksjoner] kunne ikke rydde:', err)
  }
}

/**
 * Daglig rydding (cron): reaksjoner på noe som ikke finnes lenger — et slettet
 * innlegg tar kommentarene med seg via cascade, uten å gå innom koden her — og
 * på et «slettet»-merke. Én setning per slag; ingen R2, så ingen grense trengs.
 */
export async function sweepReactions(): Promise<void> {
  try {
    await db()
      .delete(reactions)
      .where(
        sql`(${reactions.targetKind} = 'post' and not exists (select 1 from posts p where p.id = ${reactions.targetId}))
          or (${reactions.targetKind} = 'post_comment' and not exists (select 1 from post_comments c where c.id = ${reactions.targetId} and c.deleted_at is null))
          or (${reactions.targetKind} = 'forum_topic' and not exists (select 1 from forum_topics t where t.id = ${reactions.targetId} and t.deleted_at is null))
          or (${reactions.targetKind} = 'forum_reply' and not exists (select 1 from forum_replies r where r.id = ${reactions.targetId} and r.deleted_at is null))`,
      )
  } catch (err) {
    console.error('[reaksjoner] daglig rydding feilet:', err)
  }
}
