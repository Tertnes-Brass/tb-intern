import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  memberProfiles,
  notificationLog,
  notificationPreferences,
  postComments,
  postImages,
  postReactions,
  posts,
  rolePermissions,
  user,
} from '../db/schema'
import { newId } from '../lib/id'
import {
  type PostAudience,
  type PostImportance,
  type PostNotificationChoice,
  type PostRecipient,
  canDeleteComment,
  canEditPost,
  canReadPost,
  excerpt,
  postHeading,
  recipientsFor,
  sanitizePostInput,
} from '../lib/posts'
import { type Me, hasPermission, requireMe, requirePermission } from './access'
import { canAttachImages } from './post-images'
import { postEmail, sendEmail } from './email'

/**
 * Beskjeder (#28) — veggen. Alle innloggede kan skrive, kommentere og like;
 * `posts.publish` gir «Fra styret», «Viktig», styre-målgruppen, e-postvarsling
 * og moderasjon av andres innlegg.
 *
 * Lesing krever `requireMe()`. Utkast og `audience: 'board'` filtreres ALLTID
 * her på serveren — UI-et er kosmetikk (docs/designprinsipper.md §4). Samme
 * regel gjentas i bilderuten `/api/post-images/$imageId`, som er den eneste
 * veien til bytene (docs/tilgangsstyring.md).
 */

const PUBLISH_PERMISSION = 'posts.publish'

/** Cloudflare Email Sending tar imot én melding om gangen; ~40 medlemmer i puljer på fem. */
const EMAIL_BATCH = 5
/** Loggrader skrives i litt større puljer — samme D1, men ingen nettverkskall. */
const LOG_BATCH = 20
/** Miniatyrer i feeden. Resten telles som «+N». */
const FEED_IMAGES = 3

const idInput = z.object({ id: z.string().min(1) })

const postInput = z.object({
  title: z.string().trim().max(160, 'Tittelen er for lang').nullish(),
  body: z.string().trim().min(1, 'Teksten kan ikke være tom').max(20_000, 'Teksten er for lang'),
  audience: z.enum(['all', 'board']).default('all'),
  importance: z.enum(['normal', 'important']).default('normal'),
  official: z.boolean().default(false),
})

export type PostAuthor = { id: string | null; name: string }

export type PostImage = {
  id: string
  fileName: string
  width: number | null
  height: number | null
}

export type PostListItem = {
  id: string
  /** Tittel når den finnes, ellers første linje av teksten. */
  heading: string
  title: string | null
  excerpt: string
  audience: PostAudience
  importance: PostImportance
  official: boolean
  author: PostAuthor
  publishedAt: number | null
  createdAt: number
  updatedAt: number
  commentCount: number
  likeCount: number
  likedByMe: boolean
  /** De første bildene, til miniatyrrutenettet. */
  images: PostImage[]
  imageCount: number
  canEdit: boolean
}

export type PostComment = {
  id: string
  body: string
  author: PostAuthor
  createdAt: number
  canDelete: boolean
}

export type PostDetail = Omit<PostListItem, 'images'> & { body: string; images: PostImage[] }

/** Hvem som faktisk har fått e-post om en beskjed — grunnlaget for «Send på nytt». */
export type PostDelivery = { sent: number; logged: number; failed: number; pending: number }

/** Resultatet av én sendingsrunde. `skipped` = mottakere som allerede stod i loggen. */
export type PostNotifyResult = { sent: number; logged: number; failed: number; skipped: number }

/** Forfatteren kan være slettet. «Fra styret» står da for korpset, ellers er den ukjent. */
const OFFICIAL_AUTHOR = 'Styret'
const UNKNOWN_AUTHOR = 'Ukjent'

type Row = {
  id: string
  title: string | null
  body: string
  audience: PostAudience
  importance: PostImportance
  official: boolean
  authorId: string | null
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
      official: posts.official,
      authorId: posts.authorId,
      authorName: user.name,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .leftJoin(user, eq(posts.authorId, user.id))
}

/**
 * Ditt eget innlegg er alltid synlig for deg — også som utkast. Uten dette
 * ville et halvferdig innlegg (f.eks. hvis bildeopplastingen feilet) blitt
 * usynlig for den som skrev det, uten vei til å fullføre eller slette det.
 */
function visibleTo(row: Row, canPublish: boolean, me?: Me): boolean {
  if (me && row.authorId !== null && row.authorId === me.id) return true
  return canReadPost({ audience: row.audience, publishedAt: row.publishedAt?.getTime() ?? null }, canPublish)
}

