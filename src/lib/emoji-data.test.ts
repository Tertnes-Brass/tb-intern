import { describe, expect, it } from 'vitest'
import {
  EMOJI_CATEGORIES,
  MAX_RECENT,
  type RawCompactEmoji,
  emojiVersionIndex,
  foldText,
  groupEmoji,
  normalizeEmoji,
  parseRecent,
  pushRecent,
  searchEmoji,
} from './emoji-data'

/**
 * Emojivelgerens rene del. De fleste testene bruker en liten håndlaget fixtur;
 * den siste laster de ekte norske dataene for å låse at pakken faktisk gir det
 * velgeren lover (norske navn, ingen komponenter).
 */

const RAW: RawCompactEmoji[] = [
  { hexcode: '1F1F3', label: 'regional indikator N', unicode: '🇳' },
  { hexcode: '1F600', label: 'glis', unicode: '😀', group: 0, order: 1, tags: ['fjes', 'glad', 'smil'] },
  {
    hexcode: '1F642',
    label: 'lett smilende fjes',
    unicode: '🙂',
    group: 0,
    order: 10,
    tags: ['fjes', 'smil'],
    emoticon: [':)', '=)'],
  },
  { hexcode: '2764', label: 'rødt hjerte', unicode: '❤️', group: 0, order: 156, tags: ['hjerte'], emoticon: '<3' },
  { hexcode: '1F498', label: 'hjerte med pil', unicode: '💘', group: 0, order: 140, tags: ['amor', 'kjærlighet'] },
  { hexcode: '1F44D', label: 'tommel opp', unicode: '👍', group: 1, order: 354, tags: ['bra', 'ok', 'tommel'] },
  { hexcode: '1F44E', label: 'tommel ned', unicode: '👎', group: 1, order: 360, tags: ['dårlig', 'tommel'] },
  { hexcode: '1F468', label: 'mann', unicode: '👨', group: 1, order: 400, tags: ['voksen'] },
  {
    hexcode: '1F468-200D-1F469-200D-1F467',
    label: 'familie: mann, kvinne og jente',
    unicode: '👨‍👩‍👧',
    group: 1,
    order: 500,
    tags: ['familie'],
  },
  { hexcode: '1F3FD', label: 'hudtype 4', unicode: '🏽', group: 2, order: 3671, tags: ['hud'] },
  { hexcode: '1FAD0', label: 'blåbær', unicode: '🫐', group: 4, order: 800, tags: ['bær', 'blå'] },
  { hexcode: '1F37A', label: 'ølkrus', unicode: '🍺', group: 4, order: 820, tags: ['bar', 'drikke', 'øl'] },
  { hexcode: '1F54C', label: 'moské', unicode: '🕌', group: 5, order: 900, tags: ['islam', 'religion'] },
  { hexcode: '1F3BA', label: 'trompet', unicode: '🎺', group: 7, order: 1200, tags: ['instrument', 'musikk'] },
  { hexcode: '1FA8A', label: 'trombone', unicode: '🪊', group: 7, order: 1201, tags: ['instrument', 'musikk'] },
  { hexcode: '1F1F3-1F1F4', label: 'flagg: Norge', unicode: '🇳🇴', group: 9, order: 5156, tags: ['NO', 'flagg'] },
]

const VERSIONS = { '0.6': ['1F600', '2764', '1F44D'], '17': ['1FA8A'] }

const LIST = normalizeEmoji(RAW)
const emojiOf = (entries: { emoji: string }[]) => entries.map((e) => e.emoji)

