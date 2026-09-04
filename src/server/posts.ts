import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  notificationLog,
  notificationPreferences,
  postCommentMentions,
  postComments,
  postImages,
  postMentions,
  postReactions,
  postSeen,
  postTargets,
  posts,
  user,
} from '../db/schema'
import { newId } from '../lib/id'
import { postPlainText } from '../lib/markdown'
import {
  type MentionCandidate,
  type MentionNotificationChoice,
  type MentionUser,
  mentionPlainText,
  mentionRecipients,
  mentionRejection,
  mentionableForAudience,
  mentionableMembers,
  parseMentions,
  postMentionRecipients,
  rankMentionCandidates,
} from '../lib/mentions'
import {
  type PostAudience,
  type PostFormat,
  type PostImportance,
  type PostNotificationChoice,
  type PostReader,
  type PostRecipient,
  type PostTarget,
  canDeleteComment,
  canEditPost,
  canReadPost,
  canSeeSeenNames,
  canSeeSeenStatus,
  excerpt,
  postAudienceMembers,
  postHeading,
  recipientsFor,
  sanitizePostInput,
  sanitizePostTargets,
  seenLabel,
  targetLabel,
} from '../lib/posts'
import { type Me, hasPermission, requireMe, requirePermission } from './access'
import {
  assertValidTargets,
  memberDirectory,
  postReaderFor,
  postTargetsFor,
  targetLabels,
  targetOptions,
} from './post-audience'
import { canAttachImages } from './post-images'
import { mentionEmail, postEmail, postMentionEmail, sendEmail } from './email'

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

/**
 * ÉN feilmelding for alle avslag på en omtale — «finnes ikke», «er deaktivert»
 * og «kan ikke lese dette innlegget» skal ikke kunne skilles fra hverandre.
 * Ellers ville et rått kall med gjettede id-er blitt et oppslagsverk over
 * skjulte medlemmer. Samme tekst i kommentarer og innlegg.
 */
const MENTION_DENIED = 'Du kan bare omtale aktive medlemmer som har tilgang til innlegget'

/** Cloudflare Email Sending tar imot én melding om gangen; ~40 medlemmer i puljer på fem. */
const EMAIL_BATCH = 5
/** Loggrader skrives i litt større puljer — samme D1, men ingen nettverkskall. */
const LOG_BATCH = 20
/** Miniatyrer i feeden. Resten telles som «+N». */
const FEED_IMAGES = 3

const idInput = z.object({ id: z.string().min(1) })

/**
 * Målrettingen slik klienten sender den. Validert mot hva som FINNES i
 * `assertValidTargets`, og mot hva avsenderen har lov til i `sanitizePostTargets`
 * — zod sier bare at formen er en form.
 */
const targetInput = z.array(z.object({ kind: z.enum(['section', 'project']), refId: z.string().min(1).max(64) })).default([])

const postInput = z.object({
  title: z.string().trim().max(160, 'Tittelen er for lang').nullish(),
  body: z.string().trim().min(1, 'Teksten kan ikke være tom').max(20_000, 'Teksten er for lang'),
  // #79: hvordan teksten skal tolkes. Standarden er formatet alle innlegg hadde
  // før, slik at et gammelt klientkall uten feltet oppfører seg som i dag.
  format: z.enum(['plain_text', 'markdown']).default('plain_text'),
  audience: z.enum(['all', 'board']).default('all'),
  // Målretting (#28): en INNSNEVRING oppå `audience`. Tom liste = som før.
  targets: targetInput,
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
  /** Tittel når den finnes, ellers første linje av teksten (uten markdown-støy). */
  heading: string
  title: string | null
  /** Alltid ren tekst — markdown strippes før utdraget lages. */
  excerpt: string
  format: PostFormat
  audience: PostAudience
  /** Stemmegruppene/prosjektene beskjeden er snevret inn til. Tom = hele målgruppen. */
  targets: PostTarget[]
  /** «Slagverk og Julekonserten» — ferdig oversatt, så klienten aldri slår opp en id. */
  targetLabel: string
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
  /**
   * Dagens navn på de omtalte i teksten, slått opp server-side. Utdraget over
   * har allerede fått navnene inn; denne lista er for rendringen av `body` på
   * detaljsiden (og for redigeringsskjemaet, som må vise `@Navn`).
   */
  mentions: MentionUser[]
}

export type PostComment = {
  id: string
  /** Rå tekst med omtale-markører (`@[u:…]`). Rendres av `renderCommentHtml`. */
  body: string
  author: PostAuthor
  createdAt: number
  canDelete: boolean
  /**
   * Dagens navn på de omtalte, slått opp server-side (#83). En markør uten
   * treff her er en slettet bruker og vises som «Ukjent medlem» — aldri som et
   * gammelt navn og aldri som markørtekst.
   */
  mentions: MentionUser[]
}

export type PostDetail = Omit<PostListItem, 'images'> & { body: string; images: PostImage[] }

/** Hvem som faktisk har fått e-post om en beskjed — grunnlaget for «Send på nytt». */
export type PostDelivery = { sent: number; logged: number; failed: number; pending: number }

/**
 * «Sett av N av M» (#28). `names` er kun satt for VIKTIGE beskjeder, og kun for
 * forfatteren og `posts.publish` — for alle andre er hele feltet `null`, ikke en
 * tom liste: klienten skal ikke kunne skille «ingen har sett den» fra «du får
 * ikke se hvem».
 */
export type PostSeenStatus = {
  seen: number
  total: number
  label: string
  names: { seen: string[]; pending: string[] } | null
}

/** Resultatet av én sendingsrunde. `skipped` = mottakere som allerede stod i loggen. */
export type PostNotifyResult = { sent: number; logged: number; failed: number; skipped: number }

/** Forfatteren kan være slettet. «Fra styret» står da for korpset, ellers er den ukjent. */
const OFFICIAL_AUTHOR = 'Styret'
const UNKNOWN_AUTHOR = 'Ukjent'

type Row = {
  id: string
  title: string | null
  body: string
  format: PostFormat
  audience: PostAudience
  importance: PostImportance
  official: boolean
  authorId: string | null
  authorName: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Fylt av `withTargets`. Tom liste betyr «ingen innsnevring», aldri «ukjent». */
  targets: PostTarget[]
}

function selectPosts() {
  return db()
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
      format: posts.format,
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
 * Målrettingen for et sett rader, i én spørring. Radene kommer alltid ut med en
 * `targets`-liste — «vi har ikke sjekket» skal ikke kunne forveksles med «ingen
 * innsnevring», for de to gir motsatt svar på hvem som får se beskjeden.
 */
async function withTargets<T extends { id: string }>(rows: T[]): Promise<Array<T & { targets: PostTarget[] }>> {
  const byPost = await postTargetsFor(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, targets: byPost.get(r.id) ?? [] }))
}

