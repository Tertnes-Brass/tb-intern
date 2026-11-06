/**
 * Emojivelgeren — alt som ikke trenger React eller DOM: normalisering av
 * emojibase-dataene, kategoriene, søket og «Nylig brukt».
 *
 * ## Hvor dataene kommer fra
 *
 * `emojibase-data/nb/compact.json` (norske navn og stikkord fra Unicode CLDR)
 * og `emojibase-data/versions/emoji.json` (hvilken emojiversjon hvert tegn kom
 * i). Begge lastes dynamisk av `EmojiPicker.tsx` først når velgeren åpnes, og
 * kommer fra vår egen bundel — ingen CDN, ingen tredjepart. Denne modulen tar
 * de rå dataene inn som argumenter, slik at testene kan bruke små fixturer.
 *
 * ## Hva som tas bort
 *
 * - Gruppen «komponenter» (hudtonefeltene og hårbitene): de er byggeklosser,
 *   ikke emoji man sender.
 * - Regionale indikatorbokstaver (🇦 …): de har ingen gruppe i dataene, og
 *   alene blir de bare en blå bokstav. Flaggene står i «Flagg».
 * - Hudtonevariantene: velgeren viser bare grunnformen.
 * - Emoji nyere enn `MAX_EMOJI_VERSION`. En reaksjon vises for hele korpset,
 *   og et tegn som mottakerens enhet ikke kan tegne blir en tom firkant.
 */

// ---------- Rådata ----------

/**
 * Det vi bruker av emojibase sin `CompactEmoji`. Skrevet ut her i stedet for å
 * importeres: `emojibase` er bare en peer-avhengighet av datapakken.
 */
export type RawCompactEmoji = {
  unicode: string
  label: string
  hexcode: string
  /** Mangler for de regionale indikatorbokstavene. */
  group?: number
  order?: number
  tags?: string[]
  emoticon?: string | string[]
}

/** `versions/emoji.json`: emojiversjon → hexkodene som kom i den. */
export type RawEmojiVersions = Record<string, string[]>

// ---------- Kategorier ----------

/**
 * Kategoriene i velgerens rekkefølge. `group` er emojibase sitt gruppenummer
 * (2 = komponenter, som aldri vises). Ikonet er knappen i kategoriraden.
 */
export const EMOJI_CATEGORIES = [
  { key: 'smileys-emotion', group: 0, label: 'Smilefjes og følelser', icon: '😀' },
  { key: 'people-body', group: 1, label: 'Folk og kropp', icon: '👋' },
  { key: 'animals-nature', group: 3, label: 'Dyr og natur', icon: '🐻' },
  { key: 'food-drink', group: 4, label: 'Mat og drikke', icon: '🍕' },
  { key: 'travel-places', group: 5, label: 'Reise og steder', icon: '✈️' },
  { key: 'activities', group: 6, label: 'Aktiviteter', icon: '⚽' },
  { key: 'objects', group: 7, label: 'Gjenstander', icon: '🎺' },
  { key: 'symbols', group: 8, label: 'Symboler', icon: '🔣' },
  { key: 'flags', group: 9, label: 'Flagg', icon: '🏁' },
] as const

export type EmojiCategoryKey = (typeof EMOJI_CATEGORIES)[number]['key']

const CATEGORY_BY_GROUP = new Map<number, EmojiCategoryKey>(EMOJI_CATEGORIES.map((c) => [c.group, c.key]))

/**
 * Nyeste emojiversjon vi viser. 15.1 kom med iOS 17.4 og Android 15 — og
 * notestativ-iPadene står ofte på eldre iPadOS. Hev den når enhetene i korpset
 * har tatt igjen Unicode (🪊 trombone er 17.0).
 */
export const MAX_EMOJI_VERSION = 15.1

// ---------- Normalisering ----------

