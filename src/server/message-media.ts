import { env } from 'cloudflare:workers'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { boardMessages, forumReplies, forumTopics, leaderMessages, messageMedia, postComments, posts } from '../db/schema'
import { isGroupLeader } from '../lib/gruppeledere'
import { newId } from '../lib/id'
import { MAX_KLIPY_DIMENSION, contentTypeForKlipyUrl, isKlipyMediaUrl } from '../lib/klipy'
import {
  type ExternalMediaKind,
  MAX_MEDIA_PER_ITEM,
  MAX_MESSAGE_MEDIA_BYTES,
  MAX_PENDING_MEDIA,
  PENDING_MEDIA_STALE_MS,
  type MessageMediaItem,
  type MessageMediaTarget,
  ORPHAN_MEDIA_GRACE_MS,
  PENDING_MEDIA_TTL_MS,
  messageMediaExtension,
  sniffImage,
  sniffedRejectionReason,
  uniqueMediaIds,
} from '../lib/message-media'
import { canReadPost } from '../lib/posts'
import { type Me, hasPermission } from './access'

/**
 * Bildene i samtalene, server-siden: gaten, koblingen til en melding, sletting
 * og den daglige ryddingen.
 *
 * Vanlige eksporter, ikke serverfunksjoner, i en EGEN modul med vilje: API-
 * rutene `/api/message-media/*` kaller gaten direkte, og serverfunksjonene i
 * forum.ts, posts.ts, board.ts og gruppeledere.ts kaller resten fra handlerne
 * sine. Ingen rutekomponent skal importere denne fila — et levende eksport som
 * rører `cloudflare:workers` ville dratt Workers-runtime inn i klientbygget
 * (samme grunn som `post-images.ts` er skilt ut).
 */

/** En feil som kan vises til den som lastet opp (400), ikke en serverfeil. */
export class MediaUploadError extends Error {}

/**
 * Leser forespørselskroppen, men aldri mer enn grensen: `Content-Length` er en
 * påstand fra klienten og brukes bare til å avvise tidlig.
 */
export async function readMediaBody(request: Request): Promise<Uint8Array> {
  const tooBig = () => new MediaUploadError('Filen er større enn 10 MB')
  if (Number(request.headers.get('content-length')) > MAX_MESSAGE_MEDIA_BYTES) throw tooBig()
  const reader = request.body?.getReader()
  if (!reader) throw new MediaUploadError('Tom fil')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_MESSAGE_MEDIA_BYTES) {
        await reader.cancel()
        throw tooBig()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Lagrer et opplastet bilde som utkast (uten mål). Formatet og størrelsen leses
 * fra bytene — `Content-Type` og filnavn fra klienten brukes ikke til noe — og
 * R2-nøkkelen bygges av en fersk id. Hver opplasting er ett nytt objekt; ingen
 * deduplisering, så et bilde aldri kan dukke opp i en annens melding.
 *
 * `title` (alt-tekst) settes bare av serveren selv — for en GIF valgt fra
 * Tertnes-fanen, som kopieres inn hit (`pickBandMedia`) — aldri fra klienten.
 */
export async function storeMessageMedia(bytes: Uint8Array, me: Me, opts: { title?: string } = {}): Promise<MessageMediaItem> {
  const image = sniffImage(bytes)
  const reason = sniffedRejectionReason(image, bytes.byteLength)
  if (reason || !image) throw new MediaUploadError(reason ?? 'Ukjent filformat')
  if ((await pendingMediaCount(me.id)) >= MAX_PENDING_MEDIA) {
    // Taket er nådd: gi plass ved å fjerne eierens egne forlatte utkast (eldre
    // enn en time). Bare er det fortsatt fullt, avvises opplastingen.
    await evictStalePending(me.id, Date.now() - PENDING_MEDIA_STALE_MS)
    if ((await pendingMediaCount(me.id)) >= MAX_PENDING_MEDIA) {
      throw new MediaUploadError('Du har for mange bilder som ikke er sendt. Send eller fjern noen, eller prøv igjen om en time.')
    }
  }
  const id = newId()
  const r2Key = `message-media/${id}.${messageMediaExtension(image.contentType)}`
  const title = opts.title?.trim().slice(0, 200) || null
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: image.contentType } })
  try {
    await db().insert(messageMedia).values({
      id,
      ownerId: me.id,
      r2Key,
      title,
      contentType: image.contentType,
      size: bytes.byteLength,
      width: image.width,
      height: image.height,
      createdAt: new Date(),
    })
  } catch (err) {
    // Ingen foreldreløse objekter i R2 hvis raden ikke ble skrevet.
    await env.FILES.delete(r2Key).catch(() => {})
    throw err
  }
  return { id, contentType: image.contentType, width: image.width, height: image.height, ...(title ? { title } : {}) }
}

