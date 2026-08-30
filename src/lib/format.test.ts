import { describe, expect, it } from 'vitest'
import { formatTime, formatTimeRange, toOsloDate } from './format'

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