function authorOf(row: { authorId: string | null; authorName: string | null; official: boolean }): PostAuthor {
  return { id: row.authorId, name: row.authorName ?? (row.official ? OFFICIAL_AUTHOR : UNKNOWN_AUTHOR) }
}

/** Leser ett innlegg og avviser det leseren ikke har lov til å se. */
async function readablePost(id: string, canPublish: boolean, me?: Me): Promise<Row> {
  const row = (await selectPosts().where(eq(posts.id, id)).limit(1))[0]
  // Samme feilmelding for «finnes ikke» og «ikke for deg»: et innlegg til
  // styret skal ikke kunne bekreftes ved å prøve en id.
  if (!row || !visibleTo(row, canPublish, me)) throw new Error('Fant ikke beskjeden')
  return row
}

/** Kommentartall, likes og bilder for en håndfull innlegg — tre små spørringer. */
async function decorate(
  rows: Row[],
  me: Me,
): Promise<{
  comments: Map<string, number>
  likes: Map<string, number>
  mine: Set<string>
  images: Map<string, PostImage[]>
}> {
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) {
    return { comments: new Map(), likes: new Map(), mine: new Set(), images: new Map() }
  }
  const d = db()
  const [commentRows, reactionRows, imageRows] = await Promise.all([
    d
      .select({ postId: postComments.postId, n: sql<number>`count(*)` })
      .from(postComments)
      .where(inArray(postComments.postId, ids))
      .groupBy(postComments.postId),
    d
      .select({ postId: postReactions.postId, userId: postReactions.userId })
      .from(postReactions)
      .where(inArray(postReactions.postId, ids)),
    d
      .select({
        id: postImages.id,
        postId: postImages.postId,
        fileName: postImages.fileName,
        width: postImages.width,
        height: postImages.height,
      })
      .from(postImages)
      .where(inArray(postImages.postId, ids))
      .orderBy(asc(postImages.sortOrder), asc(postImages.createdAt)),
  ])

  const likes = new Map<string, number>()
  const mine = new Set<string>()
  for (const r of reactionRows) {
    likes.set(r.postId, (likes.get(r.postId) ?? 0) + 1)
    if (r.userId === me.id) mine.add(r.postId)
  }
  const images = new Map<string, PostImage[]>()
  for (const img of imageRows) {
    const list = images.get(img.postId) ?? []
    list.push({ id: img.id, fileName: img.fileName, width: img.width, height: img.height })
    images.set(img.postId, list)
  }
  return { comments: new Map(commentRows.map((r) => [r.postId, r.n])), likes, mine, images }
}

function toListItem(
  row: Row,
  me: Me,
  canPublish: boolean,
  extra: Awaited<ReturnType<typeof decorate>>,
  imageLimit: number,
): PostListItem {
  const all = extra.images.get(row.id) ?? []
  return {
    id: row.id,
    heading: postHeading(row),
    title: row.title,
    excerpt: excerpt(row.body),
    audience: row.audience,
    importance: row.importance,
    official: row.official,
    author: authorOf(row),
    publishedAt: row.publishedAt ? row.publishedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    commentCount: extra.comments.get(row.id) ?? 0,
    likeCount: extra.likes.get(row.id) ?? 0,
    likedByMe: extra.mine.has(row.id),
    images: all.slice(0, imageLimit),
    imageCount: all.length,
    canEdit: canEditPost(me, row, canPublish),
  }
}

export const listPosts = createServerFn().handler(async () => {
  const me = await requireMe()
  const canPublish = hasPermission(me, PUBLISH_PERMISSION)
  const rows = await selectPosts().orderBy(desc(posts.publishedAt), desc(posts.createdAt))
  const visible = rows.filter((r) => visibleTo(r, canPublish, me))
  const extra = await decorate(visible, me)

  return {
    canPublish,
    meId: me.id,
    posts: visible
      .filter((r) => r.publishedAt !== null)
      .map((r) => toListItem(r, me, canPublish, extra, FEED_IMAGES)),
    // Utkast: skrivernes egne halvferdige beskjeder, og for et vanlig medlem
    // deres eget innlegg hvis noe stoppet opp underveis. Sist endret først.
    drafts: visible
      .filter((r) => r.publishedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((r) => toListItem(r, me, canPublish, extra, FEED_IMAGES)),
  }
})

export const getPost = createServerFn()
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = await readablePost(data.id, canPublish, me)
    const [extra, commentRows] = await Promise.all([
      decorate([row], me),
      db()
        .select({
          id: postComments.id,
          body: postComments.body,
          authorId: postComments.authorId,
          authorName: user.name,
          createdAt: postComments.createdAt,
        })
        .from(postComments)
        .leftJoin(user, eq(postComments.authorId, user.id))
        .where(eq(postComments.postId, row.id))
        .orderBy(asc(postComments.createdAt)),
    ])

    const item = toListItem(row, me, canPublish, extra, Number.MAX_SAFE_INTEGER)
    const detail: PostDetail = { ...item, body: row.body }

    return {
      post: detail,
      canPublish,
      meId: me.id,
      comments: commentRows.map(
        (c): PostComment => ({
          id: c.id,
          body: c.body,
          author: { id: c.authorId, name: c.authorName ?? 'Ukjent' },
          createdAt: c.createdAt.getTime(),
          canDelete: canDeleteComment(me, c, canPublish),
        }),
      ),
      // Leveringsstatus er et skriveverktøy; medlemmer skal ikke se hvem som fikk e-post.
      delivery: canPublish && row.publishedAt ? await deliveryFor(row) : null,
    }
  })

