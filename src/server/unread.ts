import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { boardTasks, posts, user } from '../db/schema'
import { postPlainText } from '../lib/markdown'
import { postHeading } from '../lib/posts'
import { unreadSince } from '../lib/unread'
import type { Me } from './access'

/**
 * Spørringene bak «ulest» (regelen er `isUnread` i src/lib/unread.ts).
 *
 * Bare hjelpefunksjoner, ingen server functions: modulen importeres fra
 * `hub.ts`, `shell.ts` og pushutsendingen — aldri fra en rutekomponent, siden
 * `db()` drar `cloudflare:workers` med seg.
 */

/** SQL-filteret «publisert i vinduet, ikke ditt, synlig for deg, ikke åpnet». */
function unreadWhere(me: Pick<Me, 'id' | 'permissions'>, now: number) {
  const canSeeBoardPosts = me.permissions.includes('*') || me.permissions.includes('posts.publish')
  return and(
    isNotNull(posts.publishedAt),
    gte(posts.publishedAt, new Date(unreadSince(now))),
    canSeeBoardPosts ? undefined : eq(posts.audience, 'all'),
    sql`(${posts.authorId} is null or ${posts.authorId} <> ${me.id})`,
    sql`not exists (select 1 from post_reads r where r.post_id = ${posts.id} and r.user_id = ${me.id})`,
  )
}

export async function unreadPostCount(me: Pick<Me, 'id' | 'permissions'>, now = Date.now()): Promise<number> {
  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(posts)
    .where(unreadWhere(me, now))
  return rows[0]?.n ?? 0
}

export type UnreadImportantPost = {
  id: string
  heading: string
  publishedAt: number
  official: boolean
  fromArchive: boolean
  authorName: string
}

/**
 * Den nyeste uleste «Viktig»-beskjeden, eller null. Det eneste som får lov til
 * å legge seg over «Neste» på Hjem (docs/designprinsipper.md §7 pkt 3).
 */
export async function latestUnreadImportant(me: Pick<Me, 'id' | 'permissions'>, now = Date.now()): Promise<UnreadImportantPost | null> {
  const row = (
    await db()
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        format: posts.format,
        official: posts.official,
        fromArchive: posts.fromArchive,
        publishedAt: posts.publishedAt,
        authorName: user.name,
      })
      .from(posts)
      .leftJoin(user, eq(posts.authorId, user.id))
      .where(and(unreadWhere(me, now), eq(posts.importance, 'important')))
      .orderBy(desc(posts.publishedAt))
      .limit(1)
  )[0]
  if (!row || !row.publishedAt) return null
  return {
    id: row.id,
    heading: postHeading({ title: row.title, body: postPlainText(row.body, row.format) }, 120),
    publishedAt: row.publishedAt.getTime(),
    official: row.official,
    fromArchive: row.fromArchive,
    authorName: row.fromArchive ? 'Notearkivar' : row.official ? 'Styret' : (row.authorName ?? 'Ukjent'),
  }
}

/**
 * Finnes det et svar i forumet fra noen andre, innenfor vinduet, som du ikke
 * har sett? Samme kvitteringer som `/forum` bruker (`forum_reply_reads`).
 */
export async function forumHasUnread(me: Pick<Me, 'id'>, now = Date.now()): Promise<boolean> {
  const since = unreadSince(now)
  const rows = await db().all<{ n: number }>(sql`
    select exists (
      select 1 from forum_replies r
      where r.created_at >= ${since}
        and (r.author_id is null or r.author_id <> ${me.id})
        and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = ${me.id})
    ) as n`)
  return Boolean(rows[0]?.n)
}

/** Åpne og forfalte styreoppgaver. Én spørring, to tall. */
export async function boardCounts(today: string): Promise<{ openTasks: number; overdue: number }> {
  const rows = await db()
    .select({
      openTasks: sql<number>`count(*)`,
      overdue: sql<number>`sum(case when ${boardTasks.dueDate} is not null and ${boardTasks.dueDate} < ${today} then 1 else 0 end)`,
    })
    .from(boardTasks)
    .where(sql`${boardTasks.status} <> 'done'`)
  return { openTasks: rows[0]?.openTasks ?? 0, overdue: rows[0]?.overdue ?? 0 }
}