/**
 * Ditt eget innlegg er alltid synlig for deg — også som utkast, og også når
 * målrettingen ikke treffer deg selv. Uten dette ville et halvferdig innlegg
 * (f.eks. hvis bildeopplastingen feilet) blitt usynlig for den som skrev det,
 * uten vei til å fullføre eller slette det.
 */
function visibleTo(row: Row, reader: PostReader, me?: Me): boolean {
  if (me && row.authorId !== null && row.authorId === me.id) return true
  return canReadPost(
    { audience: row.audience, targets: row.targets, publishedAt: row.publishedAt?.getTime() ?? null },
    reader,
  )
}

function authorOf(row: { authorId: string | null; authorName: string | null; official: boolean }): PostAuthor {
  return { id: row.authorId, name: row.authorName ?? (row.official ? OFFICIAL_AUTHOR : UNKNOWN_AUTHOR) }
}

/** Leser ett innlegg (med målrettingen) og avviser det leseren ikke har lov til å se. */
async function readablePost(id: string, reader: PostReader, me?: Me): Promise<Row> {
  const row = (await withTargets(await selectPosts().where(eq(posts.id, id)).limit(1)))[0]
  // Samme feilmelding for «finnes ikke» og «ikke for deg»: et innlegg til
  // styret — eller til slagverksgruppa — skal ikke kunne bekreftes ved å prøve en id.
  if (!row || !visibleTo(row, reader, me)) throw new Error('Fant ikke beskjeden')
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
  mentions: Map<string, MentionUser[]>
  labels: Map<string, string>
}> {
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) {
    return {
      comments: new Map(),
      likes: new Map(),
      mine: new Set(),
      images: new Map(),
      mentions: new Map(),
      labels: new Map(),
    }
  }
  const d = db()
  const [commentRows, reactionRows, imageRows, mentions, labels] = await Promise.all([
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
    postMentionsFor(ids),
    // Navnene på stemmegruppene/prosjektene beskjedene er målrettet mot. Ett
    // oppslag for hele feeden — de fleste innlegg har ingen målretting i det
    // hele tatt, og da er lista tom.
    targetLabels(rows.flatMap((r) => r.targets)),
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
  return { comments: new Map(commentRows.map((r) => [r.postId, r.n])), likes, mine, images, mentions, labels }
}

/** Dagens navn på de omtalte i en håndfull innlegg. Én spørring. */
async function postMentionsFor(postIds: string[]): Promise<Map<string, MentionUser[]>> {
  const out = new Map<string, MentionUser[]>()
  if (postIds.length === 0) return out
  const rows = await db()
    .select({ postId: postMentions.postId, id: user.id, name: user.name })
    .from(postMentions)
    .innerJoin(user, eq(postMentions.userId, user.id))
    .where(inArray(postMentions.postId, postIds))
  for (const r of rows) {
    const list = out.get(r.postId) ?? []
    list.push({ id: r.id, name: r.name })
    out.set(r.postId, list)
  }
  return out
}

function toListItem(
  row: Row,
  me: Me,
  canPublish: boolean,
  extra: Awaited<ReturnType<typeof decorate>>,
  imageLimit: number,
): PostListItem {
  const all = extra.images.get(row.id) ?? []
  const mentions = extra.mentions.get(row.id) ?? []
  // Overskrift og utdrag lages ALLTID av den rene teksten: feeden, hub-en og
  // e-postemnet skal aldri vise «#» eller «**» — og aldri en omtale-markør.
  // Rekkefølgen er nødvendig: markdown strippes først, så settes navnene inn.
  const plain = mentionPlainText(postPlainText(row.body, row.format), mentions)
  return {
    id: row.id,
    heading: postHeading({ title: row.title, body: plain }),
    title: row.title,
    excerpt: excerpt(plain),
    format: row.format,
    audience: row.audience,
    targets: row.targets,
    targetLabel: targetLabel(row.targets, extra.labels),
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
    mentions,
  }
}

export const listPosts = createServerFn().handler(async () => {
  const me = await requireMe()
  const canPublish = hasPermission(me, PUBLISH_PERMISSION)
  const reader = await postReaderFor(me)
  const rows = await withTargets(await selectPosts().orderBy(desc(posts.publishedAt), desc(posts.createdAt)))
  // Filtreringen skjer HER, på serveren, før noe forlater Workeren — både
  // utkast, styre-beskjeder og målrettingen. Klienten får aldri en beskjed den
  // skal skjule selv.
  const visible = rows.filter((r) => visibleTo(r, reader, me))
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
    const reader = await postReaderFor(me)
    const row = await readablePost(data.id, reader, me)
    // «Sett» registreres her, ikke i en egen klienthandling: å ha åpnet
    // detaljsiden ER å ha sett beskjeden, og en knapp «jeg har lest denne» ville
    // målt noe annet (og blitt oversett).
    await markSeen(row, me)
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
    // Omtalene løses til DAGENS navn her, ikke ved lagring: bytter noen navn,
    // følger omtalen med av seg selv (#83).
    const mentionsByComment = await mentionsFor(commentRows.map((c) => c.id))

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
          mentions: mentionsByComment.get(c.id) ?? [],
        }),
      ),
      // Leveringsstatus er et skriveverktøy; medlemmer skal ikke se hvem som fikk e-post.
      delivery: canPublish && row.publishedAt ? await deliveryFor(row) : null,
      // Sett-status følger samme linje: tallet til forfatteren og `posts.publish`,
      // navnelista bare på VIKTIGE beskjeder.
      seen: canSeeSeenStatus(me, row, canPublish) && row.publishedAt ? await seenStatusFor(row, me, canPublish) : null,
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
    // Å målrette er samme privilegium som å skrive til styret: uten
    // `posts.publish` blir lista tom, akkurat som `audience` tvinges til `all`.
    const targets = sanitizePostTargets(data.targets, canPublish)
    await assertValidTargets(targets)
    // Omtalene valideres FØR innlegget lagres — mot målgruppen `sanitizePostInput`
    // faktisk endte på, ikke den klienten påstod at den valgte, og mot
    // målrettingen: en omtalt må kunne lese innlegget hen er omtalt i.
    const mentionIds = await checkedPostMentions(safe.body, { audience: safe.audience, targets })
    const ts = new Date()
    const id = newId()
    await db()
      .insert(posts)
      .values({
        id,
        title: safe.title,
        body: safe.body,
        format: safe.format,
        audience: safe.audience,
        importance: safe.importance,
        official: safe.official,
        authorId: me.id,
        publishedAt: null,
        createdAt: ts,
        updatedAt: ts,
      })
    await syncPostTargets(id, targets)
    // Utkast varsler aldri: radene får `notified_at = null` og e-posten går
    // først når innlegget publiseres.
    await syncPostMentions(id, mentionIds)
    return { id }
  })