/**
 * Oppretter innlegget som utkast. Klienten laster opp eventuelle bilder mot
 * id-en og kaller `publishPost` etterpå — slik blir et innlegg aldri synlig
 * halvferdig, og bilder blir aldri foreldreløse.
 */
export const createPost = createServerFn({ method: 'POST' })
  .validator(postInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const safe = sanitizePostInput({ ...data, title: data.title ?? null }, canPublish)
    const ts = new Date()
    const id = newId()
    await db()
      .insert(posts)
      .values({
        id,
        title: safe.title,
        body: safe.body,
        audience: safe.audience,
        importance: safe.importance,
        official: safe.official,
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
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const existing = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!existing || !visibleTo(existing, canPublish, me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, existing, canPublish)) throw new Error('Du kan bare endre dine egne innlegg')

    const safe = sanitizePostInput({ ...data, title: data.title ?? null }, canPublish)
    // Uten `posts.publish` endres kun tittel og tekst: et innlegg en moderator
    // har merket «Fra styret» skal ikke miste merket fordi eieren retter en skrivefeil.
    await db()
      .update(posts)
      .set(
        canPublish
          ? {
              title: safe.title,
              body: safe.body,
              audience: safe.audience,
              importance: safe.importance,
              official: safe.official,
              updatedAt: new Date(),
            }
          : { title: safe.title, body: safe.body, updatedAt: new Date() },
      )
      .where(eq(posts.id, data.id))
    return { ok: true }
  })

/**
 * Publiserer og (valgfritt) varsler. Eieren kan publisere sitt eget innlegg;
 * e-post krever `posts.publish`. Allerede publiserte innlegg beholder sin
 * opprinnelige `publishedAt` — en rettelse skal ikke flytte innlegget til
 * toppen av veggen på nytt.
 */
export const publishPost = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), sendEmail: z.boolean().default(false) }))
  .handler(async ({ data }): Promise<PostNotifyResult & { ok: true }> => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!row || !visibleTo(row, canPublish, me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, row, canPublish)) throw new Error('Du kan bare publisere dine egne innlegg')

    if (!row.publishedAt) {
      const now = new Date()
      await db().update(posts).set({ publishedAt: now, updatedAt: now }).where(eq(posts.id, row.id))
      row.publishedAt = now
    }

    // E-post er styrets verktøy. Ber en vanlig skribent om det, ignoreres det.
    const notify = data.sendEmail && canPublish
    const result = notify ? await notifyPost(row) : { sent: 0, logged: 0, failed: 0, skipped: 0 }
    return { ok: true, ...result }
  })

export const unpublishPost = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!row || !visibleTo(row, canPublish, me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, row, canPublish)) throw new Error('Du kan bare endre dine egne innlegg')
    // `notification_log` beholdes med vilje: publiseres innlegget igjen, skal
    // ingen få den samme e-posten to ganger.
    await db().update(posts).set({ publishedAt: null, updatedAt: new Date() }).where(eq(posts.id, data.id))
    return { ok: true }
  })

export const deletePost = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = (await selectPosts().where(eq(posts.id, data.id)).limit(1))[0]
    if (!row || !visibleTo(row, canPublish, me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, row, canPublish)) throw new Error('Du kan bare slette dine egne innlegg')

    // R2 først: databaseraden er den eneste veien tilbake til nøkkelen, så
    // klarer vi ikke å slette bytene, skal raden bli stående.
    const images = await db().select({ r2Key: postImages.r2Key }).from(postImages).where(eq(postImages.postId, data.id))
    await Promise.all(images.map((img) => env.FILES.delete(img.r2Key)))
    await db().delete(posts).where(eq(posts.id, data.id)) // kommentarer/likes/bilder via cascade
    return { ok: true }
  })

