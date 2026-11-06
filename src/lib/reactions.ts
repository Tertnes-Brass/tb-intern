/**
 * Emoji-reaksjoner på innlegg og kommentarer på veggen og i forumet. Rene
 * regler her — gyldig emoji, oppsummering, optimistisk veksling og teksten i
 * verktøytipset — slik at web, mobil-API og serveren bruker de samme, og de kan
 * testes uten database.
 *
 * Én rad per medlem per emoji (`reactions`). Man kan reagere med flere ulike
 * emojier på samme innlegg, men bare én gang med hver — som i Discord og Slack.
 * Det gamle «👍 Liker» er 👍 her, og mobil-API v1 sin `likes`/`liked` er tallet
 * og ditt valg for 👍 (`likeState`).
 */

export const REACTION_TARGETS = ['post', 'post_comment', 'forum_topic', 'forum_reply'] as const
export type ReactionTarget = (typeof REACTION_TARGETS)[number]

/** «Liker» — det mobilappen (v1) kaller en like, og det dagens likes ble flyttet til. */
export const LIKE_EMOJI = '👍'

/** Hurtigvalgene i reaksjonsmenyen. 🎺 fordi vi er et korps. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🎺'] as const

/** Maks ulike emojier på ett innlegg (Discord har 20). Hindrer at en tråd fylles med rot. */
export const MAX_DISTINCT_REACTIONS = 20

/** Maks lengde i UTF-16-enheter. Lengste ekte emoji (familier, flagg med tagger) er under dette. */
export const MAX_EMOJI_LENGTH = 32

/** Navn i verktøytipset før det blir «og N andre». */
export const MAX_REACTION_NAMES = 10

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200D|\uFE0F|\u20E3|[\u{E0020}-\u{E007F}])+$/u
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const PRESENTATION = /^\p{Emoji_Presentation}$/u
// `Emoji`, ikke `Extended_Pictographic`: den siste dekker også kodepunkter som
// ennå ikke er tildelt, og en kjøretid med eldre Unicode-tabeller (Node 24,
// Workers) kjenner ikke de nyeste emojiene — dem skal vi la være i fred.
const EMOJI_CHAR = /^\p{Emoji}$/u
const PICTOGRAPHIC_CHAR = /^\p{Extended_Pictographic}$/u
const SKIN_TONE = /^[\u{1F3FB}-\u{1F3FF}]$/u
const REGIONAL_PAIR = /[\u{1F1E6}-\u{1F1FF}]{2}/u
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u
const VS16 = '\uFE0F'

let segmenter: Intl.Segmenter | null | undefined
/** Ett «tegn» slik et menneske ser det (et grafem) — 👨‍👩‍👧 og 🇳🇴 er ett, 🎺🎺 er to. */
function isOneGrapheme(value: string): boolean {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('nb', { granularity: 'grapheme' }) : null
  }
  if (!segmenter) return true
  let n = 0
  for (const _ of segmenter.segment(value)) if (++n > 1) return false
  return n === 1
}

/**
 * Er dette ÉN emoji (eller én ZWJ-sekvens, ett flagg eller ett tastetrykk-tegn)?
 * Serveren lagrer bare det som passerer, så en reaksjon aldri kan bli fritekst —
 * «haha», HTML, en rekke emojier eller to løse regionsbokstaver. Sifre, # og *
 * er «emoji-komponenter» i Unicode og godtas bare som del av 1️⃣ og lignende.
 */
export function isReactionEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EMOJI_LENGTH) return false
  if (!EMOJI_ONLY.test(value)) return false
  if (!(PICTOGRAPHIC.test(value) || REGIONAL_PAIR.test(value) || KEYCAP.test(value))) return false
  return isOneGrapheme(value)
}

/**
 * Den fullt kvalifiserte formen, så samme emoji alltid blir samme chip: et
 * overflødig variantvalg (U+FE0F) etter et tegn som uansett vises som emoji
 * fjernes («👍» + FE0F → «👍»), og et som mangler etter et tegn som ellers kan
 * vises som tekst, legges til («❤» → «❤️») — slik emoji-velgeren og Unicodes
 * emoji-test.txt skriver dem. Hudfarge etter tegnet erstatter variantvalget.
 * Et tegn kjøretiden ikke kjenner (nyere Unicode enn tabellene), røres ikke.
 */