export const updatePost = createServerFn({ method: 'POST' })
  .validator(postInput.extend({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const reader = await postReaderFor(me)
    const existing = (await withTargets(await selectPosts().where(eq(posts.id, data.id)).limit(1)))[0]
    if (!existing || !visibleTo(existing, reader, me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, existing, canPublish)) throw new Error('Du kan bare endre dine egne innlegg')

    const safe = sanitizePostInput({ ...data, title: data.title ?? null }, canPublish)
    // Målgruppen som faktisk kommer til å gjelde etter lagringen — uten
    // `posts.publish` skrives verken den eller målrettingen, og da er det de
    // gamle som teller. Omtalene valideres på NYTT mot dem: flyttes et innlegg
    // til «Bare styret» — eller snevres det inn til slagverksgruppa — kan en
    // omtale av noen utenfor ikke bli stående.
    const audience = canPublish ? safe.audience : existing.audience
    const targets = canPublish ? sanitizePostTargets(data.targets, canPublish) : existing.targets
    if (canPublish) await assertValidTargets(targets)
    const mentionIds = await checkedPostMentions(safe.body, { audience, targets })

    // Uten `posts.publish` endres kun tittel og tekst: et innlegg en moderator
    // har merket «Fra styret» skal ikke miste merket fordi eieren retter en skrivefeil.
    await db()
      .update(posts)
      .set(
        canPublish
          ? {
              title: safe.title,
              body: safe.body,
              format: safe.format,
              audience: safe.audience,
              importance: safe.importance,
              official: safe.official,
              updatedAt: new Date(),
            }
          : // Formatet er ikke privilegert, så det følger med også her — ellers
            // ville et markdown-innlegg blitt ren tekst av en skrivefeilretting.
            { title: safe.title, body: safe.body, format: safe.format, updatedAt: new Date() },
      )
      .where(eq(posts.id, data.id))
    if (canPublish) await syncPostTargets(data.id, targets)
    await syncPostMentions(data.id, mentionIds)

    // Er innlegget allerede publisert, er en ny omtale i teksten en ny beskjed
    // til den det gjelder. `notified_at` sørger for at bare DE NYE får e-post —
    // de som stod der fra før har allerede fått sin.
    if (existing.publishedAt) {
      const updated: Row = {
        ...existing,
        title: safe.title,
        body: safe.body,
        format: safe.format,
        audience,
        targets,
        importance: canPublish ? safe.importance : existing.importance,
        official: canPublish ? safe.official : existing.official,
      }
      try {
        await notifyPostMentions(updated, new Set())
      } catch (err) {
        // Teksten er lagret; en feilende e-post skal ikke velte redigeringen.
        console.error('[omtaler] kunne ikke varsle om omtale i innlegg:', err)
      }
    }
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
    const row = (await withTargets(await selectPosts().where(eq(posts.id, data.id)).limit(1)))[0]
    if (!row || !visibleTo(row, await postReaderFor(me), me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, row, canPublish)) throw new Error('Du kan bare publisere dine egne innlegg')

    if (!row.publishedAt) {
      const now = new Date()
      await db().update(posts).set({ publishedAt: now, updatedAt: now }).where(eq(posts.id, row.id))
      row.publishedAt = now
    }

    // E-post er styrets verktøy. Ber en vanlig skribent om det, ignoreres det.
    const notify = data.sendEmail && canPublish
    const { result, emailed } = notify
      ? await notifyPost(row)
      : { result: { sent: 0, logged: 0, failed: 0, skipped: 0 }, emailed: new Set<string>() }

    // Omtale-e-posten går ETTER beskjed-e-posten, og bare til dem som ikke
    // nettopp fikk hele innlegget i innboksen. Feiler den, står innlegget
    // fortsatt publisert — det er den viktige delen.
    try {
      await notifyPostMentions(row, emailed)
    } catch (err) {
      console.error('[omtaler] kunne ikke varsle om omtale i innlegg:', err)
    }
    return { ok: true, ...result }
  })

export const unpublishPost = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const row = (await withTargets(await selectPosts().where(eq(posts.id, data.id)).limit(1)))[0]
    if (!row || !visibleTo(row, await postReaderFor(me), me)) throw new Error('Fant ikke beskjeden')
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
    const row = (await withTargets(await selectPosts().where(eq(posts.id, data.id)).limit(1)))[0]
    if (!row || !visibleTo(row, await postReaderFor(me), me)) throw new Error('Fant ikke beskjeden')
    if (!canEditPost(me, row, canPublish)) throw new Error('Du kan bare slette dine egne innlegg')

    // R2 først: databaseraden er den eneste veien tilbake til nøkkelen, så
    // klarer vi ikke å slette bytene, skal raden bli stående.
    const images = await db().select({ r2Key: postImages.r2Key }).from(postImages).where(eq(postImages.postId, data.id))
    await Promise.all(images.map((img) => env.FILES.delete(img.r2Key)))
    await db().delete(posts).where(eq(posts.id, data.id)) // kommentarer/likes/bilder via cascade
    return { ok: true }
  })

