import { describe, expect, it } from 'vitest'
import { UNREAD_WINDOW_DAYS, badgeLabel, isUnread, unreadSince } from './unread'

const NOW = Date.UTC(2026, 9, 25, 12)
const DAY = 24 * 60 * 60 * 1000
const viewer = { id: 'me', canSeeBoardPosts: false }
const fresh = { publishedAt: NOW - DAY, authorId: 'other', audience: 'all' as const, read: false }

describe('isUnread', () => {
  it('teller et ferskt, uåpnet innlegg fra noen andre', () => {
    expect(isUnread(fresh, viewer, NOW)).toBe(true)
  })

  it('teller ikke det man har åpnet', () => {
    expect(isUnread({ ...fresh, read: true }, viewer, NOW)).toBe(false)
  })

  it('teller aldri eget innlegg', () => {
    expect(isUnread({ ...fresh, authorId: 'me' }, viewer, NOW)).toBe(false)
  })

  it('teller ikke utkast', () => {
    expect(isUnread({ ...fresh, publishedAt: null }, viewer, NOW)).toBe(false)
  })

  it(`teller bare de siste ${UNREAD_WINDOW_DAYS} dagene`, () => {
    expect(isUnread({ ...fresh, publishedAt: unreadSince(NOW) }, viewer, NOW)).toBe(true)
    expect(isUnread({ ...fresh, publishedAt: unreadSince(NOW) - 1 }, viewer, NOW)).toBe(false)
  })

  it('teller styrebeskjeder bare for dem som kan se dem', () => {
    const board = { ...fresh, audience: 'board' as const }
    expect(isUnread(board, viewer, NOW)).toBe(false)
    expect(isUnread(board, { ...viewer, canSeeBoardPosts: true }, NOW)).toBe(true)
  })

  it('teller innlegg uten forfatter (slettet bruker)', () => {
    expect(isUnread({ ...fresh, authorId: null }, viewer, NOW)).toBe(true)
  })
})

describe('badgeLabel', () => {
  it('viser ingenting for null', () => {
    expect(badgeLabel(0)).toBeNull()
  })

  it('viser tallet opp til 9 og så 9+', () => {
    expect(badgeLabel(3)).toBe('3')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
  })
})