/**
 * Det gaten trenger for å svare: bytene i R2 for et opplastet bilde, eller
 * KLIPY-adressen den sender videre til. Gaten avviser med samme svar for
 * «finnes ikke» og «ikke for deg».
 */
export type MediaAccess =
  | { source: 'upload'; r2Key: string; contentType: string; size: number }
  | { source: 'klipy'; externalUrl: string }

/**
 * Et valg fra GIF-velgeren, som utkast (uten mål). Ingen bytes hos oss: KLIPYs
 * vilkår krever at medieadressen brukes slik den kom, og leserens nettleser
 * henter den fra KLIPY. Adressen MÅ være på KLIPYs CDN (`isKlipyMediaUrl`,
 * sjekket både i valideringen og her), ellers kunne et rått kall lagt inn et
 * sporingsbilde fra hvilken som helst vert. Samme tak på utkast som opplastinger.
 */
export async function createKlipyMedia(
  input: { kind: ExternalMediaKind; slug: string; title: string; url: string; width: number; height: number },
  me: Me,
): Promise<MessageMediaItem> {
  const contentType = contentTypeForKlipyUrl(input.url)
  if (!isKlipyMediaUrl(input.url) || !contentType) throw new MediaUploadError('Ugyldig adresse fra KLIPY')
  if ((await pendingMediaCount(me.id)) >= MAX_PENDING_MEDIA) {
    await evictStalePending(me.id, Date.now() - PENDING_MEDIA_STALE_MS)
    if ((await pendingMediaCount(me.id)) >= MAX_PENDING_MEDIA) {
      throw new MediaUploadError('Du har for mange bilder som ikke er sendt. Send eller fjern noen, eller prøv igjen om en time.')
    }
  }
  const id = newId()
  // Lagret i normalisert form (URL-parseren), aldri som rå streng: adressen
  // havner i en Location-header i gaten.
  const url = new URL(input.url).href
  const width = Math.min(input.width, MAX_KLIPY_DIMENSION)
  const height = Math.min(input.height, MAX_KLIPY_DIMENSION)
  const title = input.title.trim().slice(0, 200) || null
  await db().insert(messageMedia).values({
    id,
    ownerId: me.id,
    source: 'klipy',
    externalUrl: url,
    externalKind: input.kind,
    externalSlug: input.slug.slice(0, 200),
    title,
    contentType,
    size: 0,
    width,
    height,
    createdAt: new Date(),
  })
  return { id, contentType, width, height, externalUrl: url, externalKind: input.kind, title }
}

/**
 * Kan `me` se bildet? Samme regel som det bildet står i:
 *
 * - Ikke sendt ennå: bare den som lastet det opp.
 * - Forumet: alle aktive medlemmer (som forumet selv), så lenge innlegget finnes
 *   og ikke er et «slettet»-merke.
 * - Kommentar på veggen: den som kan lese innlegget (`canReadPost`, eller det er
 *   ditt eget) — avpubliseres innlegget eller flyttes til «Bare styret», følger
 *   bildene med. En slettet kommentar har ingen bilder.
 * - Styrechatten: `board.manage`. Lederchatten: aktiv leiarbinding.
 *
 * `me` er alltid et aktivt medlem (`currentUser()`); den sjekken gjør kalleren.
 */
