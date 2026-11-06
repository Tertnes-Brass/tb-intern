import { describe, expect, it } from 'vitest'
import {
  LIKE_EMOJI,
  MAX_DISTINCT_REACTIONS,
  QUICK_REACTIONS,
  canAddDistinct,
  isReactionEmoji,
  normalizeReactionEmoji,
  likeState,
  reactionTitle,
  reactionTotal,
  reactionsText,
  summarizeReactions,
  toggleInSummary,
} from './reactions'

describe('isReactionEmoji', () => {
  it('godtar vanlige emojier, sekvenser, hudfarger, flagg og tastetrykk', () => {
    for (const e of [...QUICK_REACTIONS, '🫶', '👍🏽', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇳🇴', '1️⃣', '#️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '❤', '☺️']) {
      expect(isReactionEmoji(e), e).toBe(true)
    }
  })

  it('avviser tekst, tall, HTML, flere emojier og for lange strenger', () => {
    for (const e of ['1234567890😀', '🎺🎺', '🇫🇺🇨🇰', '👍😂']) expect(isReactionEmoji(e), e).toBe(false)
    for (const e of ['', 'haha', '👍 bra', '<b>👍</b>', '1', '#', '*', '12', '‍', '️', '🇳', '👍'.repeat(17), 'a👍', ' 👍', null, 3]) {
      expect(isReactionEmoji(e), String(e)).toBe(false)
    }
  })
})

const VS16 = String.fromCodePoint(0xfe0f)

describe('normalizeReactionEmoji', () => {
  it('rører ikke et tegn kjøretiden ikke kjenner (nyere Unicode enn tabellene)', () => {
    // U+1FAEB er Unicode 18; Node 24 og eldre vet ikke hva det er.
    expect(normalizeReactionEmoji(String.fromCodePoint(0x1faeb))).toBe(String.fromCodePoint(0x1faeb))
  })

  it('gjør samme emoji til samme chip', () => {
    expect(normalizeReactionEmoji('👍' + VS16)).toBe('👍')
    expect(normalizeReactionEmoji('❤')).toBe('❤' + VS16)
    expect(normalizeReactionEmoji('❤' + VS16)).toBe('❤' + VS16)
    expect(normalizeReactionEmoji('☝🏽')).toBe('☝🏽')
    expect(normalizeReactionEmoji('1' + VS16 + '\u20e3')).toBe('1' + VS16 + '\u20e3')
    expect(normalizeReactionEmoji('🏳\u200d🌈')).toBe('🏳' + VS16 + '\u200d🌈')
  })
})

describe('summarizeReactions', () => {
  const rows = [
    { emoji: '😂', userId: 'jonas', userName: 'Jonas', createdAt: 3 },
    { emoji: '👍', userId: 'ingrid', userName: 'Ingrid', createdAt: 1 },
    { emoji: '👍', userId: 'me', userName: 'Meg', createdAt: 2 },
    { emoji: '😂', userId: 'gone', userName: null, createdAt: 4 },
  ]

  it('én per emoji, i rekkefølgen den først ble brukt, med «Du» for meg', () => {
    expect(summarizeReactions(rows, 'me')).toEqual([
      { emoji: '👍', count: 2, mine: true, names: ['Ingrid', 'Du'] },
      { emoji: '😂', count: 2, mine: false, names: ['Jonas', 'Tidligere medlem'] },
    ])
  })

  it('tar med de første navnene på siden, og alle når arket ber om dem', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ emoji: '👍', userId: `u${i}`, userName: `Medlem ${i}`, createdAt: i }))
    expect(summarizeReactions(many, 'me')[0]).toMatchObject({ count: 12, names: many.slice(0, 10).map((r) => r.userName) })
    expect(summarizeReactions(many, 'me', Number.POSITIVE_INFINITY)[0]!.names).toHaveLength(12)
  })

  it('gir mobil-API-ets like, totalen og teksten', () => {
    const s = summarizeReactions(rows, 'me')
    expect(likeState(s)).toEqual({ count: 2, mine: true })
    expect(likeState([])).toEqual({ count: 0, mine: false })
    expect(reactionTotal(s)).toBe(4)
    expect(reactionsText(s)).toBe('👍 2 · 😂 2')
    expect(LIKE_EMOJI).toBe('👍')
  })
})