export type EmojiEntry = {
  /** Selve tegnet, med variantvelger der Unicode krever det (❤️). */
  emoji: string
  /** Det norske navnet fra CLDR, f.eks. «tommel opp». */
  label: string
  /** Norske stikkord, pluss eventuelle smilefjes-tekster («:)», «<3»). */
  tags: string[]
  group: EmojiCategoryKey
}

export type EmojiSection = {
  key: EmojiCategoryKey
  label: string
  icon: string
  emoji: EmojiEntry[]
}

/** Hexkode → emojiversjon (f.eks. `1F44D` → 0.6). */
export function emojiVersionIndex(versions: RawEmojiVersions): Map<string, number> {
  const index = new Map<string, number>()
  for (const [version, hexcodes] of Object.entries(versions)) {
    const v = Number.parseFloat(version)
    if (!Number.isFinite(v)) continue
    for (const hex of hexcodes) index.set(hex, v)
  }
  return index
}

/**
 * Rådata → flat liste i Unicode-rekkefølge, uten komponenter, uten regionale
 * indikatorer og uten hudtoner. Med `versions` tas også alt nyere enn
 * `maxVersion` bort; et tegn uten kjent versjon beholdes.
 */
export function normalizeEmoji(
  raw: readonly RawCompactEmoji[],
  options: { versions?: ReadonlyMap<string, number>; maxVersion?: number } = {},
): EmojiEntry[] {
  const { versions, maxVersion = MAX_EMOJI_VERSION } = options
  const kept: { entry: EmojiEntry; order: number }[] = []
  for (const item of raw) {
    if (item.group === undefined) continue
    const group = CATEGORY_BY_GROUP.get(item.group)
    if (!group) continue
    if (!item.unicode || !item.label) continue
    const version = versions?.get(item.hexcode)
    if (version !== undefined && version > maxVersion) continue
    const emoticons = item.emoticon === undefined ? [] : Array.isArray(item.emoticon) ? item.emoticon : [item.emoticon]
    kept.push({
      entry: { emoji: item.unicode, label: item.label, tags: [...(item.tags ?? []), ...emoticons], group },
      order: item.order ?? Number.MAX_SAFE_INTEGER,
    })
  }
  // Dataene kommer sortert, men rekkefølgen er hele poenget med en kategori.
  kept.sort((a, b) => a.order - b.order)
  return kept.map((k) => k.entry)
}

/** Lista fordelt på kategoriene, i velgerens rekkefølge. Tomme kategorier utelates. */
export function groupEmoji(list: readonly EmojiEntry[]): EmojiSection[] {
  const byKey = new Map<EmojiCategoryKey, EmojiEntry[]>()
  for (const entry of list) {
    const bucket = byKey.get(entry.group)
    if (bucket) bucket.push(entry)
    else byKey.set(entry.group, [entry])
  }
  return EMOJI_CATEGORIES.flatMap((c) => {
    const emoji = byKey.get(c.key)
    return emoji ? [{ key: c.key, label: c.label, icon: c.icon, emoji }] : []
  })
}

// ---------- Søk ----------

/**
 * Store/små bokstaver og aksenter teller ikke: «Blabaer» finner «blåbær», «ol»
 * finner «øl» og «kafe» finner «kafé». Samme folding som `normalizeForSearch`
 * i `mentions.ts`, slik at de to søkene oppfører seg likt — kopiert, ikke
 * importert, for at velgeren ikke skal dra med seg veggens moduler.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/đ|ð/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u

/** Variantvelgere og hudtoner: «👍🏽» og «❤» skal finne 👍 og ❤️. */
function bareEmoji(value: string): string {
  return value.replace(/[︎️\s]|\uD83C[\uDFFB-\uDFFF]/g, '')
}

const LOOKS_LIKE_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

type Prepared = { label: string; words: string[]; tags: string[]; tagWords: string[]; bare: string }

// Foldingen gjøres én gang per tegn, ikke ved hvert tastetrykk. WeakMap-en
// holder `EmojiEntry` til den enkle formen kalleren ser.
const prepared = new WeakMap<EmojiEntry, Prepared>()

