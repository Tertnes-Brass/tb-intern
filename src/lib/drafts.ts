/**
 * Lokale utkast for skriveflatene (nytt innlegg, redigering, ny tråd,
 * kommentarer og forumsvar). Teksten lagres i `localStorage` på enheten mens
 * man skriver, slik at «Avbryt» ved et uhell, en navigasjon eller en omlasting
 * av den installerte appen ikke koster det man har skrevet.
 *
 * Rene funksjoner — ingen `window` her. Lagringen selv og forsinkelsen bor i
 * `useLocalDraft` (src/components/compose/useLocalDraft.ts).
 *
 * Reglene:
 * - Nøkkelen har ALLTID brukerens id: `tb-draft:<brukerId>:<omfang>`. Et utkast
 *   leses bare under nøkkelen til den som er innlogget nå, så en delt iPad
 *   aldri tilbyr én persons tekst til en annen.
 * - Utkast eldre enn `DRAFT_MAX_AGE_MS` regnes som borte.
 * - Innholdet valideres ved lesing: en skadet eller gammel verdi blir `null`,
 *   aldri et halvt skjema.
 */

export const DRAFT_PREFIX = 'tb-draft:'
export const DRAFT_VERSION = 1
/** Et utkast som har ligget urørt i en måned er ikke noe noen venter på. */
export const DRAFT_MAX_AGE_MS = 30 * 86_400_000

/** Hvor utkastet hører hjemme. Ett utkast per skrivefelt per bruker. */
export type DraftScope =
  | { kind: 'new-post' }
  | { kind: 'edit-post'; postId: string }
  | { kind: 'forum-new' }
  | { kind: 'comment'; postId: string; replyToId?: string | null }
  | { kind: 'forum-reply'; topicId: string; replyToId?: string | null }

/** Id-er i nøkkelen kan ikke inneholde skilletegnet; alt annet byttes ut. */
const safe = (id: string) => id.replace(/[^\w-]/g, '_').slice(0, 120)

export function draftKey(userId: string, scope: DraftScope): string {
  const user = safe(userId)
  switch (scope.kind) {
    case 'new-post':
      return `${DRAFT_PREFIX}${user}:new-post`
    case 'edit-post':
      return `${DRAFT_PREFIX}${user}:edit:${safe(scope.postId)}`
    case 'forum-new':
      return `${DRAFT_PREFIX}${user}:forum-new`
    case 'comment':
      return `${DRAFT_PREFIX}${user}:comment:${safe(scope.postId)}${scope.replyToId ? `:${safe(scope.replyToId)}` : ''}`
    case 'forum-reply':
      return `${DRAFT_PREFIX}${user}:forum-reply:${safe(scope.topicId)}${scope.replyToId ? `:${safe(scope.replyToId)}` : ''}`
  }
}

export type StoredDraft<T> = {
  v: typeof DRAFT_VERSION
  savedAt: number
  /** Versjonen av det som redigeres da utkastet ble lagret (innleggets `updatedAt`). */
  base?: number | null
  data: T
}

export function encodeDraft<T>(data: T, savedAt: number, base?: number | null): string {
  const stored: StoredDraft<T> = { v: DRAFT_VERSION, savedAt, data, ...(base != null ? { base } : {}) }
  return JSON.stringify(stored)
}

export function decodeDraft<T>(
  raw: string | null | undefined,
  isValid: (data: unknown) => data is T,
  now: number = Date.now(),
): StoredDraft<T> | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (p.v !== DRAFT_VERSION || typeof p.savedAt !== 'number' || !Number.isFinite(p.savedAt)) return null
  if (now - p.savedAt > DRAFT_MAX_AGE_MS) return null
  if (!isValid(p.data)) return null
  const base = typeof p.base === 'number' ? p.base : null
  return { v: DRAFT_VERSION, savedAt: p.savedAt, base, data: p.data }
}

// ---------- Formene ----------

export type DraftMention = { id: string; name: string }

const isMentionList = (x: unknown): x is DraftMention[] =>
  Array.isArray(x) && x.length <= 50 && x.every((m) => !!m && typeof m === 'object' && typeof (m as DraftMention).id === 'string' && typeof (m as DraftMention).name === 'string')

/** Kommentarer, forumsvar og ny tråd (med tittel). */
export type TextDraft = { body: string; chosen: DraftMention[]; title?: string }

export function isTextDraft(x: unknown): x is TextDraft {
  if (!x || typeof x !== 'object') return false
  const d = x as Record<string, unknown>
  return typeof d.body === 'string' && isMentionList(d.chosen) && (d.title === undefined || typeof d.title === 'string')
}

/** Innleggsskjemaet: tekst og de valgene som er rene verdier (ikke filer). */
export type PostDraft = {
  title: string
  body: string
  chosen: DraftMention[]
  format: 'plain_text' | 'markdown'
  audience: 'all' | 'board'
  importance: 'normal' | 'important'
  official: boolean
  fromArchive: boolean
}

export function isPostDraft(x: unknown): x is PostDraft {
  if (!x || typeof x !== 'object') return false
  const d = x as Record<string, unknown>
  return (
    typeof d.title === 'string' &&
    typeof d.body === 'string' &&
    isMentionList(d.chosen) &&
    (d.format === 'plain_text' || d.format === 'markdown') &&
    (d.audience === 'all' || d.audience === 'board') &&
    (d.importance === 'normal' || d.importance === 'important') &&
    typeof d.official === 'boolean' &&
    typeof d.fromArchive === 'boolean'
  )
}

/**
 * Er det noe å ta vare på? Et utkast som bare skiller seg fra utgangspunktet i
 * mellomrom, lagres ikke — og et tomt kommentarfelt sletter utkastet.
 */
export function sameDraft(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

function normalize(x: unknown): unknown {
  if (typeof x === 'string') return x.trim()
  if (Array.isArray(x)) return x.map(normalize)
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.keys(x).sort().map((k) => [k, normalize((x as Record<string, unknown>)[k])]))
  }
  return x
}

// ---------- Visning ----------

const timeFmt = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
const dayFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' })
const osloDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Oslo' })

/** «kl. 14:32», «i går kl. 14:32» eller «3. nov. kl. 14:32» — når utkastet ble lagret. */
export function draftTimeLabel(savedAt: number, now: number = Date.now()): string {
  const time = `kl. ${timeFmt.format(savedAt)}`
  const day = osloDay.format(savedAt)
  if (day === osloDay.format(now)) return time
  if (day === osloDay.format(now - 86_400_000)) return `i går ${time}`
  return `${dayFmt.format(savedAt)} ${time}`
}