export async function messageMediaAccess(id: string, me: Me): Promise<MediaAccess | null> {
  const d = db()
  const row = await d
    .select({
      source: messageMedia.source,
      r2Key: messageMedia.r2Key,
      externalUrl: messageMedia.externalUrl,
      contentType: messageMedia.contentType,
      size: messageMedia.size,
      ownerId: messageMedia.ownerId,
      targetKind: messageMedia.targetKind,
      targetId: messageMedia.targetId,
    })
    .from(messageMedia)
    .where(eq(messageMedia.id, id))
    .get()
  if (!row) return null
  let access: MediaAccess
  if (row.source === 'klipy' && isKlipyMediaUrl(row.externalUrl)) access = { source: 'klipy', externalUrl: row.externalUrl }
  else if (row.source === 'upload' && row.r2Key) access = { source: 'upload', r2Key: row.r2Key, contentType: row.contentType, size: row.size }
  else return null
  if (!row.targetKind || !row.targetId) return row.ownerId !== null && row.ownerId === me.id ? access : null
  return (await canSeeTarget(row.targetKind, row.targetId, me)) ? access : null
}

async function canSeeTarget(kind: MessageMediaTarget, targetId: string, me: Me): Promise<boolean> {
  const d = db()
  switch (kind) {
    case 'forum_topic':
      return !!(await d.select({ id: forumTopics.id }).from(forumTopics).where(and(eq(forumTopics.id, targetId), isNull(forumTopics.deletedAt))).get())
    case 'forum_reply':
      return !!(await d.select({ id: forumReplies.id }).from(forumReplies).where(and(eq(forumReplies.id, targetId), isNull(forumReplies.deletedAt))).get())
    case 'board_message':
      return (
        hasPermission(me, 'board.manage') &&
        !!(await d.select({ id: boardMessages.id }).from(boardMessages).where(eq(boardMessages.id, targetId)).get())
      )
    case 'leader_message':
      return (
        isGroupLeader(me) &&
        !!(await d.select({ id: leaderMessages.id }).from(leaderMessages).where(eq(leaderMessages.id, targetId)).get())
      )
    case 'post_comment': {
      const post = await d
        .select({ audience: posts.audience, publishedAt: posts.publishedAt, authorId: posts.authorId })
        .from(postComments)
        .innerJoin(posts, eq(postComments.postId, posts.id))
        .where(and(eq(postComments.id, targetId), isNull(postComments.deletedAt)))
        .get()
      if (!post) return false
      const own = post.authorId !== null && post.authorId === me.id
      return own || canReadPost({ audience: post.audience, publishedAt: post.publishedAt?.getTime() ?? null }, hasPermission(me, 'posts.publish'))
    }
  }
}

export const MEDIA_CLAIM_FAILED = 'Et av bildene er allerede sendt eller finnes ikke lenger. Fjern det og legg det til på nytt.'

/**
 * Kobler bildene som `ownerId` har lastet opp, til raden de skal stå i. Kalles
 * med den nye radens id FØR raden skrives: koblingen er en compare-and-set på
 * `target_id IS NULL`, så to innsendinger av samme utkast (dobbelttrykk, et
 * nytt forsøk etter et brudd) kan aldri begge få bildene — den andre feiler her
 * og skriver ingen melding. Blir ikke alle koblet, slippes de som ble det, og
 * kallet kaster. Ellers må kalleren kalle `releaseMessageMedia` hvis selve
 * raden ikke blir skrevet. Svaret er bildene som ble koblet (til utdrag og
 * varsler: `mediaLabel`).
 */
export async function claimMessageMedia(input: {
  ids: readonly string[]
  ownerId: string
  kind: MessageMediaTarget
  targetId: string
}): Promise<Array<{ id: string; contentType: string; externalKind: ExternalMediaKind | null }>> {
  const ids = uniqueMediaIds(input.ids)
  if (ids.length === 0) return []
  if (ids.length > MAX_MEDIA_PER_ITEM) throw new Error(`Maks ${MAX_MEDIA_PER_ITEM} bilder per melding`)
  const order = sql.join(ids.map((id, i) => sql`when ${id} then ${i}`), sql` `)
  const claimed = await db()
    .update(messageMedia)
    .set({
      targetKind: input.kind,
      targetId: input.targetId,
      attachedAt: new Date(),
      sortOrder: sql`case ${messageMedia.id} ${order} else 0 end`,
    })
    .where(and(inArray(messageMedia.id, ids), eq(messageMedia.ownerId, input.ownerId), isNull(messageMedia.targetId)))
    .returning({ id: messageMedia.id, contentType: messageMedia.contentType, externalKind: messageMedia.externalKind })
  if (claimed.length !== ids.length) {
    await releaseMessageMedia(input.targetId)
    throw new Error(MEDIA_CLAIM_FAILED)
  }
  return claimed
}

