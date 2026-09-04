import { and, asc, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../db'
import { socialEvents, socialSignups } from '../db/schema'
import { calendarWindow } from '../lib/calendar-window'
import { type SocialListItem, socialCounts } from '../lib/social'

/**
 * De sosiale arrangementene (#31) slik LISTENE trenger dem — kalenderlista på
 * `/kalender` og «Kommende» på hub-en.
 *
 * Egen modul uten serverfunksjoner, av samme grunn som `calendar-feed.ts`:
 * `calendar.ts`, `hub.ts` og `social.ts` skal kunne dele akkurat denne
 * spørringen, og en serverfunksjon kaller aldri en annen serverfunksjon.
 *
 * **Samme tidsvindu som feeden** (`calendarWindow`): fra i går og fire måneder
 * frem. Det er en bevisst begrensning — «De neste fire månedene» står som
 * overskrift over lista, og et julebord ti måneder frem ville gjort den
 * overskriften usann. Arrangementet finnes fortsatt, det er bare ikke kommet
 * inn i vinduet ennå.
 */
export async function loadSocialEvents(now: number, viewerId: string): Promise<SocialListItem[]> {
  const d = db()
  const window = calendarWindow(now)

  const events = await d
    .select({
      id: socialEvents.id,
      title: socialEvents.title,
      startsAt: socialEvents.startsAt,
      location: socialEvents.location,
      capacity: socialEvents.capacity,
      cancelledAt: socialEvents.cancelledAt,
    })
    .from(socialEvents)
    .where(and(gte(socialEvents.startsAt, new Date(window.from)), lte(socialEvents.startsAt, new Date(window.to))))
    .orderBy(asc(socialEvents.startsAt))
  if (events.length === 0) return []

  // Alle svarene for arrangementene i vinduet, i én spørring. Tallene regnes i
  // `socialCounts`, ikke i SQL: fordelingen mellom plass og venteliste er en
  // regel (`splitByCapacity`), og den skal finnes ett sted.
  const signups = await d
    .select({
      socialEventId: socialSignups.socialEventId,
      userId: socialSignups.userId,
      status: socialSignups.status,
      attendingSince: socialSignups.attendingSince,
    })
    .from(socialSignups)
    .where(inArray(socialSignups.socialEventId, events.map((e) => e.id)))

  const byEvent = new Map<string, typeof signups>()
  for (const row of signups) {
    byEvent.set(row.socialEventId, [...(byEvent.get(row.socialEventId) ?? []), row])
  }

  return events.map((event): SocialListItem => {
    const rows = byEvent.get(event.id) ?? []
    const counts = socialCounts(
      rows.map((r) => ({ userId: r.userId, status: r.status, attendingSince: r.attendingSince?.getTime() ?? null })),
      event.capacity,
    )
    return {
      id: event.id,
      title: event.title,
      start: event.startsAt.toISOString(),
      location: event.location,
      cancelled: event.cancelledAt !== null,
      going: counts.going,
      waitlist: counts.waitlist,
      capacity: event.capacity,
      myStatus: rows.find((r) => r.userId === viewerId)?.status ?? null,
    }
  })
}