describe('normalizeEmoji', () => {
  it('tar bort komponenter og regionale indikatorer', () => {
    const emoji = emojiOf(LIST)
    expect(emoji).not.toContain('🏽')
    expect(emoji).not.toContain('🇳')
    expect(emoji).toContain('🇳🇴')
  })

  it('gir den enkle formen med kategorinøkkel, og smilefjes-tekstene som stikkord', () => {
    expect(LIST.find((e) => e.emoji === '🙂')).toEqual({
      emoji: '🙂',
      label: 'lett smilende fjes',
      tags: ['fjes', 'smil', ':)', '=)'],
      group: 'smileys-emotion',
    })
    expect(LIST.find((e) => e.emoji === '❤️')?.tags).toEqual(['hjerte', '<3'])
  })

  it('sorterer på Unicode-rekkefølgen, ikke på rekkefølgen i fila', () => {
    expect(emojiOf(LIST.filter((e) => e.group === 'smileys-emotion'))).toEqual(['😀', '🙂', '💘', '❤️'])
  })

  it('tar bort emoji nyere enn grensen, men beholder dem uten kjent versjon', () => {
    const versions = emojiVersionIndex(VERSIONS)
    const capped = emojiOf(normalizeEmoji(RAW, { versions, maxVersion: 15.1 }))
    expect(capped).not.toContain('🪊')
    expect(capped).toContain('🎺') // ingen versjon i fixturen → beholdes
    expect(emojiOf(normalizeEmoji(RAW, { versions, maxVersion: 17 }))).toContain('🪊')
    // Uten versjonsdata filtreres ingenting på versjon.
    expect(emojiOf(LIST)).toContain('🪊')
  })
})

describe('groupEmoji', () => {
  it('følger kategorirekkefølgen og hopper over tomme kategorier', () => {
    const sections = groupEmoji(LIST)
    expect(sections.map((s) => s.key)).toEqual([
      'smileys-emotion',
      'people-body',
      'food-drink',
      'travel-places',
      'objects',
      'flags',
    ])
    expect(sections[0].label).toBe('Smilefjes og følelser')
    expect(sections.find((s) => s.key === 'objects')?.icon).toBe('🎺')
  })

  it('har norske navn på alle ni kategoriene, og aldri komponentgruppen', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.label)).toEqual([
      'Smilefjes og følelser',
      'Folk og kropp',
      'Dyr og natur',
      'Mat og drikke',
      'Reise og steder',
      'Aktiviteter',
      'Gjenstander',
      'Symboler',
      'Flagg',
    ])
    expect(EMOJI_CATEGORIES.some((c) => (c.group as number) === 2)).toBe(false)
  })
})

describe('foldText', () => {
  it('ser bort fra store bokstaver, aksenter og æ/ø/å', () => {
    expect(foldText('  Blåbær ')).toBe('blabaer')
    expect(foldText('ØL')).toBe('ol')
    expect(foldText('Moské')).toBe('moske')
    expect(foldText('rødt   hjerte')).toBe('rodt hjerte')
  })
})

describe('searchEmoji', () => {
  it('tomt søk gir ingenting', () => {
    expect(searchEmoji(LIST, '')).toEqual([])
    expect(searchEmoji(LIST, '   ')).toEqual([])
  })

  it('rangerer: nøyaktig navn, navnet begynner, ord i navnet, stikkord, delstreng', () => {
    const list = normalizeEmoji([
      { hexcode: 'A', label: 'en ost', unicode: 'Ⓐ', group: 0, order: 1, tags: [] },
      { hexcode: 'B', label: 'kyllingost', unicode: 'Ⓑ', group: 0, order: 2, tags: [] },
      { hexcode: 'C', label: 'brød', unicode: 'Ⓒ', group: 0, order: 3, tags: ['ostesmørbrød'] },
      { hexcode: 'D', label: 'ostehøvel', unicode: 'Ⓓ', group: 0, order: 4, tags: [] },
      { hexcode: 'E', label: 'ost', unicode: 'Ⓔ', group: 0, order: 5, tags: [] },
      { hexcode: 'F', label: 'pizza', unicode: 'Ⓕ', group: 0, order: 6, tags: [] },
    ])
    expect(emojiOf(searchEmoji(list, 'ost'))).toEqual(['Ⓔ', 'Ⓓ', 'Ⓐ', 'Ⓒ', 'Ⓑ'])
  })

  it('finner på norske navn og stikkord, uansett store bokstaver og aksenter', () => {
    expect(emojiOf(searchEmoji(LIST, 'tommel'))).toEqual(['👍', '👎'])
    expect(emojiOf(searchEmoji(LIST, 'TOMMEL OPP'))).toEqual(['👍'])
    expect(emojiOf(searchEmoji(LIST, 'blabaer'))).toEqual(['🫐'])
    expect(emojiOf(searchEmoji(LIST, 'øl'))).toEqual(['🍺'])
    expect(emojiOf(searchEmoji(LIST, 'moske'))).toEqual(['🕌'])
    expect(emojiOf(searchEmoji(LIST, 'norge'))).toEqual(['🇳🇴'])
    expect(emojiOf(searchEmoji(LIST, 'musikk'))).toEqual(['🎺', '🪊'])
  })

  it('«hjerte»: navn som begynner med ordet før navn der det er et senere ord', () => {
    expect(emojiOf(searchEmoji(LIST, 'hjerte'))).toEqual(['💘', '❤️'])
  })

  it('finner alle ordene i en annen rekkefølge', () => {
    expect(emojiOf(searchEmoji(LIST, 'hjerte rødt'))).toEqual(['❤️'])
  })

  it('smilefjes-tekster finner tegnet', () => {
    expect(emojiOf(searchEmoji(LIST, ':)'))).toEqual(['🙂'])
    expect(emojiOf(searchEmoji(LIST, '<3'))).toEqual(['❤️'])
  })

  it('respekterer grensen', () => {
    expect(searchEmoji(LIST, 'fjes', 1)).toHaveLength(1)
  })

  it('innlimt tegn finner seg selv — også uten variantvelger og med hudtone', () => {
    expect(emojiOf(searchEmoji(LIST, '👍'))).toEqual(['👍'])
    expect(emojiOf(searchEmoji(LIST, '👍🏽'))).toEqual(['👍'])
    expect(emojiOf(searchEmoji(LIST, '❤'))).toEqual(['❤️'])
    expect(emojiOf(searchEmoji(LIST, ' 🇳🇴 '))).toEqual(['🇳🇴'])
  })

  it('flere innlimte tegn kommer i den rekkefølgen de står, nøyaktig treff først', () => {
    expect(emojiOf(searchEmoji(LIST, '❤️👍'))).toEqual(['❤️', '👍'])
    expect(emojiOf(searchEmoji(LIST, '👨‍👩‍👧'))[0]).toBe('👨‍👩‍👧')
  })
})