// ---------- Kommentarer ----------

/**
 * Alle medlemmer med det en omtale trenger å vite: navn (til forslagslista og
 * chip-en), aktiv-status, e-post (kun for varslingen, aldri til klienten), om
 * rollene deres gir `posts.publish` — og siden #28 også stemmegruppene og
 * prosjektene, siden en målrettet beskjed bare kan leses av dem den treffer.
 * Samme grunnlag brukes til forslagslista og til valideringen, så de to kan
 * ikke komme i utakt.
 */
async function mentionCandidates(): Promise<{
  members: MentionCandidate[]
  prefs: Map<string, MentionNotificationChoice>
}> {
  const [members, prefRows] = await Promise.all([
    memberDirectory(),
    db()
      .select({ userId: notificationPreferences.userId, mentions: notificationPreferences.mentions })
      .from(notificationPreferences),
  ])
  return { members, prefs: new Map(prefRows.map((p) => [p.userId, p.mentions])) }
}

/** Dagens navn på de omtalte i en håndfull kommentarer. Én spørring. */
async function mentionsFor(commentIds: string[]): Promise<Map<string, MentionUser[]>> {
  const out = new Map<string, MentionUser[]>()
  if (commentIds.length === 0) return out
  const rows = await db()
    .select({ commentId: postCommentMentions.commentId, id: user.id, name: user.name })
    .from(postCommentMentions)
    .innerJoin(user, eq(postCommentMentions.userId, user.id))
    .where(inArray(postCommentMentions.commentId, commentIds))
  for (const r of rows) {
    const list = out.get(r.commentId) ?? []
    list.push({ id: r.id, name: r.name })
    out.set(r.commentId, list)
  }
  return out
}

