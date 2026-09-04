import { describe, expect, it } from 'vitest'
import { OSLO_TIME_ZONE, floatingToUtc, utcToWallClock, wallClockToUtc, zoneOffsetMs } from './wallclock'

const iso = (ms: number) => new Date(ms).toISOString()

describe('wallClockToUtc', () => {
  it('tolker feltverdiene som norsk veggklokke — vintertid er UTC+1', () => {
    expect(iso(wallClockToUtc('2026-12-12', '19:00')!)).toBe('2026-12-12T18:00:00.000Z')
  })

  it('sommertid er UTC+2', () => {
    expect(iso(wallClockToUtc('2026-07-04', '19:00')!)).toBe('2026-07-04T17:00:00.000Z')
  })

  it('treffer riktig side av omleggingen kvelden før', () => {
    // Omlegging 29. mars 2026 kl. 02:00 → 03:00.
    expect(iso(wallClockToUtc('2026-03-28', '19:00')!)).toBe('2026-03-28T18:00:00.000Z')
    expect(iso(wallClockToUtc('2026-03-29', '19:00')!)).toBe('2026-03-29T17:00:00.000Z')
  })

  it('avviser tull i stedet for å gjette', () => {
    expect(wallClockToUtc('', '19:00')).toBeNull()
    expect(wallClockToUtc('2026-12-12', '')).toBeNull()
    expect(wallClockToUtc('12.12.2026', '19:00')).toBeNull()
    expect(wallClockToUtc('2026-12-12', '25:00')).toBeNull()
    expect(wallClockToUtc('2026-13-01', '19:00')).toBeNull()
  })

  it('ruller ikke 31. februar over til mars', () => {
    expect(wallClockToUtc('2026-02-31', '19:00')).toBeNull()
    // 29. februar finnes ikke i 2026, men gjør det i 2028.
    expect(wallClockToUtc('2026-02-29', '19:00')).toBeNull()
    expect(wallClockToUtc('2028-02-29', '19:00')).not.toBeNull()
  })
})

describe('utcToWallClock', () => {
  it('gir tilbake feltverdiene skjemaet skal forhåndsutfylles med', () => {
    expect(utcToWallClock(Date.parse('2026-12-12T18:00:00Z'))).toEqual({ date: '2026-12-12', time: '19:00' })
    expect(utcToWallClock(Date.parse('2026-07-04T17:00:00Z'))).toEqual({ date: '2026-07-04', time: '19:00' })
  })

  it('er invers av wallClockToUtc for et vanlig tidspunkt', () => {
    for (const date of ['2026-01-15', '2026-06-15', '2026-10-25']) {
      const ms = wallClockToUtc(date, '20:30')!
      expect(utcToWallClock(ms)).toEqual({ date, time: '20:30' })
    }
  })

  it('viser midnatt som 00:00, ikke 24:00', () => {
    expect(utcToWallClock(Date.parse('2026-12-11T23:00:00Z'))).toEqual({ date: '2026-12-12', time: '00:00' })
  })
})

describe('zoneOffsetMs og floatingToUtc', () => {
  it('gir én time om vinteren og to om sommeren', () => {
    expect(zoneOffsetMs(Date.parse('2026-01-15T12:00:00Z'), OSLO_TIME_ZONE)).toBe(3_600_000)
    expect(zoneOffsetMs(Date.parse('2026-07-15T12:00:00Z'), OSLO_TIME_ZONE)).toBe(7_200_000)
  })

  it('lander deterministisk rett etter hoppet i DST-hullet', () => {
    // 02:30 den 29. mars 2026 finnes ikke i Oslo.
    const ms = floatingToUtc(Date.UTC(2026, 2, 29, 2, 30), OSLO_TIME_ZONE)
    expect(iso(ms)).toBe('2026-03-29T01:30:00.000Z')
  })
})
