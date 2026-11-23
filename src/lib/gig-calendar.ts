import { type CalendarEvent, floatingToUtc } from './ical'

/**
 * Spilleoppdrag i kalenderen. De står ikke i Google-kalenderen, som alle ser,
 * men legges oppå feeden bare for dem som er med. Raden lenker til prosjektet
 * (`projectId`), og har verken øvingsplan eller oppmøte.
 */
export type AgendaEvent = CalendarEvent & { projectId?: string }

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

export function gigCalendarEvent(gig: GigRow): AgendaEvent {
  const [year = 0, month = 1, day = 1] = gig.eventDate.split('-').map(Number)
  const [hour = 0, minute = 0] = (gig.startTime ?? '00:00').split(':').map(Number)
  const start = floatingToUtc(Date.UTC(year, month - 1, day, hour, minute), TIME_ZONE)
  // Uten klokkeslett er det en heldagshendelse, med slutt ved neste midnatt som i feeden.
  const end = gig.startTime ? null : floatingToUtc(Date.UTC(year, month - 1, day + 1), TIME_ZONE)
  const key = `gig:${gig.id}`
  return {
    id: key,
    occurrenceKey: key,
    uid: key,
    title: gig.name,
    start: new Date(start).toISOString(),
    end: end === null ? null : new Date(end).toISOString(),
    allDay: !gig.startTime,
    location: gig.venue,
    description: gig.description,
    url: null,
    projectId: gig.id,
  }
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