/** Antall forslag lista viser om gangen. Nok til å velge, kort nok til mobil. */
const MENTION_SUGGESTIONS = 8

/**
 * Forslagslista bak `@` (#83). Gated på `requireMe()` OG på at innlegget faktisk
 * er lesbart for den som spør — deretter filtreres kandidatene med NØYAKTIG
 * samme audience-regel: kun aktive medlemmer som selv kan lese innlegget. På et
 * `audience: 'board'`-innlegg betyr det kun dem med `posts.publish`.
 *
 * Returnerer KUN `{ id, name }`. E-post, telefon, rolle og stemme hører ikke
 * hjemme i en autofullføring, og skal ikke kunne hentes ut gjennom den.
 */
export const searchMentionableMembers = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string().min(1), query: z.string().max(60).default('') }))
  .handler(async ({ data }): Promise<MentionUser[]> => {
    const me = await requireMe()
    const row = await readablePost(data.postId, await postReaderFor(me), me)
    const { members } = await mentionCandidates()
    const allowed = mentionableMembers(
      { audience: row.audience, targets: row.targets, publishedAt: row.publishedAt?.getTime() ?? null },
      members,
    )
    return rankMentionCandidates(
      allowed.map((m) => ({ id: m.userId, name: m.name })),
      data.query,
      MENTION_SUGGESTIONS,
    )
  })

/**
 * Forslagslista bak `@` i INNLEGGSSKJEMAET. Et innlegg som ikke er lagret ennå
 * har ingen id å slå opp, så spørsmålet stilles om målgruppen i stedet: hvem vil
 * kunne lese dette når det publiseres?
 *
 * Gated på `requireMe()`, og — like viktig — på hva den som spør faktisk KAN
 * velge: uten `posts.publish` er `audience: 'board'` ikke et gyldig valg
 * (`sanitizePostInput` tvinger det til `all`), så da svarer vi for `all`. Ellers
 * ville et rått kall med `board` gitt et vanlig medlem lista over styret.
 *
 * Returnerer KUN `{ id, name }`, som forslagslista i kommentarene.
 */
export const searchMentionableForAudience = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      audience: z.enum(['all', 'board']).default('all'),
      targets: targetInput,
      query: z.string().max(60).default(''),
    }),
  )
  .handler(async ({ data }): Promise<MentionUser[]> => {
    const me = await requireMe()
    const canPublish = hasPermission(me, PUBLISH_PERMISSION)
    const audience: PostAudience = canPublish ? data.audience : 'all'
    // Samme resonnement for målrettingen: uten `posts.publish` er den ikke et
    // gyldig valg, og et rått kall skal ikke kunne bruke den som et filter over
    // hvem som spiller hva.
    const targets = sanitizePostTargets(data.targets, canPublish)
    const { members } = await mentionCandidates()
    return rankMentionCandidates(
      mentionableForAudience({ audience, targets }, members).map((m) => ({ id: m.userId, name: m.name })),
      data.query,
      MENTION_SUGGESTIONS,
    )
  })

export const addComment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      postId: z.string().min(1),
      body: z.string().trim().min(1, 'Skriv noe først').max(4_000, 'Kommentaren er for lang'),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const row = await readablePost(data.postId, await postReaderFor(me), me)
    if (!row.publishedAt) throw new Error('Utkast kan ikke kommenteres')

    // Omtalene valideres FØR kommentaren lagres. Klienten setter markørene, så
    // de er akkurat like betrodde som alt annet fra en nettleser: ingenting.
    const mentionIds = parseMentions(data.body)
    let recipients: MentionCandidate[] = []
    let mentioned: MentionUser[] = []
    if (mentionIds.length > 0) {
      const { members, prefs } = await mentionCandidates()
      const allowed = new Map(
        mentionableMembers(
          { audience: row.audience, targets: row.targets, publishedAt: row.publishedAt.getTime() },
          members,
        ).map((m) => [m.userId, m]),
      )
      // Felles regel og ÉN felles feilmelding — se `MENTION_DENIED`.
      const error = mentionRejection(mentionIds, allowed, MENTION_DENIED)
      if (error) throw new Error(error)
      mentioned = mentionIds.map((id) => ({ id, name: allowed.get(id)!.name }))
      recipients = mentionRecipients(mentionIds, [...allowed.values()], { commenterId: me.id, prefs })
    }

    const ts = new Date()
    const id = newId()
    await db()
      .insert(postComments)
      .values({ id, postId: row.id, authorId: me.id, body: data.body, createdAt: ts, updatedAt: ts })
    if (mentionIds.length > 0) {
      // Den spørrbare koblingen. Cascader med kommentaren ved sletting.
      await db()
        .insert(postCommentMentions)
        .values(mentionIds.map((userId) => ({ commentId: id, userId })))
        .onConflictDoNothing()
    }

    // En feilende e-post skal aldri velte kommentaren — den er allerede lagret,
    // og teksten er det viktigste. Loggen er varselet om at noe er galt.
    try {
      await notifyMentions({ post: row, commenterName: me.name, body: data.body, mentioned, recipients })
    } catch (err) {
      console.error('[omtaler] kunne ikke varsle om omtale:', err)
    }
    // TODO(varsling): svar på eget innlegg bør kunne gi e-post/varsel senere.
    return { id }
  })