describe('Nylig brukt', () => {
  it('pushRecent legger det valgte først, uten duplikater, med tak', () => {
    expect(pushRecent(['😀', '👍'], '👍')).toEqual(['👍', '😀'])
    expect(pushRecent([], '🎺')).toEqual(['🎺'])
    const full = Array.from({ length: MAX_RECENT }, (_, i) => String(i))
    const next = pushRecent(full, '🎺')
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]).toBe('🎺')
    expect(next).not.toContain(String(MAX_RECENT - 1))
  })

  it('parseRecent tåler hva som helst i localStorage', () => {
    expect(parseRecent(null)).toEqual([])
    expect(parseRecent('')).toEqual([])
    expect(parseRecent('ikke json')).toEqual([])
    expect(parseRecent('{"a":1}')).toEqual([])
    expect(parseRecent('["👍", 3, null, "", "👍", "🎺"]')).toEqual(['👍', '🎺'])
    expect(parseRecent(JSON.stringify(['x'.repeat(100), '👍']))).toEqual(['👍'])
    expect(parseRecent(JSON.stringify(Array.from({ length: 50 }, (_, i) => String(i))))).toHaveLength(MAX_RECENT)
  })
})

describe('de ekte norske dataene (emojibase-data/nb)', () => {
  it('har norske navn, ingen komponenter, og «tommel»/«hjerte» finner 👍/❤️', async () => {
    const compact = (await import('emojibase-data/nb/compact.json')).default
    const versions = (await import('emojibase-data/versions/emoji.json')).default
    const list = normalizeEmoji(compact, { versions: emojiVersionIndex(versions) })

    expect(list.length).toBeGreaterThan(1500)
    expect(list.find((e) => e.emoji === '👍')?.label).toBe('tommel opp')
    expect(searchEmoji(list, 'tommel')[0]?.emoji).toBe('👍')
    expect(emojiOf(searchEmoji(list, 'hjerte'))).toContain('❤️')
    expect(emojiOf(searchEmoji(list, 'norge'))).toContain('🇳🇴')

    // Komponentgruppen og de regionale indikatorene er borte.
    const raw = compact.filter((e) => e.group === 2 || e.group === undefined).map((e) => e.unicode)
    expect(raw.length).toBeGreaterThan(0)
    const kept = new Set(list.map((e) => e.emoji))
    expect(raw.filter((e) => kept.has(e))).toEqual([])

    // Alle ni kategoriene har innhold.
    expect(groupEmoji(list).map((s) => s.key)).toEqual(EMOJI_CATEGORIES.map((c) => c.key))
  })
})