/** Gjør bildene til en rad som aldri ble skrevet, til utkast igjen. */
export async function releaseMessageMedia(targetId: string): Promise<void> {
  await db()
    .update(messageMedia)
    .set({ targetKind: null, targetId: null, attachedAt: null })
    .where(eq(messageMedia.targetId, targetId))
}

/** Bildene til en side med innlegg/svar/kommentarer/meldinger, `målets id → bilder`. */
export async function mediaFor(kind: MessageMediaTarget, targetIds: readonly string[]): Promise<Map<string, MessageMediaItem[]>> {
  const out = new Map<string, MessageMediaItem[]>()
  const ids = [...new Set(targetIds)]
  if (ids.length === 0) return out
  const rows: Array<MessageMediaItem & { targetId: string | null }> = []
  // D1 tar maks 100 bundne parametre per spørring.
  for (let i = 0; i < ids.length; i += 90) {
    rows.push(
      ...(await db()
        .select({
          id: messageMedia.id,
          targetId: messageMedia.targetId,
          contentType: messageMedia.contentType,
          width: messageMedia.width,
          height: messageMedia.height,
          externalUrl: messageMedia.externalUrl,
          externalKind: messageMedia.externalKind,
          title: messageMedia.title,
        })
        .from(messageMedia)
        .where(and(eq(messageMedia.targetKind, kind), inArray(messageMedia.targetId, ids.slice(i, i + 90))))
        .orderBy(asc(messageMedia.sortOrder), asc(messageMedia.createdAt))),
    )
  }
  for (const { targetId, ...item } of rows) {
    if (!targetId) continue
    out.set(targetId, [...(out.get(targetId) ?? []), item])
  }
  return out
}

/** Har raden bilder? (En tekst kan da redigeres til tom.) */
export async function hasMedia(kind: MessageMediaTarget, targetId: string): Promise<boolean> {
  return (await mediaFor(kind, [targetId])).has(targetId)
}

/** Sletter R2-objekter i ett kall per tusen nøkler (R2 tar en liste), ikke ett per bilde. */
async function deleteObjects(maybeKeys: ReadonlyArray<string | null>): Promise<void> {
  // KLIPY-valg har ingen bytes hos oss (r2_key er null).
  const keys = maybeKeys.filter((k): k is string => !!k)
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000))
}

/**
 * Bilder i rader som ER slettet: R2 først, så radene — raden er den eneste veien
 * tilbake til nøkkelen, og feiler R2, står radene igjen til neste rydding. Trygt
 * i denne rekkefølgen fordi et koblet bilde aldri kan kobles på nytt.
 */
async function deleteRows(rows: Array<{ id: string; r2Key: string | null }>): Promise<void> {
  if (rows.length === 0) return
  await deleteObjects(rows.map((r) => r.r2Key))
  for (let i = 0; i < rows.length; i += 90) {
    await db().delete(messageMedia).where(inArray(messageMedia.id, rows.slice(i, i + 90).map((r) => r.id)))
  }
}

/**
 * Utkast slettes motsatt vei: raden først, i ÉN setning med `target_id IS NULL`
 * i vilkåret, og så bytene. En melding som sendes samtidig kobler enten bildet
 * før (og da slettes ingenting) eller etter (og da feiler koblingen og meldingen
 * skrives ikke) — aldri en melding med et bilde som er borte. Feiler R2 etterpå,
 * blir bytene liggende uten rad: usynlige, men et sjeldent lekk heller enn en
 * tom melding.
 */
async function deletePendingWhere(where: ReturnType<typeof sql>): Promise<number> {
  const gone = await db()
    .delete(messageMedia)
    .where(and(isNull(messageMedia.targetId), where))
    .returning({ r2Key: messageMedia.r2Key })
  try {
    await deleteObjects(gone.map((r) => r.r2Key))
  } catch (err) {
    console.error('[bilder] kunne ikke slette utkast i R2:', err)
  }
  return gone.length
}

/** Eierens utkast eldre enn `before`, eldste først — se taket i `storeMessageMedia`. */
async function evictStalePending(ownerId: string, before: number): Promise<void> {
  await deletePendingWhere(
    sql`${messageMedia.id} in (select id from message_media where owner_id = ${ownerId} and target_id is null
      and created_at < ${before} order by created_at limit ${MAX_PENDING_MEDIA})`,
  )
}