/**
 * Én e-post per omtalt person per kommentar. Dedupe og «aldri til deg selv»
 * ligger i `mentionRecipients`; her er det bare selve sendingen. Ingen
 * `notification_log`-rad: en kommentar kan verken redigeres eller sendes på
 * nytt, så markørene skrives én gang og e-posten går én gang.
 */
async function notifyMentions(input: {
  post: Row
  commenterName: string
  body: string
  /** Alle validerte omtaler — brukes til å skrive navn i stedet for markører. */
  mentioned: MentionUser[]
  recipients: MentionCandidate[]
}): Promise<void> {
  if (input.recipients.length === 0) return
  // URL-en bygges fra BETTER_AUTH_URL, aldri fra request-origin (AGENTS.md).
  const url = `${new URL(env.BETTER_AUTH_URL).origin}/beskjeder/${input.post.id}`
  const mail = mentionEmail({
    commenterName: input.commenterName,
    postHeading: postHeading({ title: input.post.title, body: postPlainText(input.post.body, input.post.format) }, 160),
    // Utdraget viser navn, ikke markører — ingen skal lese `@[u:kd9…]` i innboksen.
    excerpt: excerpt(mentionPlainText(input.body, input.mentioned)),
    url,
  })
  for (const batch of chunk(input.recipients, EMAIL_BATCH)) {
    await Promise.allSettled(
      batch.map((r) => sendEmail({ to: r.email!, subject: mail.subject, html: mail.html, text: mail.text })),
    )
  }
}

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
    await readablePost(comment.postId, await postReaderFor(me), me)
    if (!canDeleteComment(me, comment, canPublish)) throw new Error('Du kan bare slette dine egne kommentarer')
    // Omtalene i `post_comment_mentions` forsvinner med kommentaren (cascade).
    // Brukerne står selvsagt urørt — det er koblingen som slettes, ikke folk.
    await db().delete(postComments).where(eq(postComments.id, data.id))
    return { ok: true }
  })

// ---------- Reaksjoner ----------