export function normalizeReactionEmoji(value: string): string {
  const chars = [...value]
  const out: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!
    if (c === VS16) {
      const prev = out.at(-1)
      if (prev === undefined || prev === VS16 || PRESENTATION.test(prev)) continue
      out.push(c)
      continue
    }
    out.push(c)
    const next = chars[i + 1]
    if (PICTOGRAPHIC_CHAR.test(c) && EMOJI_CHAR.test(c) && !PRESENTATION.test(c) && next !== VS16 && !(next && SKIN_TONE.test(next))) out.push(VS16)
  }
  return out.join('')
}

/** Én emoji på ett innlegg, slik klienten viser den. */
export type ReactionSummary = {
  emoji: string
  count: number
  /** Har jeg reagert med denne? */
  mine: boolean
  /**
   * De første navnene (i rekkefølgen de reagerte) — til verktøytipset. På
   * siden høyst `MAX_REACTION_NAMES`; arket «Hvem har reagert» henter alle.
   */
  names: string[]
}

export type ReactionRow = { emoji: string; userId: string; userName: string | null; createdAt: number }

/**
 * Radene for ETT innlegg → én oppsummering per emoji, i rekkefølgen emojien
 * først ble brukt (som i Discord: en ny reaksjon havner bakerst, og rekkefølgen
 * hopper ikke når tallene endrer seg).
 */
export function summarizeReactions(rows: readonly ReactionRow[], meId: string, maxNames: number = MAX_REACTION_NAMES): ReactionSummary[] {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
  const byEmoji = new Map<string, ReactionSummary>()
  for (const row of sorted) {
    let s = byEmoji.get(row.emoji)
    if (!s) byEmoji.set(row.emoji, (s = { emoji: row.emoji, count: 0, mine: false, names: [] }))
    s.count += 1
    if (row.userId === meId) s.mine = true
    if (s.names.length < maxNames) s.names.push(row.userId === meId ? 'Du' : (row.userName ?? 'Tidligere medlem'))
  }
  return [...byEmoji.values()]
}

/** Optimistisk: det skjermen viser før serveren har svart. Samme regel som serveren. */
export function toggleInSummary(summary: readonly ReactionSummary[], emoji: string): ReactionSummary[] {
  const existing = summary.find((s) => s.emoji === emoji)
  if (!existing) return [...summary, { emoji, count: 1, mine: true, names: ['Du'] }]
  if (!existing.mine) {
    return summary.map((s) => (s.emoji === emoji ? { ...s, count: s.count + 1, mine: true, names: ['Du', ...s.names].slice(0, MAX_REACTION_NAMES) } : s))
  }
  if (existing.count <= 1) return summary.filter((s) => s.emoji !== emoji)
  return summary.map((s) => (s.emoji === emoji ? { ...s, count: s.count - 1, mine: false, names: s.names.filter((n) => n !== 'Du') } : s))
}

/** Kan en ny emoji legges til, eller er taket på ulike emojier nådd? */
export function canAddDistinct(existing: readonly string[], emoji: string): boolean {
  return existing.includes(emoji) || new Set(existing).size < MAX_DISTINCT_REACTIONS
}

/** «Du, Ingrid og 3 andre reagerte med 😂» — verktøytipset og skjermleserteksten. */
export function reactionTitle(s: ReactionSummary): string {
  const shown = s.names.slice(0, 3)
  const rest = s.count - shown.length
  let who: string
  if (rest > 0) who = `${shown.join(', ')} og ${rest} ${rest === 1 ? 'annen' : 'andre'}`
  else if (shown.length <= 1) who = shown[0] ?? 'Ingen'
  else who = `${shown.slice(0, -1).join(', ')} og ${shown.at(-1)}`
  return `${who} reagerte med ${s.emoji}`
}

/** Mobil-API v1: «likes» og «liked» er 👍. */
export function likeState(summary: readonly ReactionSummary[]): { count: number; mine: boolean } {
  const like = summary.find((s) => s.emoji === LIKE_EMOJI)
  return { count: like?.count ?? 0, mine: like?.mine ?? false }
}

/** Alle reaksjonene på ett innlegg talt sammen (hub-kortet). */
export function reactionTotal(summary: readonly ReactionSummary[]): number {
  return summary.reduce((sum, s) => sum + s.count, 0)
}

/** «👍 3 · 😂 1» — der det bare er plass til tekst (mobilappens rader). */
export function reactionsText(summary: readonly ReactionSummary[]): string {
  return summary.map((s) => `${s.emoji} ${s.count}`).join(' · ')
}
