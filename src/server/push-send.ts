import { env } from 'cloudflare:workers'
import { and, eq, gt, gte, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { postReads, posts, pushSubscriptions, session } from '../db/schema'
import type { PushMessage } from '../lib/push'
import { unreadSince } from '../lib/unread'
import { type VapidKeys, encryptPushPayload, isAllowedPushEndpoint, vapidAuthorization } from '../lib/web-push'

/**
 * Utsending av Web Push. Bare hjelpefunksjoner — modulen rører
 * `cloudflare:workers` og importeres derfor aldri fra en rutekomponent (samme
 * felle som `post-images.ts`). Kalles fra `posts.ts` (beskjeder og omtaler) og
 * `push-reminders.ts` (påminnelse om oppmøte).
 *
 * Push er alltid et tillegg: en feil her skal aldri velte publiseringen eller
 * kommentaren som utløste den. Alt fanges og logges.
 */

/** Mange samtidige forespørsler mot push-tjenestene er unødvendig; fem om gangen holder. */
const BATCH = 5
/** Lenger enn dette svarer ingen frisk push-tjeneste. */
const PUSH_TIMEOUT_MS = 8000

export function vapidKeys(): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  // `sub` er hvem push-tjenesten kan kontakte. Apple krever mailto: eller https:;
  // internsidens egen adresse er begge deler kjent og offentlig.
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: new URL(env.BETTER_AUTH_URL).origin }
}

export function pushConfigured(): boolean {
  return vapidKeys() !== null
}

type Subscription = typeof pushSubscriptions.$inferSelect

/**
 * Sender én melding til alle enhetene til hver bruker. `message` kan være en
 * funksjon når innholdet varierer per mottaker (tallet på app-ikonet).
 */
export async function sendPushToUsers(
  userIds: string[],
  message: PushMessage | ((userId: string) => PushMessage),
  opts: { ttl: number; urgency?: 'normal' | 'high' },
): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 }
  const vapid = vapidKeys()
  const unique = [...new Set(userIds)]
  if (!vapid || unique.length === 0) return result

  const d = db()
  const subscriptions: Subscription[] = []
  const now = new Date()
  // D1 har et tak på bundne parametere per spørring. Bare enheter med en aktiv
  // innlogging får varsler (`pushSubscriptions.sessionId`): en utløpt økt betyr
  // at ingen er logget inn der lenger.
  for (let i = 0; i < unique.length; i += 80) {
    const rows = await d
      .select({ sub: pushSubscriptions })
      .from(pushSubscriptions)
      .innerJoin(session, eq(session.id, pushSubscriptions.sessionId))
      .where(and(inArray(pushSubscriptions.userId, unique.slice(i, i + 80)), gt(session.expiresAt, now)))
    subscriptions.push(...rows.map((r) => r.sub))
  }

  const gone: string[] = []
  const delivered: string[] = []
  for (let i = 0; i < subscriptions.length; i += BATCH) {
    const batch = subscriptions.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map((sub) => deliver(sub, typeof message === 'function' ? message(sub.userId) : message, vapid, opts)),
    )
    settled.forEach((res, j) => {
      const sub = batch[j]!
      if (res.status === 'fulfilled' && res.value === 'ok') {
        result.sent += 1
        delivered.push(sub.id)
      } else if (res.status === 'fulfilled' && res.value === 'gone') {
        result.removed += 1
        gone.push(sub.id)
      } else {
        result.failed += 1
        if (res.status === 'rejected') console.error('[push] utsending feilet:', res.reason)
      }
    })
  }

  // D1 tillater 100 bundne parametere per spørring; oppdateringen binder i
  // tillegg tidspunktet. 80 om gangen holder god avstand.
  for (let i = 0; i < gone.length; i += 80) {
    await d.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone.slice(i, i + 80)))
  }
  const deliveredAt = new Date()
  for (let i = 0; i < delivered.length; i += 80) {
    await d
      .update(pushSubscriptions)
      .set({ lastSuccessAt: deliveredAt })
      .where(inArray(pushSubscriptions.id, delivered.slice(i, i + 80)))
  }
  return result
}

async function deliver(
  sub: Subscription,
  message: PushMessage,
  vapid: VapidKeys,
  opts: { ttl: number; urgency?: 'normal' | 'high' },
): Promise<'ok' | 'gone' | 'failed'> {
  // Lagret før listen fantes, eller endret i databasen: ikke send.
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'gone'
  const body = await encryptPushPayload(new TextEncoder().encode(JSON.stringify(message)), {
    p256dh: sub.p256dh,
    auth: sub.auth,
  })
  const response = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl),
      Urgency: opts.urgency ?? 'normal',
    },
    body,
    // Utsendingen skjer mens publiseringen venter. En push-tjeneste som henger,
    // skal ikke holde igjen svaret — eller omtale-e-postene som sendes etterpå.
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  })
  if (response.ok) return 'ok'
  // 404/410: abonnementet finnes ikke lenger (appen er slettet, varsler slått av).
  if (response.status === 404 || response.status === 410) return 'gone'
  console.error(`[push] ${new URL(sub.endpoint).hostname} svarte ${response.status}: ${await response.text().catch(() => '')}`)
  return 'failed'
}

/**
 * Uleste beskjeder per mottaker, til tallet på app-ikonet. Samme regel som
 * `unreadPostCount` (src/server/unread.ts), men for mange på én gang.
 */
export async function unreadCountsFor(
  users: Array<{ userId: string; canSeeBoardPosts: boolean }>,
  now = Date.now(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (users.length === 0) return counts
  const d = db()
  const recent = await d
    .select({ id: posts.id, authorId: posts.authorId, audience: posts.audience })
    .from(posts)
    .where(and(isNotNull(posts.publishedAt), gte(posts.publishedAt, new Date(unreadSince(now)))))
  if (recent.length === 0) return counts

  const read = new Set<string>()
  const postIds = recent.map((p) => p.id)
  const userIds = users.map((u) => u.userId)
  // D1 tillater 100 bundne parametere per spørring: 40 brukere × 50 innlegg.
  for (let i = 0; i < userIds.length; i += 40) {
    for (let j = 0; j < postIds.length; j += 50) {
      const rows = await d
        .select({ postId: postReads.postId, userId: postReads.userId })
        .from(postReads)
        .where(and(inArray(postReads.userId, userIds.slice(i, i + 40)), inArray(postReads.postId, postIds.slice(j, j + 50))))
      for (const r of rows) read.add(`${r.userId}:${r.postId}`)
    }
  }
  for (const u of users) {
    let n = 0
    for (const p of recent) {
      if (p.authorId === u.userId) continue
      if (p.audience === 'board' && !u.canSeeBoardPosts) continue
      if (!read.has(`${u.userId}:${p.id}`)) n += 1
    }
    counts.set(u.userId, n)
  }
  return counts
}