// ---------- Kommentarer ----------

export const addComment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      postId: z.string().min(1),
      body: z.string().trim().min(1, 'Skriv noe først').max(4_000, 'Kommentaren er for lang'),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = await readablePost(data.postId, canPublish, me)
    if (!row.publishedAt) throw new Error('Utkast kan ikke kommenteres')
    const ts = new Date()
    const id = newId()
    await db()
      .insert(postComments)
      .values({ id, postId: row.id, authorId: me.id, body: data.body, createdAt: ts, updatedAt: ts })
    // TODO(varsling): svar på eget innlegg bør kunne gi e-post/varsel senere.
    return { id }
  })

export const deleteComment = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const comment = (
      await db()
        .select({ id: postComments.id, postId: postComments.postId, authorId: postComments.authorId })
        .from(postComments)
        .where(eq(postComments.id, data.id))
        .limit(1)
    )[0]
    if (!comment) throw new Error('Fant ikke kommentaren')
    // Innlegget må være synlig for deg før du kan gjøre noe med tråden.
    await readablePost(comment.postId, canPublish, me)
    if (!canDeleteComment(me, comment, canPublish)) throw new Error('Du kan bare slette dine egne kommentarer')
    await db().delete(postComments).where(eq(postComments.id, data.id))
    return { ok: true }
  })

// ---------- Reaksjoner ----------

export const toggleReaction = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = await readablePost(data.postId, canPublish)
    const d = db()
    const existing = (
      await d
        .select({ postId: postReactions.postId })
        .from(postReactions)
        .where(and(eq(postReactions.postId, row.id), eq(postReactions.userId, me.id)))
        .limit(1)
    )[0]
    if (existing) {
      await d.delete(postReactions).where(and(eq(postReactions.postId, row.id), eq(postReactions.userId, me.id)))
    } else {
      await d
        .insert(postReactions)
        .values({ postId: row.id, userId: me.id, kind: 'like', createdAt: new Date() })
        .onConflictDoNothing()
    }
    const count = await d
      .select({ n: sql<number>`count(*)` })
      .from(postReactions)
      .where(eq(postReactions.postId, row.id))
    return { mine: !existing, count: count[0]?.n ?? 0 }
  })

// ---------- Bilder ----------

export const deletePostImage = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const image = (
      await db()
        .select({ id: postImages.id, postId: postImages.postId, r2Key: postImages.r2Key })
        .from(postImages)
        .where(eq(postImages.id, data.id))
        .limit(1)
    )[0]
    if (!image) throw new Error('Fant ikke bildet')
    if (!(await canAttachImages(image.postId, me))) throw new Error('Du kan bare endre dine egne innlegg')
    await env.FILES.delete(image.r2Key)
    await db().delete(postImages).where(eq(postImages.id, data.id))
    return { ok: true }
  })

// ---------- E-postvarsling ----------

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
    d
      .select({ userId: notificationPreferences.userId, posts: notificationPreferences.posts })
      .from(notificationPreferences),
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
 * Sender e-post om innlegget til dem som skal ha det og ikke allerede har fått
 * det. Én mottaker som feiler stopper ikke resten: `sendEmail` degraderer selv,
 * og hver mottaker får uansett en rad i `notification_log` med sitt utfall —
 * det er den raden som gjør «send på nytt» idempotent.
 */
async function notifyPost(row: Row): Promise<PostNotifyResult> {
  const [{ members, prefs }, log, imageCount] = await Promise.all([
    candidates(),
    alreadyNotified(row.id),
    db()
      .select({ n: sql<number>`count(*)` })
      .from(postImages)
      .where(eq(postImages.postId, row.id))
      .then((rows) => rows[0]?.n ?? 0),
  ])
  const recipients = recipientsFor(row, members, prefs)
  const pending = recipients.filter((r) => !log.has(r.userId))
  const result: PostNotifyResult = { sent: 0, logged: 0, failed: 0, skipped: recipients.length - pending.length }
  if (pending.length === 0) return result

  // URL-en bygges fra BETTER_AUTH_URL, aldri fra request-origin (AGENTS.md).
  const url = `${new URL(env.BETTER_AUTH_URL).origin}/beskjeder/${row.id}`
  const mail = postEmail({
    title: postHeading(row, 160),
    body: row.body,
    url,
    authorName: row.authorName ?? OFFICIAL_AUTHOR,
    important: row.importance === 'important',
    official: row.official,
    imageCount,
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
