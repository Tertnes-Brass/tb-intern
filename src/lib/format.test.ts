import { describe, expect, it } from 'vitest'
import { formatTime, formatTimeRange, relativeDays, toOsloDate } from './format'

describe('formatTime', () => {
  it('viser klokkeslettet i norsk tid, ikke i UTC', () => {
    // Vintertid (UTC+1)
    expect(formatTime('2026-01-07T18:00:00.000Z')).toBe('19:00')
    // Sommertid (UTC+2)
    expect(formatTime('2026-05-16T16:00:00.000Z')).toBe('18:00')
  })

  it('godtar epoch-ms', () => {
    expect(formatTime(Date.parse('2026-01-07T18:00:00.000Z'))).toBe('19:00')
  })

  it('tomt inn → tomt ut', () => {
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
    expect(formatTime('')).toBe('')
    expect(formatTime('ikke en dato')).toBe('')
  })
})

describe('formatTimeRange', () => {
  it('viser start–slutt', () => {
    expect(formatTimeRange('2026-01-07T18:00:00.000Z', '2026-01-07T20:30:00.000Z')).toBe('19:00–21:30')
  })

  it('viser bare starten når slutt mangler eller er lik', () => {
    expect(formatTimeRange('2026-01-07T18:00:00.000Z')).toBe('19:00')
    expect(formatTimeRange('2026-01-07T18:00:00.000Z', null)).toBe('19:00')
    expect(formatTimeRange('2026-01-07T18:00:00.000Z', '2026-01-07T18:00:00.000Z')).toBe('19:00')
  })

  it('tom start → tom streng', () => {
    expect(formatTimeRange(null, '2026-01-07T20:30:00.000Z')).toBe('')
  })
})

describe('toOsloDate', () => {
  it('gir datoen slik den er i Norge, ikke i UTC', () => {
    // 00:30 norsk tid 8. januar er 23:30 UTC 7. januar
    expect(toOsloDate('2026-01-07T23:30:00.000Z')).toBe('2026-01-08')
    expect(toOsloDate('2026-05-16T16:00:00.000Z')).toBe('2026-05-16')
  })

  it('tomt inn → tomt ut', () => {
    expect(toOsloDate(null)).toBe('')
    expect(toOsloDate('tull')).toBe('')
  })
})

describe('relativeDays', () => {
  // 25. oktober 2026 kl. 23:30 UTC = 26. oktober kl. 00:30 i Norge (sommertid er over).
  const justAfterMidnightOslo = Date.UTC(2026, 9, 25, 23, 30)

  it('teller kalenderdager i norsk tid, uansett hvor koden kjører', () => {
    expect(relativeDays('2026-10-28', justAfterMidnightOslo)).toBe('om 2 dager')
    expect(relativeDays('2026-10-27', justAfterMidnightOslo)).toBe('i morgen')
    expect(relativeDays('2026-10-26', justAfterMidnightOslo)).toBe('i dag')
    expect(relativeDays('2026-10-25', justAfterMidnightOslo)).toBe('i går')
    expect(relativeDays('2026-10-20', justAfterMidnightOslo)).toBe('for 6 dager siden')
  })

  it('gir tom streng uten dato', () => {
    expect(relativeDays(null)).toBe('')
  })
})
