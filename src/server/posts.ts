import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { memberProfiles, notificationLog, notificationPreferences, posts, rolePermissions, user } from '../db/schema'
import { newId } from '../lib/id'
import {
  type PostAudience,
  type PostImportance,
  type PostNotificationChoice,
  type PostRecipient,
  canReadPost,
  excerpt,
  recipientsFor,
} from '../lib/posts'
import { hasPermission, requireMe, requirePermission } from './access'
import { postEmail, sendEmail } from './email'

/**
 * Beskjeder (#28): informasjon fra styret til korpset, ett sted, med e-post til
 * dem som vil ha det.
 *
 * Lesing krever `requireMe()`; skriving og publisering krever `posts.publish`.
 * `audience: 'board'` og utkast filtreres ALLTID her på serveren — UI-et er
 * kosmetikk (docs/designprinsipper.md §4).
 */

const PUBLISH_PERMISSION = 'posts.publish'

/** Cloudflare Email Sending tar imot én melding om gangen; ~40 medlemmer i puljer på fem. */
const EMAIL_BATCH = 5
/** Loggrader skrives i litt større puljer — samme D1, men ingen nettverkskall. */
const LOG_BATCH = 20

const idInput = z.object({ id: z.string().min(1) })

const postInput = z.object({
  title: z.string().trim().min(1, 'Tittel er påkrevd').max(160, 'Tittelen er for lang'),
  body: z.string().trim().min(1, 'Teksten kan ikke være tom').max(20_000, 'Teksten er for lang'),
  audience: z.enum(['all', 'board']).default('all'),
  importance: z.enum(['normal', 'important']).default('normal'),
})