/**
 * Sletter bildene til rader som nettopp er slettet (en melding, en kommentar,
 * kommentarene på et innlegg). Kalles ETTER at raden er borte: gaten viser
 * allerede ingenting, og feiler dette, tar den daglige ryddingen resten. Kaster
 * aldri — en sletting som allerede har skjedd, skal ikke se mislykket ut.
 */
export async function deleteMediaFor(kind: MessageMediaTarget, targetIds: readonly string[]): Promise<void> {
  const ids = [...new Set(targetIds)]
  if (ids.length === 0) return
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const rows = await db()
        .select({ id: messageMedia.id, r2Key: messageMedia.r2Key })
        .from(messageMedia)
        .where(and(eq(messageMedia.targetKind, kind), inArray(messageMedia.targetId, ids.slice(i, i + 90))))
      await deleteRows(rows)
    }
  } catch (err) {
    console.error('[bilder] kunne ikke slette bilder:', err)
  }
}

/** Fjerner et opplastet, ikke sendt bilde (krysset vekk i skrivefeltet). Bare eierens eget. */
export async function discardPendingMedia(id: string, ownerId: string): Promise<boolean> {
  return (await deletePendingWhere(sql`${messageMedia.id} = ${id} and ${messageMedia.ownerId} = ${ownerId}`)) > 0
}

/** Hvor mange opplastede, ikke sendte bilder medlemmet har liggende. */
export async function pendingMediaCount(ownerId: string): Promise<number> {
  const row = await db()
    .select({ n: sql<number>`count(*)` })
    .from(messageMedia)
    .where(and(eq(messageMedia.ownerId, ownerId), isNull(messageMedia.targetId)))
    .get()
  return row?.n ?? 0
}

/** Maks rader per slag per kjøring — langt under grensene for underforespørsler. */
const SWEEP_LIMIT = 200

/**
 * Daglig rydding (cron). Tar bort:
 *
 * - bilder som ble lastet opp, men aldri sendt (eldre enn et døgn), og
 * - bilder som står i noe som ikke finnes lenger: en slettet melding eller
 *   kommentar (også et «slettet»-merke), eller kommentarene på et slettet
 *   innlegg — de forsvinner med cascade uten å gå innom koden her.
 *
 * Det andre krever at koblingen er minst en time gammel: et bilde kobles før
 * raden det står i skrives, og ryddingen skal aldri treffe det øyeblikket.
 * Utkastene slettes med `deletePendingWhere` (raden først, atomisk mot en
 * kobling som skjer samtidig). Begrenset per kjøring; resten tas neste dag.
 */
export async function sweepMessageMedia(now = Date.now()): Promise<number> {
  try {
    const pendingBefore = now - PENDING_MEDIA_TTL_MS
    const attachedBefore = now - ORPHAN_MEDIA_GRACE_MS
    const pending = await deletePendingWhere(
      sql`${messageMedia.id} in (select id from message_media where target_id is null and created_at < ${pendingBefore} limit ${SWEEP_LIMIT})`,
    )
    const rows = await db()
      .select({ id: messageMedia.id, r2Key: messageMedia.r2Key })
      .from(messageMedia)
      .where(
        sql`${messageMedia.targetId} is not null and ${messageMedia.attachedAt} < ${attachedBefore} and (
            (${messageMedia.targetKind} = 'forum_topic' and not exists (select 1 from forum_topics t where t.id = ${messageMedia.targetId} and t.deleted_at is null))
            or (${messageMedia.targetKind} = 'forum_reply' and not exists (select 1 from forum_replies r where r.id = ${messageMedia.targetId} and r.deleted_at is null))
            or (${messageMedia.targetKind} = 'post_comment' and not exists (select 1 from post_comments c where c.id = ${messageMedia.targetId} and c.deleted_at is null))
            or (${messageMedia.targetKind} = 'board_message' and not exists (select 1 from board_messages m where m.id = ${messageMedia.targetId}))
            or (${messageMedia.targetKind} = 'leader_message' and not exists (select 1 from leader_messages m where m.id = ${messageMedia.targetId}))
          )`,
      )
      .limit(SWEEP_LIMIT)
    await deleteRows(rows)
    return pending + rows.length
  } catch (err) {
    console.error('[bilder] daglig rydding feilet:', err)
    return 0
  }
}