describe('toggleInSummary', () => {
  const base = [{ emoji: '👍', count: 2, mine: false, names: ['Ingrid', 'Jonas'] }]

  it('legger til, øker, minker og fjerner — som serveren', () => {
    const added = toggleInSummary(base, '🎺')
    expect(added).toEqual([...base, { emoji: '🎺', count: 1, mine: true, names: ['Du'] }])
    const joined = toggleInSummary(base, '👍')
    expect(joined[0]).toEqual({ emoji: '👍', count: 3, mine: true, names: ['Du', 'Ingrid', 'Jonas'] })
    expect(toggleInSummary(joined, '👍')).toEqual(base)
    expect(toggleInSummary(added, '🎺')).toEqual(base)
  })
})

describe('canAddDistinct', () => {
  it('stopper ny emoji ved taket, men lar deg bli med på en som finnes', () => {
    const full = Array.from({ length: MAX_DISTINCT_REACTIONS }, (_, i) => String.fromCodePoint(0x1f600 + i))
    expect(canAddDistinct(full, '🎺')).toBe(false)
    expect(canAddDistinct(full, full[3]!)).toBe(true)
    expect(canAddDistinct(['👍'], '🎺')).toBe(true)
  })
})

describe('reactionTitle', () => {
  it('skriver hvem som reagerte, på norsk', () => {
    expect(reactionTitle({ emoji: '👍', count: 1, mine: true, names: ['Du'] })).toBe('Du reagerte med 👍')
    expect(reactionTitle({ emoji: '👍', count: 2, mine: false, names: ['Ingrid', 'Jonas'] })).toBe('Ingrid og Jonas reagerte med 👍')
    expect(reactionTitle({ emoji: '😂', count: 3, mine: true, names: ['Du', 'Ingrid', 'Jonas'] })).toBe('Du, Ingrid og Jonas reagerte med 😂')
    expect(reactionTitle({ emoji: '🎉', count: 4, mine: false, names: ['A', 'B', 'C', 'D'] })).toBe('A, B, C og 1 annen reagerte med 🎉')
    expect(reactionTitle({ emoji: '🎉', count: 25, mine: false, names: ['A', 'B', 'C', 'D'] })).toBe('A, B, C og 22 andre reagerte med 🎉')
  })
})

describe('emoji-velgeren og serveren er enige', () => {
  it('hver emoji velgeren viser, godtas som reaksjon', async () => {
    const { readFileSync } = await import('node:fs')
    const { emojiVersionIndex, normalizeEmoji } = await import('./emoji-data')
    const raw = JSON.parse(readFileSync('node_modules/emojibase-data/nb/compact.json', 'utf8'))
    const versions = emojiVersionIndex(JSON.parse(readFileSync('node_modules/emojibase-data/versions/emoji.json', 'utf8')))
    // Det velgeren faktisk viser: med versjonstaket (Unicode 15.1), som i EmojiPicker.
    const shown = normalizeEmoji(raw, { versions })
    expect(shown.length).toBeGreaterThan(1500)
    const rejected = shown.filter((e) => !isReactionEmoji(e.emoji)).map((e) => e.emoji)
    expect(rejected).toEqual([])
    // Velgeren gir fullt kvalifiserte former; normaliseringen skal ikke endre én av dem.
    const changed = shown.filter((e) => normalizeReactionEmoji(e.emoji) !== e.emoji).map((e) => e.emoji)
    expect(changed).toEqual([])
  })
})
