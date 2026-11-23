import { type CalendarEvent, floatingToUtc } from './ical'

/**
 * Spilleoppdrag i kalenderen. De står ikke i Google-kalenderen, som alle ser,
 * men legges oppå feeden bare for dem som er med. Raden lenker til prosjektet
 * (`projectId`), og har verken øvingsplan eller oppmøte. En dugnad fra «Kan du?»
 * står for alle og lenker til innlegget (`postId`), der svarene er.
 */
export type AgendaEvent = CalendarEvent & { projectId?: string; postId?: string }

/** Rader som ikke hører til Google-feeden, og derfor ikke kan åpnes i kalenderens panel. */
export function isLocalEvent(event: { projectId?: string; postId?: string }): boolean {
  return !!event.projectId || !!event.postId
}

export type GigRow = {
  id: string
  name: string
  eventDate: string
  startTime: string | null
  venue: string | null
  description: string | null
}

const TIME_ZONE = 'Europe/Oslo'

export const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function localEvent(
  key: string,
  row: { title: string; eventDate: string; startTime: string | null; location: string | null; description: string | null },
): AgendaEvent {
  const [year = 0, month = 1, day = 1] = row.eventDate.split('-').map(Number)
  const [hour = 0, minute = 0] = (row.startTime ?? '00:00').split(':').map(Number)
  const start = floatingToUtc(Date.UTC(year, month - 1, day, hour, minute), TIME_ZONE)
  // Uten klokkeslett er det en heldagshendelse, med slutt ved neste midnatt som i feeden.
  const end = row.startTime ? null : floatingToUtc(Date.UTC(year, month - 1, day + 1), TIME_ZONE)
  return {
    id: key,
    occurrenceKey: key,
    uid: key,
    title: row.title,
    start: new Date(start).toISOString(),
    end: end === null ? null : new Date(end).toISOString(),
    allDay: !row.startTime,
    location: row.location,
    description: row.description,
    url: null,
  }
}

export function gigCalendarEvent(gig: GigRow): AgendaEvent {
  return {
    ...localEvent(`gig:${gig.id}`, { ...gig, title: gig.name, location: gig.venue }),
    projectId: gig.id,
  }
}

export function dugnadCalendarEvent(row: {
  postId: string
  title: string
  eventDate: string
  startTime: string | null
  location: string | null
}): AgendaEvent {
  return { ...localEvent(`dugnad:${row.postId}`, { ...row, description: null }), postId: row.postId }
}

/** Fletter oppdragene inn i lista, kronologisk. Feeden beholder sin rekkefølge. */
export function mergeGigEvents<T extends { start: string }>(events: readonly T[], gigs: readonly T[]): T[] {
  if (gigs.length === 0) return [...events]
  return [...events, ...gigs]
    .map((event, index) => ({ event, index, at: Date.parse(event.start) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ event }) => event)
}

/** Første hendelse som ikke er over. */
export function firstUnfinished<T extends { start: string; end: string | null }>(events: readonly T[], now: number): T | null {
  return events.find((event) => Date.parse(event.end ?? event.start) >= now) ?? null
}