export const toggleReaction = createServerFn({ method: 'POST' })
  .validator(z.object({ postId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    // Bevisst UTEN `me`: et utkast skal ikke kunne likes, heller ikke av den som
    // skrev det. Målrettingen gjelder som ellers — leseren må være i målgruppen.
    const row = await readablePost(data.postId, await postReaderFor(me))
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
    const row = (await withTargets(await selectPosts().where(eq(posts.id, data.id)).limit(1)))[0]
    if (!row) throw new Error('Fant ikke beskjeden')
    if (!row.publishedAt) throw new Error('Beskjeden er ikke publisert ennå')
    return { ok: true, ...(await notifyPost(row)).result }
  })

/**
 * Alle medlemmer med det varslingen trenger å vite: aktiv-status, e-post, om
 * rollene deres gir `posts.publish` (avgjør `audience: 'board'`) og hvilke
 * stemmegrupper/prosjekter de hører til (avgjør målrettingen, #28).
 */
async function candidates(): Promise<{ members: PostRecipient[]; prefs: Map<string, PostNotificationChoice> }> {
  const [members, prefRows] = await Promise.all([
    memberDirectory(),
    db()
      .select({ userId: notificationPreferences.userId, posts: notificationPreferences.posts })
      .from(notificationPreferences),
  ])
  return { members, prefs: new Map(prefRows.map((p) => [p.userId, p.posts])) }
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
async function notifyPost(row: Row): Promise<{ result: PostNotifyResult; emailed: Set<string> }> {
  const [{ members, prefs }, log, imageCount, mentionsByPost] = await Promise.all([
    candidates(),
    alreadyNotified(row.id),
    db()
      .select({ n: sql<number>`count(*)` })
      .from(postImages)
      .where(eq(postImages.postId, row.id))
      .then((rows) => rows[0]?.n ?? 0),
    postMentionsFor([row.id]),
  ])
  const recipients = recipientsFor(row, members, prefs)
  const pending = recipients.filter((r) => !log.has(r.userId))
  const result: PostNotifyResult = { sent: 0, logged: 0, failed: 0, skipped: recipients.length - pending.length }
  const emailed = new Set<string>()
  if (pending.length === 0) return { result, emailed }

  // Markørene byttes ut med navn før teksten sendes: ingen skal lese
  // `@[u:kd9…]` i innboksen. Chip-en er en ting for internsiden.
  const mentions = mentionsByPost.get(row.id) ?? []
  const body = mentionPlainText(row.body, mentions)
  // URL-en bygges fra BETTER_AUTH_URL, aldri fra request-origin (AGENTS.md).
  const url = `${new URL(env.BETTER_AUTH_URL).origin}/beskjeder/${row.id}`
  const mail = postEmail({
    title: postHeading({ title: row.title, body: postPlainText(body, row.format) }, 160),
    body,
    format: row.format,
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
      // «Fikk denne personen beskjeden i denne utsendingen?» — grunnlaget for at
      // en omtalt mottaker ikke også får omtale-e-posten om samme innlegg.
      emailed.add(batch[i]!.userId)
    })
  }

  const sentAt = new Date()
  for (const batch of chunk(outcomes, LOG_BATCH)) {
    await db()
      .insert(notificationLog)
      .values(batch.map((o) => ({ postId: row.id, userId: o.userId, sentAt, outcome: o.outcome })))
      .onConflictDoNothing()
  }
  return { result, emailed }
}

// ---------- Omtaler i innlegg ----------

/**
 * Markørene i et innlegg, validert mot målgruppen. Kaster ved første avvik, med
 * ÉN felles feilmelding (`MENTION_DENIED`).
 *
 * Regelen er den samme som i `addComment`, men spørsmålet er et annet: et
 * innlegg som ikke er publisert ennå har ingen lesere, så vi spør hvem som vil
 * kunne lese det med den målgruppen det får (`mentionableForAudience`).
 */
async function checkedPostMentions(body: string, post: { audience: PostAudience; targets: PostTarget[] }): Promise<string[]> {
  const ids = parseMentions(body)
  if (ids.length === 0) return []
  const { members } = await mentionCandidates()
  const allowed = new Set(mentionableForAudience(post, members).map((m) => m.userId))
  const error = mentionRejection(ids, allowed, MENTION_DENIED)
  if (error) throw new Error(error)
  return ids
}

/**
 * Skriver `post_mentions` slik teksten nå ser ut. Rader som fortsatt gjelder
 * røres IKKE — `notified_at` er sannheten om hvem som har fått e-post, og en
 * lagring skal ikke kunne nullstille den og sende alt på nytt.
 */
async function syncPostMentions(postId: string, userIds: string[]): Promise<void> {
  const d = db()
  const existing = await d.select({ userId: postMentions.userId }).from(postMentions).where(eq(postMentions.postId, postId))
  const wanted = new Set(userIds)
  const gone = existing.filter((r) => !wanted.has(r.userId)).map((r) => r.userId)
  if (gone.length > 0) {
    await d.delete(postMentions).where(and(eq(postMentions.postId, postId), inArray(postMentions.userId, gone)))
  }
  if (userIds.length > 0) {
    await d
      .insert(postMentions)
      .values(userIds.map((userId) => ({ postId, userId, notifiedAt: null })))
      .onConflictDoNothing()
  }
}

/**
 * E-post til dem som er omtalt i et PUBLISERT innlegg og ikke er varslet fra
 * før. Reglene, i den rekkefølgen de gjelder:
 *
 * 1. **Utkast varsler aldri.** Omtalen finnes, men ingen kan lese den ennå.
 * 2. **Én gang per omtale.** `notified_at` er merket; avpubliser/republiser og
 *    lagre-på-nytt sender aldri det samme to ganger.
 * 3. **Aldri deg selv**, aldri uten e-postadresse, aldri når `mentions: 'off'`.
 * 4. **Aldri dobbelt opp med beskjed-e-posten.** Den som akkurat fikk hele
 *    innlegget i innboksen (`postEmailed`) får ikke i tillegg en e-post om at
 *    hen er nevnt i det — men merkes som varslet, for hen ER varslet.
 * 5. Bare de som fortsatt kan LESE innlegget. Markørene er validert ved lagring;
 *    dette er beltet i tillegg til bukseselene.
 */
async function notifyPostMentions(row: Row, postEmailed: ReadonlySet<string>): Promise<void> {
  if (!row.publishedAt) return
  const rows = await db()
    .select({ userId: postMentions.userId, notifiedAt: postMentions.notifiedAt })
    .from(postMentions)
    .where(eq(postMentions.postId, row.id))
  if (rows.length === 0) return

  const { members, prefs } = await mentionCandidates()
  const readable = mentionableForAudience({ audience: row.audience, targets: row.targets }, members)
  const { email, markNotified } = postMentionRecipients(
    rows.map((r) => r.userId),
    readable,
    {
      authorId: row.authorId ?? '',
      prefs,
      alreadyNotified: new Set(rows.filter((r) => r.notifiedAt !== null).map((r) => r.userId)),
      postEmailed,
    },
  )
  if (markNotified.length === 0) return

  if (email.length > 0) {
    const url = `${new URL(env.BETTER_AUTH_URL).origin}/beskjeder/${row.id}`
    const plain = mentionPlainText(
      postPlainText(row.body, row.format),
      readable.map((m) => ({ id: m.userId, name: m.name })),
    )
    const mail = postMentionEmail({
      authorName: row.authorName ?? OFFICIAL_AUTHOR,
      postHeading: postHeading({ title: row.title, body: plain }, 160),
      excerpt: excerpt(plain),
      url,
    })
    for (const batch of chunk(email, EMAIL_BATCH)) {
      await Promise.allSettled(
        batch.map((r) => sendEmail({ to: r.email!, subject: mail.subject, html: mail.html, text: mail.text })),
      )
    }
  }

  // Merket settes for ALLE som er ferdigbehandlet — også dem som fikk
  // beskjed-e-posten i stedet. Uten det ville neste publisering sendt dem
  // omtale-e-posten «til gode».
  const notifiedAt = new Date()
  for (const batch of chunk(markNotified, LOG_BATCH)) {
    await db()
      .update(postMentions)
      .set({ notifiedAt })
      .where(and(eq(postMentions.postId, row.id), inArray(postMentions.userId, batch)))
  }
}


// ---------- Målretting (#28) ----------

/**
 * Skriver `post_targets` slik skjemaet nå ser ut. Full erstatning (slett det som
 * er borte, sett inn det nye) — i motsetning til omtalene henger det ingen
 * «varslet»-tilstand på en målretting, så det er ingenting å bevare.
 *
 * Kalles KUN når avsenderen har `posts.publish`; uten den røres ikke
 * målrettingen i det hele tatt, av samme grunn som «Fra styret» ikke forsvinner
 * når eieren retter en skrivefeil.
 */
async function syncPostTargets(postId: string, targets: PostTarget[]): Promise<void> {
  const d = db()
  await d.delete(postTargets).where(eq(postTargets.postId, postId))
  if (targets.length === 0) return
  await d
    .insert(postTargets)
    .values(targets.map((t) => ({ postId, kind: t.kind, refId: t.refId })))
    .onConflictDoNothing()
}

/**
 * Valgene i målrettingsvelgeren, med antall medlemmer hver av dem treffer.
 *
 * Tallet er hele poenget med at dette er en serverfunksjon og ikke en konstant i
 * klienten: prosjektdeltakelse er AVLEDET (se `post-audience.ts`), og den som
 * skal sende en beskjed skal se «12 medlemmer» før hen publiserer — ikke oppdage
 * etterpå at halve korpset aldri fikk den.
 *
 * Gated på `posts.publish`: målretting er samme privilegium som styre-målgruppen,
 * og lista over hvem som spiller hva er ikke noe et rått kall skal kunne telle.
 */
export const listPostTargetOptions = createServerFn().handler(async () => {
  await requirePermission(PUBLISH_PERMISSION)
  return await targetOptions()
})

// ---------- Lest/sett (#28) ----------

/**
 * Merker beskjeden som sett. Idempotent via PK-en: `seen_at` er FØRSTE gang, og
 * et nytt besøk skriver ingenting (`onConflictDoNothing`).
 *
 * Tre ting registreres bevisst ikke:
 * - **Utkast.** Det finnes ingen mottakere å telle mot ennå.
 * - **Forfatterens eget besøk.** Hen er ikke i nevneren (`postAudienceMembers`),
 *   så raden ville aldri blitt lest — bare skrevet ved hver forhåndsvisning.
 * - **Feil.** En sett-rad er ikke verdt å velte visningen av beskjeden for;
 *   verste utfall er at ett besøk ikke ble talt.
 */
async function markSeen(row: Row, me: Me): Promise<void> {
  if (!row.publishedAt) return
  if (row.authorId !== null && row.authorId === me.id) return
  try {
    await db().insert(postSeen).values({ postId: row.id, userId: me.id, seenAt: new Date() }).onConflictDoNothing()
  } catch (err) {
    console.error('[beskjeder] kunne ikke registrere sett-status:', err)
  }
}

/**
 * «Sett av N av M» — og for VIKTIGE beskjeder navnelista bak.
 *
 * Nevneren er `postAudienceMembers`: de aktive medlemmene beskjeden faktisk er
 * for, uten forfatteren. Det er derfor en beskjed til slagverksgruppa viser
 * «Sett av 2 av 3» og ikke «2 av 34» — tallet skal svare på om beskjeden nådde
 * fram, ikke på hvor stort korpset er.
 *
 * Navnelista er strengere enn tallet (`canSeeSeenNames`): kun viktige beskjeder,
 * kun forfatteren og `posts.publish`. Hvem som har lest en trivelig hilsen er
 * ingens sak.
 */
async function seenStatusFor(row: Row, me: Me, canPublish: boolean): Promise<PostSeenStatus> {
  const [directory, seenRows] = await Promise.all([
    memberDirectory(),
    db().select({ userId: postSeen.userId }).from(postSeen).where(eq(postSeen.postId, row.id)),
  ])
  const audience = postAudienceMembers(
    { audience: row.audience, targets: row.targets, authorId: row.authorId },
    directory,
  )
  const seenIds = new Set(seenRows.map((r) => r.userId))
  const seen = audience.filter((m) => seenIds.has(m.userId))

  return {
    seen: seen.length,
    total: audience.length,
    label: seenLabel(seen.length, audience.length),
    names: canSeeSeenNames(me, row, canPublish)
      ? {
          seen: seen.map((m) => m.name),
          pending: audience.filter((m) => !seenIds.has(m.userId)).map((m) => m.name),
        }
      : null,
  }
}
