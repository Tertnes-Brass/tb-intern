import { describe, expect, it } from 'vitest'
import {
  SOCIAL_CAPACITY_MAX,
  type SocialListItem,
  canEditSocialEvent,
  mergeCalendarRows,
  sanitizeSocialInput,
  signupState,
  socialCounts,
  socialSummary,
  splitByCapacity,
  spotsLeft,
} from './social'

const arrangor = { id: 'u-ingrid', permissions: ['scores.view'] }
const annetMedlem = { id: 'u-jonas', permissions: ['scores.view'] }
const moderator = { id: 'u-kari', permissions: ['members.manage'] }
const admin = { id: 'u-admin', permissions: ['*'] }

const gyldig = { title: 'Julebord', startDate: '2026-12-12', startTime: '19:00' }

describe('sanitizeSocialInput', () => {
  it('normaliserer feltene og gjør veggklokke om til UTC', () => {
    const value = sanitizeSocialInput({
      ...gyldig,
      title: '  Julebord  ',
      description: '  Tre retter, 450 kr  ',
      location: '  Kafé Sanden  ',
    })
    expect(value.title).toBe('Julebord')
    expect(value.description).toBe('Tre retter, 450 kr')
    expect(value.location).toBe('Kafé Sanden')
    expect(new Date(value.startsAt).toISOString()).toBe('2026-12-12T18:00:00.000Z')
    expect(value.signupDeadline).toBeNull()
    expect(value.capacity).toBeNull()
  })

  it('krever tittel og et gyldig tidspunkt', () => {
    expect(() => sanitizeSocialInput({ ...gyldig, title: '   ' })).toThrow(/tittel/i)
    expect(() => sanitizeSocialInput({ ...gyldig, startDate: '' })).toThrow(/dato/i)
    expect(() => sanitizeSocialInput({ ...gyldig, startTime: '99:99' })).toThrow(/dato/i)
  })

  it('tomme valgfrie felt blir null, ikke tom streng', () => {
    const value = sanitizeSocialInput({ ...gyldig, description: '   ', location: '', capacity: '' })
    expect(value.description).toBeNull()
    expect(value.location).toBeNull()
    expect(value.capacity).toBeNull()
  })

  it('fristen går ut ved slutten av dagen den er satt til', () => {
    const value = sanitizeSocialInput({ ...gyldig, deadlineDate: '2026-12-05' })
    expect(new Date(value.signupDeadline!).toISOString()).toBe('2026-12-05T22:59:00.000Z')
  })

  it('frist samme dag som arrangementet går ut når det starter — ikke ved midnatt etterpå', () => {
    const value = sanitizeSocialInput({ ...gyldig, deadlineDate: '2026-12-12' })
    expect(value.signupDeadline).toBe(value.startsAt)
  })

  it('avviser en frist etter at arrangementet starter', () => {
    expect(() => sanitizeSocialInput({ ...gyldig, deadlineDate: '2026-12-13' })).toThrow(/frist/i)
  })

  it('godtar maks antall som tall eller streng, og avviser tull', () => {
    expect(sanitizeSocialInput({ ...gyldig, capacity: '20' }).capacity).toBe(20)
    expect(sanitizeSocialInput({ ...gyldig, capacity: 20 }).capacity).toBe(20)
    expect(() => sanitizeSocialInput({ ...gyldig, capacity: '0' })).toThrow(/maks antall/i)
    expect(() => sanitizeSocialInput({ ...gyldig, capacity: '-5' })).toThrow(/maks antall/i)
    expect(() => sanitizeSocialInput({ ...gyldig, capacity: '2,5' })).toThrow(/maks antall/i)
    expect(() => sanitizeSocialInput({ ...gyldig, capacity: String(SOCIAL_CAPACITY_MAX + 1) })).toThrow(/maks antall/i)
  })

  it('lar et tidspunkt i fortiden stå — en gammel dugnad skal kunne rettes', () => {
    expect(() => sanitizeSocialInput({ ...gyldig, startDate: '2020-01-01' })).not.toThrow()
  })
})

