/**
 * Medlemsomtaler i kommentarer på veggen (#83) — all logikk som ikke trenger
 * database, DOM eller e-postbinding.
 *
 * ## Lagringsformatet
 *
 * En omtale lagres som en markør i kommentarteksten: `@[u:<brukerId>]`. Markøren
 * peker på en STABIL id, aldri på et navn — bytter noen navn, følger omtalen med
 * av seg selv. Ved visning slås markøren opp mot dagens navn (server-side join
 * mot `user`) og rendres som en chip; en markør uten treff blir «Ukjent medlem»,
 * aldri rå markørtekst og aldri et gammelt navn.
 *
 * Den spørrbare koblingen ligger i tabellen `post_comment_mentions`
 * (kommentar → bruker). Teksten er sannheten om *hvor* i kommentaren omtalen
 * står; tabellen er sannheten om *hvem* som er omtalt.
 *
 * ## Hvorfor `@` i e-post og kode aldri blir en omtale
 *
 * Kommentarer er ren tekst — de går ALDRI gjennom `src/lib/markdown.ts`. En
 * omtale oppstår derfor ikke ved å skrive `@noe`: den oppstår kun når
 * skribenten velger et medlem fra forslagslista, og teksten blir omskrevet til
 * en markør ved innsending (`toMarkers`). `ola@epost.no` mangler både ordgrensen
 * foran `@` og et valgt navn, og backtick-spenn hoppes over helt. Serveren
 * validerer i tillegg hver markør før kommentaren lagres.
 */
import { type PostAudience, canReadPost, escapeHtml } from './posts'

/** Maks antall omtaler i én kommentar. Håndheves server-side i `addComment`. */
export const MAX_MENTIONS = 10

/** Teksten en markør uten kjent bruker får. Aldri markøren, aldri et gammelt navn. */
export const UNKNOWN_MENTION = 'Ukjent medlem'

/**
 * Markøren. Id-alfabetet er bevisst vidt (better-auth og `newId()` har hver sin
 * form), men lukket: ingen mellomrom, ingen klammer, ingenting som kan bryte ut.
 */
const MARKER = /@\[u:([A-Za-z0-9_-]{1,64})\]/g

/** Et medlem slik forslagslista og chip-rendringen kjenner det. Aldri e-post. */
export type MentionUser = { id: string; name: string }

// ---------- Lesing av markører ----------

/**
 * Bruker-id-ene som er omtalt i teksten, i rekkefølge og uten duplikater.
 * Grunnlaget for både valideringen og varslingen — nevnes noen tre ganger, er
 * det fortsatt én omtale.
 */
export function parseMentions(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(MARKER)) {
    const id = match[1]!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export type CommentToken = { kind: 'text'; value: string } | { kind: 'mention'; id: string; name: string | null }

/**
 * Deler teksten i ren tekst og omtaler, med dagens navn slått opp. `name: null`
 * betyr at brukeren ikke finnes lenger (slettet konto) — kallerne viser
 * `UNKNOWN_MENTION`.
 */
export function commentTokens(body: string, users: Iterable<MentionUser> = []): CommentToken[] {
  const names = new Map<string, string>()
  for (const u of users) names.set(u.id, u.name)

  const out: CommentToken[] = []
  let last = 0
  for (const match of body.matchAll(MARKER)) {
    const start = match.index
    if (start > last) out.push({ kind: 'text', value: body.slice(last, start) })
    out.push({ kind: 'mention', id: match[1]!, name: names.get(match[1]!) ?? null })
    last = start + match[0].length
  }
  if (last < body.length) out.push({ kind: 'text', value: body.slice(last) })
  return out
}

/**
 * Kommentaren som HTML. ALT brukerinnhold escapes; det eneste som blir markering
 * er omtale-chipene, som rendreren skriver selv. Samme prinsipp som
 * `src/lib/markdown.ts`: allowlist ved konstruksjon, ingen sanitizer etterpå.
 *
 * Linjeskift blir IKKE `<br>` — kommentarer vises med `white-space: pre-wrap`,
 * akkurat som før omtalene fantes.
 */
export function renderCommentHtml(body: string, users: Iterable<MentionUser> = []): string {
  return commentTokens(body, users)
    .map((token) => {
      if (token.kind === 'text') return escapeHtml(token.value)
      if (token.name === null) {
        return `<span class="mention mention-unknown">${escapeHtml(UNKNOWN_MENTION)}</span>`
      }
      return `<span class="mention">@${escapeHtml(token.name)}</span>`
    })
    .join('')
}

/** Kommentaren som ren tekst med navn i stedet for markører — til e-postutdrag. */
export function commentPlainText(body: string, users: Iterable<MentionUser> = []): string {
  return commentTokens(body, users)
    .map((token) => (token.kind === 'text' ? token.value : token.name === null ? UNKNOWN_MENTION : `@${token.name}`))
    .join('')
}

// ---------- Backtick-spenn ----------

/**
 * Områdene i teksten som er omsluttet av backticks (`kode` og ```blokk```).
 * `@` der inne skal aldri utløse forslagslista eller bli en markør — det er som
 * regel en filsti, en e-post eller et kodeutdrag. Uavsluttet backtick regnes
 * som kode ut teksten, slik at halvskrevet kode heller ikke fanger `@`.
 * Returnerer halvåpne intervaller `[start, slutt)`.
 */
export function codeRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < body.length) {
    if (body[i] !== '`') {
      i += 1
      continue
    }
    let open = i
    while (i < body.length && body[i] === '`') i += 1
    const fence = i - open
    let j = i
    for (;;) {
      const next = body.indexOf('`'.repeat(fence), j)
      if (next === -1) {
        ranges.push([open, body.length])
        return ranges
      }
      // Et lengre backtick-løp er ikke en avslutning på et kortere.
      let end = next
      while (end < body.length && body[end] === '`') end += 1
      if (end - next !== fence) {
        j = end
        continue
      }
      ranges.push([open, end])
      i = end
      break
    }
  }
  return ranges
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