export type PostListItem = {
  id: string
  title: string
  excerpt: string
  audience: PostAudience
  importance: PostImportance
  authorName: string
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export type PostDetail = PostListItem & { body: string }

/** Hvem som faktisk har fått e-post om en beskjed — grunnlaget for «Send på nytt». */
export type PostDelivery = { sent: number; logged: number; failed: number; pending: number }

/** Resultatet av én sendingsrunde. `skipped` = mottakere som allerede stod i loggen. */
export type PostNotifyResult = { sent: number; logged: number; failed: number; skipped: number }

const AUTHOR_FALLBACK = 'Styret'

type Row = {
  id: string
  title: string
  body: string
  audience: PostAudience
  importance: PostImportance
  authorName: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function selectPosts() {
  return db()
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
      audience: posts.audience,
      importance: posts.importance,
      authorName: user.name,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .leftJoin(user, eq(posts.authorId, user.id))
}

function toDetail(row: Row): PostDetail {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    excerpt: excerpt(row.body),
    audience: row.audience,
    importance: row.importance,
    authorName: row.authorName ?? AUTHOR_FALLBACK,
    publishedAt: row.publishedAt ? row.publishedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function toListItem(row: Row): PostListItem {
  const { body: _body, ...item } = toDetail(row)
  return item
}

/** Leser én beskjed og avviser den leseren ikke har lov til å se. */
async function readablePost(id: string, canPublish: boolean): Promise<Row> {
  const row = (await selectPosts().where(eq(posts.id, id)).limit(1))[0]
  // Samme feilmelding for «finnes ikke» og «ikke for deg»: en beskjed til
  // styret skal ikke kunne bekreftes ved å prøve en id.
  if (!row || !canReadPost({ audience: row.audience, publishedAt: row.publishedAt?.getTime() ?? null }, canPublish)) {
    throw new Error('Fant ikke beskjeden')
  }
  return row
}

export const listPosts = createServerFn().handler(async () => {
  const me = await requireMe()
  const canPublish = hasPermission(me, PUBLISH_PERMISSION)
  const rows = await selectPosts().orderBy(desc(posts.publishedAt), desc(posts.createdAt))

  const visible = rows.filter((r) =>
    canReadPost({ audience: r.audience, publishedAt: r.publishedAt?.getTime() ?? null }, canPublish),
  )

  return {
    canPublish,
    posts: visible.filter((r) => r.publishedAt !== null).map(toListItem),
    // Utkast finnes bare for skrivere. De sorteres etter sist endret — det er
    // det man jobber med akkurat nå, ikke det som ble opprettet først.
    drafts: canPublish
      ? visible
          .filter((r) => r.publishedAt === null)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map(toListItem)
      : [],
  }
})

export const getPost = createServerFn()
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = await readablePost(data.id, canPublish)
    return {
      post: toDetail(row),
      canPublish,
      // Leveringsstatus er et skriveverktøy; medlemmer skal ikke se hvem som fikk e-post.
      delivery: canPublish && row.publishedAt ? await deliveryFor(row) : null,
    }
  })

export const createPost = createServerFn({ method: 'POST' })
  .validator(postInput)
  .handler(async ({ data }) => {
    const me = await requirePermission(PUBLISH_PERMISSION)
    const ts = new Date()
    const id = newId()
    await db()
      .insert(posts)
      .values({
        id,
        title: data.title,
        body: data.body,
        audience: data.audience,
        importance: data.importance,
        authorId: me.id,
        publishedAt: null,
        createdAt: ts,
        updatedAt: ts,
      })
    return { id }
  })

export const updatePost = createServerFn({ method: 'POST' })
  .validator(postInput.extend({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePermission(PUBLISH_PERMISSION)
    const existing = (await db().select({ id: posts.id }).from(posts).where(eq(posts.id, data.id)).limit(1))[0]
    if (!existing) throw new Error('Fant ikke beskjeden')
    await db()
      .update(posts)
      .set({
        title: data.title,
        body: data.body,
        audience: data.audience,
        importance: data.importance,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, data.id))
    return { ok: true }
  })

/**
 * Publiserer og (valgfritt) varsler. Allerede publiserte beskjeder beholder sin
 * opprinnelige `publishedAt` — en rettelse skal ikke flytte beskjeden til
 * toppen av feeden på nytt.
 */
export const publishPost = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), sendEmail: z.boolean().default(true) }))
  .handler(async ({ data }): Promise<PostNotifyResult & { ok: true }> => {
    await requirePermission(PUBLISH_PERMISSION)
    const row = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!row) throw new Error('Fant ikke beskjeden')

    if (!row.publishedAt) {
      const now = new Date()
      await db().update(posts).set({ publishedAt: now, updatedAt: now }).where(eq(posts.id, row.id))
      row.publishedAt = now
    }

    const result = data.sendEmail
      ? await notifyPost(row)
      : { sent: 0, logged: 0, failed: 0, skipped: 0 }
    return { ok: true, ...result }
  })

export const unpublishPost = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    await requirePermission(PUBLISH_PERMISSION)
    // `notification_log` beholdes med vilje: publiseres beskjeden igjen, skal
    // ingen få den samme e-posten to ganger.
    await db().update(posts).set({ publishedAt: null, updatedAt: new Date() }).where(eq(posts.id, data.id))
    return { ok: true }
  })

export const deletePost = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    await requirePermission(PUBLISH_PERMISSION)
    await db().delete(posts).where(eq(posts.id, data.id)) // notification_log via cascade
    return { ok: true }
  })

/** Idempotent «send på nytt»: går kun til dem som mangler en rad i loggen. */
export const resendPostNotifications = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }): Promise<PostNotifyResult & { ok: true }> => {
    await requirePermission(PUBLISH_PERMISSION)
    const row = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!row) throw new Error('Fant ikke beskjeden')
    if (!row.publishedAt) throw new Error('Beskjeden er ikke publisert ennå')
    return { ok: true, ...(await notifyPost(row)) }
  })

// ---------- E-postvarsling ----------

/**
 * Alle medlemmer med det varslingen trenger å vite: aktiv-status, e-post og om
 * rollen deres har `posts.publish` (avgjør `audience: 'board'`).
 */