describe('canEditSocialEvent', () => {
  const event = { hostUserId: arrangor.id }

  it('arrangøren kan endre sitt eget', () => {
    expect(canEditSocialEvent(arrangor, event)).toBe(true)
  })

  it('et annet medlem kan ikke', () => {
    expect(canEditSocialEvent(annetMedlem, event)).toBe(false)
  })

  it('moderator og admin kan uansett', () => {
    expect(canEditSocialEvent(moderator, event)).toBe(true)
    expect(canEditSocialEvent(admin, event)).toBe(true)
  })

  it('en arrangør som er slettet gjør ikke arrangementet til alles', () => {
    expect(canEditSocialEvent(annetMedlem, { hostUserId: null })).toBe(false)
    expect(canEditSocialEvent(moderator, { hostUserId: null })).toBe(true)
  })

  it('ingen innlogget bruker gir aldri skriverett', () => {
    expect(canEditSocialEvent(null, event)).toBe(false)
  })
})

describe('signupState', () => {
  const start = Date.parse('2026-12-12T18:00:00Z')
  const frist = Date.parse('2026-12-05T22:59:00Z')
  const apen = { startsAt: start, signupDeadline: frist, cancelledAt: null }

  it('er åpen før fristen', () => {
    const state = signupState(apen, Date.parse('2026-12-01T10:00:00Z'))
    expect(state.open).toBe(true)
    expect(state.allowed).toEqual(['attending', 'not_attending', 'unsure'])
    expect(state.canClear).toBe(true)
    expect(state.message).toBe('')
  })

  it('lar deg melde avbud — men ikke på — etter fristen', () => {
    const state = signupState(apen, Date.parse('2026-12-06T10:00:00Z'))
    expect(state.open).toBe(false)
    expect(state.allowed).toEqual(['not_attending'])
    expect(state.canClear).toBe(false)
    expect(state.message).toMatch(/frist/i)
  })

  it('er åpen helt til start når ingen frist er satt', () => {
    const utenFrist = { startsAt: start, signupDeadline: null, cancelledAt: null }
    expect(signupState(utenFrist, start - 1).open).toBe(true)
    expect(signupState(utenFrist, start).open).toBe(false)
  })

  it('låser svaret når arrangementet har startet', () => {
    const state = signupState(apen, start + 1)
    expect(state.allowed).toEqual([])
    expect(state.message).toMatch(/vært/i)
  })

  it('avlyst slår alt annet — også en frist som ennå ikke har gått ut', () => {
    const avlyst = { ...apen, cancelledAt: Date.parse('2026-12-01T09:00:00Z') }
    const state = signupState(avlyst, Date.parse('2026-12-01T10:00:00Z'))
    expect(state.allowed).toEqual([])
    expect(state.message).toMatch(/avlyst/i)
  })
})

describe('splitByCapacity', () => {
  const rad = (userId: string, attendingSince: number | null) => ({ userId, attendingSince })

  it('førstemann til mølla — sortert på når svaret ble «kommer»', () => {
    const { going, waitlist } = splitByCapacity([rad('c', 300), rad('a', 100), rad('b', 200)], 2)
    expect(going.map((r) => r.userId)).toEqual(['a', 'b'])
    expect(waitlist.map((r) => r.userId)).toEqual(['c'])
  })

  it('uten maks antall er alle med', () => {
    const { going, waitlist } = splitByCapacity([rad('a', 100), rad('b', 200)], null)
    expect(going).toHaveLength(2)
    expect(waitlist).toHaveLength(0)
  })

  it('den som melder avbud og ombestemmer seg havner bakerst', () => {
    // Ingrid svarte først (100), meldte avbud, og svarte «kommer» igjen (400).
    const { going, waitlist } = splitByCapacity([rad('ingrid', 400), rad('jonas', 200), rad('kari', 300)], 2)
    expect(going.map((r) => r.userId)).toEqual(['jonas', 'kari'])
    expect(waitlist.map((r) => r.userId)).toEqual(['ingrid'])
  })

  it('er stabil ved likt tidsstempel, så lista ikke hopper mellom to lesinger', () => {
    const først = splitByCapacity([rad('b', 100), rad('a', 100)], 1)
    const igjen = splitByCapacity([rad('a', 100), rad('b', 100)], 1)
    expect(først.going.map((r) => r.userId)).toEqual(igjen.going.map((r) => r.userId))
  })

  it('endrer ikke lista den fikk inn', () => {
    const input = [rad('c', 300), rad('a', 100)]
    splitByCapacity(input, 1)
    expect(input.map((r) => r.userId)).toEqual(['c', 'a'])
  })
})

