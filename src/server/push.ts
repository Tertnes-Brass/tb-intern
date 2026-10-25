import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { notificationPreferences, pushSubscriptions } from '../db/schema'
import { newId } from '../lib/id'
import { PUSH_TTL, RSVP_REMINDER_CHOICES, deviceLabel } from '../lib/push'
import { isAllowedPushEndpoint } from '../lib/web-push'
import { requireMe } from './access'
import { getAuth } from './auth-instance'
import { pushConfigured, sendPushToUsers, vapidKeys } from './push-send'

/**
 * Web Push for denne enheten: slå på, slå av, prøv. Kun server functions og
 * typer eksporteres herfra — utsendingen bor i `push-send.ts`.
 *
 * Et abonnement tilhører én bruker. Logger noen andre inn på samme enhet og
 * slår på varsler, flyttes raden (samme `endpoint`) til dem; ved utlogging
 * sletter klienten sin egen rad før økten avsluttes (`signOutHere`).
 */

/** Flere enheter enn dette per medlem gir ingen mening; de eldste slettes. */
const MAX_DEVICES = 10

/**
 * Økten forespørselen kom med. Abonnementet knyttes til den (CASCADE), så
 * varslene stopper når økten avsluttes — se `pushSubscriptions.sessionId`.
 */
async function currentSessionId(): Promise<string | null> {
  const result = await getAuth().api.getSession({ headers: getRequest().headers })
  return result?.session?.id ?? null
}

/** Den offentlige VAPID-nøkkelen nettleseren trenger, eller null når push er av. */
export const getPushConfig = createServerFn().handler(async () => {
  await requireMe()
  const vapid = vapidKeys()
  return { publicKey: vapid?.publicKey ?? null }
})

const subscriptionInput = z.object({
  endpoint: z
    .string()
    .url()
    .max(1024)
    .refine(isAllowedPushEndpoint, 'Ukjent push-tjeneste'),
  keys: z.object({
    // 65 byte → 87 tegn base64url; 16 byte → 22 tegn.
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{21,24}$/),
  }),
})

export const savePushSubscription = createServerFn({ method: 'POST' })
  .validator(subscriptionInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (!pushConfigured()) throw new Error('Varsler er ikke satt opp på serveren ennå')
    const label = deviceLabel(getRequest().headers.get('user-agent'))
    const sessionId = await currentSessionId()
    await db()
      .insert(pushSubscriptions)
      .values({
        id: newId(),
        userId: me.id,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        label,
        createdAt: new Date(),
        sessionId,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // createdAt nullstilles: for taket under er dette nå den nyeste enheten.
        set: { userId: me.id, p256dh: data.keys.p256dh, auth: data.keys.auth, label, createdAt: new Date(), sessionId },
      })
    // Et tak per medlem: hver publisering sender til alle radene, og ingen har
    // flere enn en håndfull enheter. De eldste ryker først.
    const surplus = await db()
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, me.id))
      .orderBy(desc(pushSubscriptions.createdAt))
      .offset(MAX_DEVICES)
      .limit(50)
    if (surplus.length > 0) {
      await db()
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.id, surplus.map((r) => r.id)))
    }
    return { ok: true }
  })

/**
 * Ved oppstart av appen: oppdater nøklene for denne enhetens abonnement — men
 * bare hvis raden allerede er DIN. `savePushSubscription` flytter raden fordi
 * den er en bevisst handling («slå på varsler»); denne skal aldri gi noen push
 * de ikke har bedt om. Hører raden til en annen bruker (forrige bruker av en
 * delt iPad, som aldri logget ut), slettes den: de varslene skal ikke vises
 * her lenger. Klienten avslutter da abonnementet lokalt.
 */
export const refreshPushSubscription = createServerFn({ method: 'POST' })
  .validator(subscriptionInput)
  .handler(async ({ data }): Promise<{ status: 'ok' | 'missing' | 'other' }> => {
    const me = await requireMe()
    const d = db()
    const row = (
      await d
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, data.endpoint))
        .limit(1)
    )[0]
    if (!row) return { status: 'missing' }
    if (row.userId !== me.id) {
      await d.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, data.endpoint))
      return { status: 'other' }
    }
    // Ny innlogging på samme enhet: abonnementet følger den nye økten.
    await d
      .update(pushSubscriptions)
      .set({ p256dh: data.keys.p256dh, auth: data.keys.auth, sessionId: await currentSessionId() })
      .where(and(eq(pushSubscriptions.endpoint, data.endpoint), eq(pushSubscriptions.userId, me.id)))
    return { status: 'ok' }
  })

/** Bare egne abonnement kan slettes — `endpoint` alene gir ingen rett. */
export const deletePushSubscription = createServerFn({ method: 'POST' })
  .validator(z.object({ endpoint: z.string().max(1024) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, data.endpoint), eq(pushSubscriptions.userId, me.id)))
    return { ok: true }
  })

/** «Send et prøvevarsel» — til alle enhetene dine, så du ser at det virker. */
export const sendTestPush = createServerFn({ method: 'POST' }).handler(async () => {
  const me = await requireMe()
  const result = await sendPushToUsers(
    [me.id],
    { title: 'Varsler er på', body: 'Slik ser et varsel fra Tertnes Brass Intern ut.', url: '/min-profil#varsler', tag: 'test' },
    { ttl: PUSH_TTL.rsvp },
  )
  return result
})

/** Enhetene som tar imot varsler, til lista på /min-profil. */
export const listMyPushDevices = createServerFn().handler(async () => {
  const me = await requireMe()
  const rows = await db()
    .select({
      endpoint: pushSubscriptions.endpoint,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, me.id))
  const prefs = await db()
    .select({ rsvpReminders: notificationPreferences.rsvpReminders })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, me.id))
    .limit(1)
  return {
    configured: pushConfigured(),
    rsvpReminders: prefs[0]?.rsvpReminders ?? 'all',
    devices: rows.map((r) => ({
      endpoint: r.endpoint,
      label: r.label ?? 'Ukjent enhet',
      createdAt: r.createdAt.getTime(),
      lastSuccessAt: r.lastSuccessAt?.getTime() ?? null,
    })),
  }
})

/** Påminnelse om oppmøte dagen før (kun push). Ingen rad = på. */
export const updateMyRsvpReminders = createServerFn({ method: 'POST' })
  .validator(z.object({ rsvpReminders: z.enum(RSVP_REMINDER_CHOICES) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, rsvpReminders: data.rsvpReminders })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { rsvpReminders: data.rsvpReminders } })
    return { ok: true }
  })
