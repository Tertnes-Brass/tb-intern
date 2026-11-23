import { describe, expect, it } from 'vitest'
import { toOsloDate } from './format'
import { START_TIME_PATTERN, firstUnfinished, gigCalendarEvent, mergeGigEvents } from './gig-calendar'

const gig = { id: 'p1', name: 'Julebord', eventDate: '2026-12-12', startTime: '18:30', venue: 'Hotellet', description: null }

describe('gigCalendarEvent', () => {
  it('tolker klokkeslettet i norsk tid, vinter og sommer', () => {
    expect(gigCalendarEvent(gig).start).toBe('2026-12-12T17:30:00.000Z')
    expect(gigCalendarEvent({ ...gig, eventDate: '2026-06-12' }).start).toBe('2026-06-12T16:30:00.000Z')
  })
  it('blir en heldagshendelse på riktig dag uten klokkeslett', () => {
    const event = gigCalendarEvent({ ...gig, startTime: null })
    expect(event.allDay).toBe(true)
    expect(toOsloDate(event.start)).toBe('2026-12-12')
    expect(toOsloDate(Date.parse(event.end!) - 1)).toBe('2026-12-12')
  })
  it('lenker til prosjektet', () => {
    expect(gigCalendarEvent(gig).projectId).toBe('p1')
  })
})

describe('fletting', () => {
  const at = (id: string, start: string, end: string | null = null) => ({ id, start, end })
  it('setter oppdraget inn kronologisk og beholder feedens rekkefølge', () => {
    const merged = mergeGigEvents(
      [at('a', '2026-12-01T18:00:00Z'), at('b', '2026-12-20T18:00:00Z')],
      [at('gig', '2026-12-12T17:30:00Z')],
    )
    expect(merged.map((e) => e.id)).toEqual(['a', 'gig', 'b'])
  })
  it('finner første hendelse som ikke er over', () => {
    const events = [at('over', '2026-12-01T18:00:00Z'), at('neste', '2026-12-12T17:30:00Z')]
    expect(firstUnfinished(events, Date.parse('2026-12-05T00:00:00Z'))?.id).toBe('neste')
    expect(firstUnfinished(events, Date.parse('2027-01-01T00:00:00Z'))).toBeNull()
  })
})

it('godtar bare gyldige klokkeslett', () => {
  expect(START_TIME_PATTERN.test('09:05')).toBe(true)
  expect(START_TIME_PATTERN.test('24:00')).toBe(false)
  expect(START_TIME_PATTERN.test('9:05')).toBe(false)
})