describe('socialCounts, spotsLeft og socialSummary', () => {
  const rows = [
    { userId: 'a', status: 'attending' as const, attendingSince: 100 },
    { userId: 'b', status: 'attending' as const, attendingSince: 200 },
    { userId: 'c', status: 'attending' as const, attendingSince: 300 },
    { userId: 'd', status: 'unsure' as const, attendingSince: null },
    { userId: 'e', status: 'not_attending' as const, attendingSince: null },
  ]

  it('teller påmeldte, venteliste, avbud og usikre', () => {
    expect(socialCounts(rows, 2)).toEqual({ going: 2, waitlist: 1, notAttending: 1, unsure: 1 })
    expect(socialCounts(rows, null)).toEqual({ going: 3, waitlist: 0, notAttending: 1, unsure: 1 })
  })

  it('ledige plasser er null uten tak, og aldri negativt', () => {
    expect(spotsLeft(socialCounts(rows, null), null)).toBeNull()
    expect(spotsLeft(socialCounts(rows, 2), 2)).toBe(0)
    expect(spotsLeft(socialCounts(rows, 5), 5)).toBe(2)
  })

  it('antallet vises alltid — også når ingen har svart', () => {
    expect(socialSummary(socialCounts([], null), null)).toBe('0 påmeldt')
    expect(socialSummary(socialCounts([], 20), 20)).toBe('0 av 20 plasser')
  })

  it('nevner venteliste og usikre bare når de finnes', () => {
    expect(socialSummary(socialCounts(rows, 2), 2)).toBe('2 av 2 plasser · 1 på venteliste · 1 usikker')
    expect(socialSummary(socialCounts(rows, null), null)).toBe('3 påmeldt · 1 usikker')
  })
})

describe('mergeCalendarRows', () => {
  const social = (id: string, start: string): SocialListItem => ({
    id,
    title: id,
    start,
    location: null,
    cancelled: false,
    going: 0,
    waitlist: 0,
    capacity: null,
    myStatus: null,
  })

  it('sorterer feed-hendelser og sosiale arrangement inn i én liste', () => {
    const rows = mergeCalendarRows(
      [
        { id: 'ovelse-1', start: '2026-12-09T18:00:00.000Z' },
        { id: 'konsert', start: '2026-12-20T18:00:00.000Z' },
      ],
      [social('julebord', '2026-12-12T18:00:00.000Z'), social('fjelltur', '2026-12-01T09:00:00.000Z')],
    )
    expect(rows.map((r) => r.id)).toEqual(['fjelltur', 'ovelse-1', 'julebord', 'konsert'])
    expect(rows.map((r) => r.kind)).toEqual(['social', 'feed', 'social', 'feed'])
  })

  it('feed-hendelsen kommer først ved likt tidspunkt — øvelsen er avtalen, puben er tillegget', () => {
    const rows = mergeCalendarRows(
      [{ id: 'ovelse', start: '2026-12-09T18:00:00.000Z' }],
      [social('pub', '2026-12-09T18:00:00.000Z')],
    )
    expect(rows.map((r) => r.id)).toEqual(['ovelse', 'pub'])
  })

  it('tåler at den ene siden er tom', () => {
    expect(mergeCalendarRows([], [social('pub', '2026-12-09T18:00:00.000Z')])).toHaveLength(1)
    expect(mergeCalendarRows([{ id: 'a', start: '2026-12-09T18:00:00.000Z' }], [])).toHaveLength(1)
  })
})
