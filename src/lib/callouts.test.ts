import { describe, expect, it } from 'vitest'
import {
  calloutCountLabel,
  calloutMineLabel,
  calloutState,
  canCreateCallout,
  canManageCallout,
  normalizeCalloutNote,
  sanitizeCalloutInput,
} from './callouts'

const at = (iso: string) => Date.parse(iso)
const timing = { eventDate: '2026-12-12', startTime: '18:00', respondBy: '2026-12-01', closedAt: null }

describe('calloutState', () => {
  it('er åpent til og med fristdagen i norsk tid', () => {
    expect(calloutState(timing, at('2026-12-01T22:59:00Z')).phase).toBe('open')
    expect(calloutState(timing, at('2026-12-01T23:01:00Z')).phase).toBe('late')
  })
  it('lar deg bare si fra om at du ikke kan etter fristen', () => {
    const state = calloutState(timing, at('2026-12-05T12:00:00Z'))
    expect(state.allowed).toEqual(['no'])
    expect(state.canClear).toBe(false)
  })
  it('gjør det samme når svarene er stengt', () => {
    const state = calloutState({ ...timing, closedAt: 1 }, at('2026-11-25T12:00:00Z'))
    expect(state.phase).toBe('closed')
    expect(state.allowed).toEqual(['no'])
  })
  it('låser svaret når det har startet, i norsk tid', () => {
    expect(calloutState({ ...timing, respondBy: null }, at('2026-12-12T16:59:00Z')).phase).toBe('open')
    expect(calloutState({ ...timing, respondBy: null }, at('2026-12-12T17:00:00Z')).phase).toBe('past')
  })
  it('holder en dag uten klokkeslett åpen hele dagen', () => {
    const allDay = { ...timing, startTime: null, respondBy: null }
    expect(calloutState(allDay, at('2026-12-12T22:00:00Z')).phase).toBe('open')
    expect(calloutState(allDay, at('2026-12-12T23:30:00Z')).phase).toBe('past')
  })
})

describe('sanitizeCalloutInput', () => {
  it('krever en ekte dato på en dugnad', () => {
    expect(() => sanitizeCalloutInput({ kind: 'dugnad' })).toThrow('gyldig dato')
    expect(() => sanitizeCalloutInput({ kind: 'dugnad', eventDate: '2026-02-31' })).toThrow('gyldig dato')
  })
  it('godtar ikke en frist etter datoen', () => {
    expect(() => sanitizeCalloutInput({ kind: 'dugnad', eventDate: '2026-12-01', respondBy: '2026-12-02' })).toThrow('Svarfristen')
  })
  it('avviser et antall som ikke er et positivt heltall', () => {
    for (const needed of ['0', '-1', '2.5', 'mange']) {
      expect(() => sanitizeCalloutInput({ kind: 'dugnad', eventDate: '2026-12-01', needed })).toThrow('Antall')
    }
  })
  it('lagrer ikke dato, tid og sted på et knyttet oppdrag', () => {
    const values = sanitizeCalloutInput(
      { kind: 'spilleoppdrag', projectId: 'gig', eventDate: '1999-01-01', startTime: '10:00', location: 'Feil sted', respondBy: '2026-12-01' },
      '2026-12-12',
    )
    expect(values).toMatchObject({ projectId: 'gig', eventDate: null, startTime: null, location: null, respondBy: '2026-12-01' })
  })
  it('måler fristen mot datoen på oppdraget', () => {
    expect(() => sanitizeCalloutInput({ kind: 'spilleoppdrag', projectId: 'gig', respondBy: '2026-12-13' }, '2026-12-12')).toThrow('Svarfristen')
  })
})

describe('tilgang', () => {
  it('lar styret spørre om dugnad, men bare prosjektansvarlige om oppdrag', () => {
    expect(canCreateCallout(['posts.publish'], 'dugnad')).toBe(true)
    expect(canCreateCallout(['posts.publish'], 'spilleoppdrag')).toBe(false)
    expect(canCreateCallout(['projects.manage'], 'spilleoppdrag')).toBe(true)
    expect(canCreateCallout([], 'dugnad')).toBe(false)
  })
  it('gjør forfatteren og styret ansvarlige, men ikke andre medlemmer', () => {
    const post = { authorId: 'ola', kind: 'dugnad' as const }
    expect(canManageCallout({ id: 'ola', permissions: [] }, post)).toBe(true)
    expect(canManageCallout({ id: 'kari', permissions: ['posts.publish'] }, post)).toBe(true)
    expect(canManageCallout({ id: 'kari', permissions: ['projects.manage'] }, post)).toBe(false)
    expect(canManageCallout({ id: 'kari', permissions: [] }, post)).toBe(false)
  })
  it('gir prosjektansvarlige innsyn i oppdrag', () => {
    expect(canManageCallout({ id: 'kari', permissions: ['projects.manage'] }, { authorId: null, kind: 'spilleoppdrag' })).toBe(true)
  })
})

describe('tekstene', () => {
  it('rydder merknaden', () => {
    expect(normalizeCalloutNote('  kan   etter\n18 ')).toBe('kan etter 18')
    expect(normalizeCalloutNote('   ')).toBeNull()
    expect(normalizeCalloutNote('x'.repeat(300))).toHaveLength(200)
  })
  it('teller mot behovet', () => {
    expect(calloutCountLabel(3, null)).toBe('3 kan')
    expect(calloutCountLabel(3, 6)).toBe('3 av 6 kan')
  })
  it('skiller mellom påmeldt på dugnad og aktuell på oppdrag', () => {
    expect(calloutMineLabel('dugnad', 'yes', false)).toBe('Du er med')
    expect(calloutMineLabel('spilleoppdrag', 'yes', false)).toContain('aktuell')
    expect(calloutMineLabel('spilleoppdrag', 'yes', true)).toBe('Du er med på oppdraget')
    expect(calloutMineLabel('spilleoppdrag', 'no', true)).toContain('satt opp')
  })
})