// ---------- Skriving i tekstfeltet ----------

/** Tegn et navn kan inneholde. Bokstaver (også norske), tall, mellomrom og bindestrek. */
const NAME_CHAR = /[\p{L}\p{N}'\-. ]/u
const WORD_CHAR = /[\p{L}\p{N}]/u

/** Lengste `@`-søk vi følger. Lengre enn dette er det ikke et navn lenger. */
const MAX_QUERY = 40

export type MentionQuery = { start: number; query: string }

/**
 * Står markøren (caret) i et `@`-søk? Returnerer `null` når det ikke er noe å
 * foreslå — og det er poenget: `@` rett etter en bokstav (`ola@epost.no`) og `@`
 * inne i backticks gir aldri en liste.
 */
export function findMentionQuery(body: string, caret: number): MentionQuery | null {
  const at = Math.max(0, Math.min(caret, body.length))
  const skip = codeRanges(body)
  for (let i = at - 1; i >= 0 && at - i <= MAX_QUERY + 1; i -= 1) {
    const ch = body[i]!
    if (ch === '@') {
      if (inRanges(skip, i)) return null
      // Ordgrense foran: `ola@epost.no` er en e-postadresse, ikke en omtale.
      const before = i > 0 ? body[i - 1]! : ''
      if (before && WORD_CHAR.test(before)) return null
      const query = body.slice(i + 1, at)
      // Et navn har aldri to mellomrom på rad; da har skribenten gått videre.
      if (query.includes('  ')) return null
      return { start: i, query }
    }
    if (ch === '\n' || !NAME_CHAR.test(ch)) return null
  }
  return null
}

/**
 * Setter inn et valgt navn der `@`-søket står (eller ved caret hvis det ikke er
 * noe søk). Feltet viser `@Navn` — ikke markøren. Se `toMarkers` for hvorfor.
 */
export function insertMention(body: string, caret: number, name: string): { body: string; caret: number } {
  const at = Math.max(0, Math.min(caret, body.length))
  const active = findMentionQuery(body, at)
  const start = active ? active.start : at
  const inserted = `@${name} `
  const next = `${body.slice(0, start)}${inserted}${body.slice(at)}`
  return { body: next, caret: start + inserted.length }
}

/**
 * Gjør `@Navn` om til markører rett før innsending.
 *
 * **Hvorfor denne omveien?** En vanlig `<textarea>` kan ikke vise noe annet enn
 * sin egen verdi — det finnes ingen «rik» del av et tekstfelt. Enten står
 * markøren `@[u:kd9…]` synlig mens man skriver, eller så står navnet der og
 * oversettes ved innsending. Vi valgte navnet: skribenten skal lese det hen
 * skriver, og markøren er en lagringsdetalj. Alternativet — en
 * `contenteditable` med chips — gir et felt som oppfører seg annerledes enn alle
 * andre felt i appen, særlig på mobiltastatur, og var ikke verdt det.
 *
 * Oversettelsen er bevisst konservativ: bare navn som FAKTISK er valgt fra
 * lista byttes ut, lengste navn først, med ordgrense på begge sider og aldri
 * inne i backticks. Skriver noen `@Ola Nordmann` for hånd uten å velge fra
 * lista, blir det stående som ren tekst. Er samme navn valgt flere ganger
 * (to medlemmer som heter det samme), tildeles treffene i den rekkefølgen de
 * ble valgt.
 */
export function toMarkers(body: string, chosen: MentionUser[]): string {
  if (chosen.length === 0) return body
  const queue = new Map<string, string[]>()
  for (const c of chosen) {
    const list = queue.get(c.name) ?? []
    list.push(c.id)
    queue.set(c.name, list)
  }
  const lastUsed = new Map<string, string>()
  const names = [...queue.keys()].sort((a, b) => b.length - a.length)
  const skip = codeRanges(body)

  let out = ''
  let i = 0
  while (i < body.length) {
    if (body[i] === '@' && !inRanges(skip, i)) {
      const before = i > 0 ? body[i - 1]! : ''
      if (!before || !WORD_CHAR.test(before)) {
        const name = names.find((n) => {
          if (!body.startsWith(n, i + 1)) return false
          const after = body[i + 1 + n.length]
          return after === undefined || !WORD_CHAR.test(after)
        })
        if (name) {
          const id = queue.get(name)!.shift() ?? lastUsed.get(name)!
          lastUsed.set(name, id)
          out += `@[u:${id}]`
          i += 1 + name.length
          continue
        }
      }
    }
    out += body[i]
    i += 1
  }
  return out
}

// ---------- Søk i forslagslista ----------

/**
 * Norsk-tolerant søkenøkkel: små bokstaver, NFD-dekomponering (så `å` og `é`
 * mister ringen/aksenten) og de norske tegnene som IKKE dekomponeres skrevet om
 * for hånd. «Bø» skal finnes med «bo», og «Åse» med «ase».
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/đ|ð/g, 'd')
    .trim()
}

/**
 * Treffer søket navnet? Tomt søk treffer alt (rett etter `@` skal hele lista
 * vises). Ellers må et av ordene i navnet BEGYNNE med søket — «ma» skal gi
 * «Ingrid Marie Dale», men «rie» skal ikke.
 */
export function mentionMatches(name: string, query: string): boolean {
  const q = normalizeForSearch(query)
  if (!q) return true
  const n = normalizeForSearch(name)
  if (n.startsWith(q)) return true
  return n.split(/[\s-]+/).some((word) => word.startsWith(q))
}

/** Forslagslista: treff først på hele navnet, så alfabetisk. Maks `limit`. */
export function rankMentionCandidates(members: MentionUser[], query: string, limit: number): MentionUser[] {
  const q = normalizeForSearch(query)
  return members
    .filter((m) => mentionMatches(m.name, query))
    .sort((a, b) => {
      const aStarts = normalizeForSearch(a.name).startsWith(q)
      const bStarts = normalizeForSearch(b.name).startsWith(q)
      if (aStarts !== bStarts) return aStarts ? -1 : 1
      return a.name.localeCompare(b.name, 'nb')
    })
    .slice(0, limit)
}

// ---------- Hvem kan omtales ----------

/** Et medlem slik serveren henter det når en omtale skal vurderes. */
export type MentionCandidate = {
  userId: string
  name: string
  email: string | null
  isActive: boolean
  /** Har `posts.publish` — avgjør tilgang til `audience: 'board'`. */
  canPublish: boolean
}

/**
 * Hvem kan omtales i en kommentar på dette innlegget? Kun aktive medlemmer som
 * selv kan LESE innlegget — samme regel som `getPost`, hentet fra samme
 * funksjon (`canReadPost`) slik at de to aldri kan komme i utakt. Brukes både
 * til forslagslista og til valideringen i `addComment`; ett regelsted, to bruk.
 */
export function mentionableMembers<T extends { isActive: boolean; canPublish: boolean }>(
  post: { audience: PostAudience; publishedAt: number | null },
  members: T[],
): T[] {
  return members.filter((m) => m.isActive && canReadPost(post, m.canPublish))
}

// ---------- Varsling ----------

/** Valget på /min-profil. Ingen rad i databasen = `all`. */
export type MentionNotificationChoice = 'all' | 'off'
export const MENTION_NOTIFICATION_CHOICES: MentionNotificationChoice[] = ['all', 'off']

/**
 * Hvem skal ha e-post om at de er omtalt?
 *
 * Fire krav: markøren peker på et medlem vi kjenner, det er ikke skribenten selv
 * (man varsler ikke seg selv om noe man nettopp skrev), medlemmet har en
 * e-postadresse, og varslingsvalget tillater det. Dedupe er allerede gjort av
 * `parseMentions` — nevnes noen to ganger, er det fortsatt én e-post.
 */
export function mentionRecipients(
  userIds: string[],
  members: MentionCandidate[],
  options: {
    commenterId: string
    prefs: Map<string, MentionNotificationChoice> | Record<string, MentionNotificationChoice>
  },
): MentionCandidate[] {
  const byId = new Map(members.map((m) => [m.userId, m]))
  const lookup = (userId: string): MentionNotificationChoice =>
    (options.prefs instanceof Map ? options.prefs.get(userId) : options.prefs[userId]) ?? 'all'

  const out: MentionCandidate[] = []
  const seen = new Set<string>()
  for (const id of userIds) {
    if (seen.has(id)) continue
    seen.add(id)
    if (id === options.commenterId) continue
    const member = byId.get(id)
    if (!member || !member.email || !member.email.trim()) continue
    if (lookup(id) === 'off') continue
    out.push(member)
  }
  return out
}
