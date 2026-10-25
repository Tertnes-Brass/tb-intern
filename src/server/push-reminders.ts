import { and, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { eventAttendance, memberProfiles, notificationPreferences, pushSubscriptions, settings } from '../db/schema'
import { shouldRunReminders } from '../lib/board'
import { formatTime, toOsloDate } from '../lib/format'
import { PUSH_TTL, type RsvpReminderChoice, rsvpReminderMessage, rsvpReminderRecipients } from '../lib/push'
import { loadCalendar } from './calendar-feed'
import { pushConfigured, sendPushToUsers } from './push-send'

/** `settings`-raden som gjør påminnelsen idempotent per kalenderdag. */
const RSVP_SETTINGS_KEY = 'push.rsvp.lastRunDate'

/**
 * «Kommer du i morgen?» — push dagen før hver hendelse med klokkeslett, til
 * medlemmer som har slått på varsler på en enhet og ikke har svart. Kjøres av
 * den daglige cron-en i `src/worker.ts` (07:00 UTC), og maks én gang per dag
 * (compare-and-set i `settings`, som for styrepåminnelsene).
 *
 * Heldagshendelser hoppes over: de er som regel ikke noe man møter opp til
 * (ferier, frister). Ingen e-post — det ville vært mas.
 */
export async function runRsvpReminders(now: Date = new Date()): Promise<{ ran: boolean; events: number; sent: number }> {
  const empty = { ran: false, events: 0, sent: 0 }
  try {
    if (!pushConfigured()) return empty
    const today = toOsloDate(now.getTime())
    const tomorrow = toOsloDate(now.getTime() + 24 * 60 * 60 * 1000)
    if (!today || !tomorrow) return empty
    if (!(await claimRun(today))) return empty

    const calendar = await loadCalendar(now.getTime())
    if (!calendar.configured || calendar.error) return { ...empty, ran: true }
    const events = calendar.events.filter((e) => !e.allDay && toOsloDate(e.start) === tomorrow)
    if (events.length === 0) return { ...empty, ran: true }

    const d = db()
    const subscribers = await d
      .selectDistinct({
        userId: pushSubscriptions.userId,
        isActive: memberProfiles.isActive,
        pref: notificationPreferences.rsvpReminders,
      })
      .from(pushSubscriptions)
      .innerJoin(memberProfiles, eq(memberProfiles.authUserId, pushSubscriptions.userId))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, pushSubscriptions.userId))
    if (subscribers.length === 0) return { ...empty, ran: true, events: events.length }

    let sent = 0
    for (const event of events) {
      // Én hendelse som feiler skal ikke ta med seg resten — dagen er allerede tatt.
      try {
        const answeredRows = await d
          .select({ userId: eventAttendance.userId })
          .from(eventAttendance)
          .where(eq(eventAttendance.occurrenceKey, event.occurrenceKey))
        const recipients = rsvpReminderRecipients({
          subscribers: subscribers.map((s) => ({ ...s, pref: (s.pref ?? null) as RsvpReminderChoice | null })),
          answered: new Set(answeredRows.map((r) => r.userId)),
        })
        if (recipients.length === 0) continue
        const result = await sendPushToUsers(
          recipients,
          rsvpReminderMessage({
            occurrenceKey: event.occurrenceKey,
            title: event.title,
            when: `i morgen kl. ${formatTime(event.start)}`,
          }),
          { ttl: PUSH_TTL.rsvp },
        )
        sent += result.sent
      } catch (err) {
        console.error(`[push] påminnelse for ${event.occurrenceKey} feilet:`, err)
      }
    }
    return { ran: true, events: events.length, sent }
  } catch (err) {
    // Cron-en skal aldri kaste: da prøver Cloudflare igjen, og dagen er allerede tatt.
    console.error('[push] påminnelse om oppmøte feilet:', err)
    return empty
  }
}

/** Samme compare-and-set som `claimRun` i board-notify.ts, med egen nøkkel. */
async function claimRun(today: string): Promise<boolean> {
  const d = db()
  const current =
    (await d.select({ value: settings.value }).from(settings).where(eq(settings.key, RSVP_SETTINGS_KEY)).limit(1))[0]
      ?.value ?? null
  if (!shouldRunReminders(current, today)) return false
  const result =
    current === null
      ? await d.insert(settings).values({ key: RSVP_SETTINGS_KEY, value: today }).onConflictDoNothing().run()
      : await d
          .update(settings)
          .set({ value: today })
          .where(and(eq(settings.key, RSVP_SETTINGS_KEY), ne(settings.value, today)))
          .run()
  const meta = (result as { meta?: { changes?: number; rows_written?: number } } | null)?.meta
  return (meta?.changes ?? meta?.rows_written ?? 0) === 1
}