async function candidates(): Promise<{ members: PostRecipient[]; prefs: Map<string, PostNotificationChoice> }> {
  const d = db()
  const [memberRows, permRows, prefRows] = await Promise.all([
    d
      .select({
        userId: memberProfiles.authUserId,
        roleId: memberProfiles.roleId,
        isActive: memberProfiles.isActive,
        email: user.email,
      })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .orderBy(asc(user.name)),
    d.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions),
    d.select({ userId: notificationPreferences.userId, posts: notificationPreferences.posts }).from(notificationPreferences),
  ])

  const publishingRoles = new Set(
    permRows.filter((p) => p.permission === '*' || p.permission === PUBLISH_PERMISSION).map((p) => p.roleId),
  )
  return {
    members: memberRows.map((m) => ({
      userId: m.userId,
      email: m.email,
      isActive: m.isActive,
      canPublish: publishingRoles.has(m.roleId),
    })),
    prefs: new Map(prefRows.map((p) => [p.userId, p.posts])),
  }
}

async function alreadyNotified(postId: string): Promise<Map<string, 'sent' | 'logged' | 'failed'>> {
  const rows = await db()
    .select({ userId: notificationLog.userId, outcome: notificationLog.outcome })
    .from(notificationLog)
    .where(eq(notificationLog.postId, postId))
  return new Map(rows.map((r) => [r.userId, r.outcome]))
}

/** Tellingen skriverne ser på detaljsiden: hvor mange har fått den, og hvor mange gjenstår. */
async function deliveryFor(row: Row): Promise<PostDelivery> {
  const [{ members, prefs }, log] = await Promise.all([candidates(), alreadyNotified(row.id)])
  const recipients = recipientsFor(row, members, prefs)
  const delivery: PostDelivery = { sent: 0, logged: 0, failed: 0, pending: 0 }
  for (const outcome of log.values()) delivery[outcome] += 1
  delivery.pending = recipients.filter((r) => !log.has(r.userId)).length
  return delivery
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Sender e-post om beskjeden til dem som skal ha den og ikke allerede har fått
 * den. Én mottaker som feiler stopper ikke resten: `sendEmail` degraderer selv,
 * og hver mottaker får uansett en rad i `notification_log` med sitt utfall —
 * det er den raden som gjør «send på nytt» idempotent.
 */
async function notifyPost(row: Row): Promise<PostNotifyResult> {
  const [{ members, prefs }, log] = await Promise.all([candidates(), alreadyNotified(row.id)])
  const recipients = recipientsFor(row, members, prefs)
  const pending = recipients.filter((r) => !log.has(r.userId))
  const result: PostNotifyResult = { sent: 0, logged: 0, failed: 0, skipped: recipients.length - pending.length }
  if (pending.length === 0) return result

  // URL-en bygges fra BETTER_AUTH_URL, aldri fra request-origin (AGENTS.md).
  const url = `${new URL(env.BETTER_AUTH_URL).origin}/beskjeder/${row.id}`
  const mail = postEmail({
    title: row.title,
    body: row.body,
    url,
    authorName: row.authorName ?? AUTHOR_FALLBACK,
    important: row.importance === 'important',
  })

  const outcomes: Array<{ userId: string; outcome: 'sent' | 'logged' | 'failed' }> = []
  for (const batch of chunk(pending, EMAIL_BATCH)) {
    const settled = await Promise.allSettled(
      batch.map((r) => sendEmail({ to: r.email!, subject: mail.subject, html: mail.html, text: mail.text })),
    )
    settled.forEach((res, i) => {
      const outcome =
        res.status !== 'fulfilled' ? 'failed' : res.value.ok ? 'sent' : res.value.fallback ? 'logged' : 'failed'
      result[outcome] += 1
      outcomes.push({ userId: batch[i]!.userId, outcome })
    })
  }

  const sentAt = new Date()
  for (const batch of chunk(outcomes, LOG_BATCH)) {
    await db()
      .insert(notificationLog)
      .values(batch.map((o) => ({ postId: row.id, userId: o.userId, sentAt, outcome: o.outcome })))
      .onConflictDoNothing()
  }
  return result
}