function prepare(entry: EmojiEntry): Prepared {
  let p = prepared.get(entry)
  if (!p) {
    const label = foldText(entry.label)
    const tags = entry.tags.map(foldText).filter(Boolean)
    p = {
      label,
      words: label.split(WORD_SPLIT).filter(Boolean),
      tags,
      tagWords: tags.flatMap((t) => t.split(WORD_SPLIT)).filter(Boolean),
      bare: bareEmoji(entry.emoji),
    }
    prepared.set(entry, p)
  }
  return p
}

/** Lavere er bedre. `null` = ingen treff. */
function textRank(p: Prepared, q: string, terms: string[]): number | null {
  if (p.label === q) return 0
  if (p.label.startsWith(q)) return 1
  if (p.words.some((w) => w.startsWith(q))) return 2
  if (p.tags.some((t) => t.startsWith(q))) return 3
  if (p.label.includes(q) || p.tags.some((t) => t.includes(q))) return 4
  // «hjerte rødt» skal finne «rødt hjerte»: hvert ord må begynne et ord et sted.
  if (
    terms.length > 1 &&
    terms.every((t) => p.words.some((w) => w.startsWith(t)) || p.tagWords.some((w) => w.startsWith(t)))
  ) {
    return 5
  }
  return null
}

/**
 * Søket i velgeren. Rangering: navnet er nøyaktig søket, navnet begynner med
 * søket, et ord i navnet begynner med søket, et stikkord begynner med søket,
 * og til slutt søket et sted i navn eller stikkord. Innenfor hvert nivå beholdes
 * Unicode-rekkefølgen, så 😀 kommer før 😃.
 *
 * Limer man inn selve tegnet («👍», «👍🏽», «👍❤️»), finnes tegnene i den
 * rekkefølgen de står — det nøyaktige treffet først.
 */
export function searchEmoji(list: readonly EmojiEntry[], query: string, limit = 120): EmojiEntry[] {
  if (LOOKS_LIKE_EMOJI.test(query)) return searchByEmoji(list, query, limit)

  const q = foldText(query)
  if (!q) return []
  const terms = q.split(' ').filter(Boolean)
  const hits: { entry: EmojiEntry; rank: number; index: number }[] = []
  list.forEach((entry, index) => {
    const rank = textRank(prepare(entry), q, terms)
    if (rank !== null) hits.push({ entry, rank, index })
  })
  hits.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return hits.slice(0, limit).map((h) => h.entry)
}

function searchByEmoji(list: readonly EmojiEntry[], query: string, limit: number): EmojiEntry[] {
  const q = bareEmoji(query)
  if (!q) return []
  const hits: { entry: EmojiEntry; exact: boolean; at: number; length: number }[] = []
  for (const entry of list) {
    const { bare } = prepare(entry)
    if (!bare) continue
    const at = q.indexOf(bare)
    if (at === -1) continue
    hits.push({ entry, exact: bare === q, at, length: bare.length })
  }
  // Lengste først på samme plass: 👨‍👩‍👧 før 👨 når familien er limt inn.
  hits.sort((a, b) => Number(b.exact) - Number(a.exact) || a.at - b.at || b.length - a.length)
  return hits.slice(0, limit).map((h) => h.entry)
}

// ---------- Nylig brukt ----------

export const RECENT_EMOJI_KEY = 'tb-emoji-recent'
export const MAX_RECENT = 24

/**
 * Leser lagret «Nylig brukt». Alt som ikke er en liste med korte strenger
 * forkastes — `localStorage` er brukerens, og kan inneholde hva som helst.
 */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && item.length <= 32) seen.add(item)
    if (seen.size >= MAX_RECENT) break
  }
  return [...seen]
}

/** Det valgte tegnet først, uten duplikater, maks `max`. */
export function pushRecent(recent: readonly string[], emoji: string, max = MAX_RECENT): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, max)
}
