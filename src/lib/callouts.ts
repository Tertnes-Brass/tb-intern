import { floatingToUtc } from './ical'
import { START_TIME_PATTERN } from './gig-calendar'
import { toOsloDate } from './format'

/**
 * «Kan du?»: et innlegg som spør korpset om folk kan være med på en dugnad
 * eller et spilleoppdrag. Rene regler, delt av serveren og skjermen.
 *
 * - **Dugnad:** «Kan» betyr at du er med.
 * - **Spilleoppdrag:** «Kan» betyr at du er aktuell. Den ansvarlige velger
 *   besetningen, og først da får de valgte oppdraget i kalenderen og notene.
 *
 * Alle som kan lese innlegget ser hvem som kan. Bare den ansvarlige ser hvem
 * som er usikre, hvem som ikke kan, hvem som ikke har svart, og merknadene.
 * Den regelen håndheves i `callout-store.ts`, som ikke sender resten til
 * klienten. Skjermen filtrerer ingenting.
 */

export const CALLOUT_KINDS = ['dugnad', 'spilleoppdrag'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export const CALLOUT_STATUSES = ['yes', 'maybe', 'no'] as const
export type CalloutStatus = (typeof CALLOUT_STATUSES)[number]

export const CALLOUT_KIND_LABEL: Record<CalloutKind, string> = { dugnad: 'Dugnad', spilleoppdrag: 'Spilleoppdrag' }
export const CALLOUT_STATUS_LABEL: Record<CalloutStatus, string> = { yes: 'Kan', maybe: 'Usikker', no: 'Kan ikke' }

export const CALLOUT_NOTE_MAX = 200
export const CALLOUT_LOCATION_MAX = 160
export const CALLOUT_NEEDED_MAX = 200

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_ZONE = 'Europe/Oslo'

export const CALLOUT_AUDIENCE_ERROR = 'Et «Kan du?»-innlegg må gå til hele korpset'
export const CALLOUT_KIND_LOCKED = 'Typen kan ikke endres etter at folk har svart'

function allows(permissions: readonly string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission)
}

/** Hvem kan stille spørsmålet: styret og prosjektansvarlige, og bare de siste for et oppdrag. */
export function canCreateCallout(permissions: readonly string[], kind: CalloutKind): boolean {
  if (allows(permissions, 'projects.manage')) return true
  return kind === 'dugnad' && allows(permissions, 'posts.publish')
}

/** Den ansvarlige: forfatteren, styret, og prosjektansvarlige for et oppdrag. */
export function canManageCallout(
  viewer: { id: string; permissions: readonly string[] },
  post: { authorId: string | null; kind: CalloutKind },
): boolean {
  if (post.authorId !== null && post.authorId === viewer.id) return true
  if (allows(viewer.permissions, 'posts.publish')) return true
  return post.kind === 'spilleoppdrag' && allows(viewer.permissions, 'projects.manage')
}

export type CalloutDraft = {
  kind: CalloutKind
  /** Et eksisterende oppdrag. Uten id på et spilleoppdrag lages et nytt. */
  projectId?: string | null
  eventDate?: string | null
  startTime?: string | null
  location?: string | null
  respondBy?: string | null
  needed?: number | string | null
}

export type CalloutValues = {
  kind: CalloutKind
  projectId: string | null
  eventDate: string | null
  startTime: string | null
  location: string | null
  respondBy: string | null
  needed: number | null
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [y = 0, m = 1, d = 1] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Validerer skjemaet. `linkedDate` er datoen på et eksisterende oppdrag: da er
 * prosjektet sannheten om dato, tid og sted, og feltene her lagres ikke.
 * En dato i fortiden avvises ikke, så man kan rette opp en dugnad som har vært.
 */
export function sanitizeCalloutInput(draft: CalloutDraft, linkedDate?: string | null): CalloutValues {
  const linked = draft.kind === 'spilleoppdrag' && !!draft.projectId
  const eventDate = linked ? (linkedDate ?? null) : (draft.eventDate ?? '').trim() || null
  if (!linked && (!eventDate || !isRealDate(eventDate))) throw new Error('Sett en gyldig dato')
  if (linked && !eventDate) throw new Error('Oppdraget må ha en dato før du kan spørre korpset')

  const startTime = (draft.startTime ?? '').trim() || null
  if (!linked && startTime && !START_TIME_PATTERN.test(startTime)) throw new Error('Ugyldig klokkeslett')

  const respondBy = (draft.respondBy ?? '').trim() || null
  if (respondBy) {
    if (!isRealDate(respondBy)) throw new Error('Svarfristen er ikke en gyldig dato')
    if (eventDate && respondBy > eventDate) throw new Error('Svarfristen kan ikke være etter datoen det gjelder')
  }

  const rawNeeded = typeof draft.needed === 'number' ? String(draft.needed) : (draft.needed ?? '').trim()
  let needed: number | null = null
  if (rawNeeded) {
    const value = Number(rawNeeded)
    if (!Number.isInteger(value) || value < 1 || value > CALLOUT_NEEDED_MAX) {
      throw new Error(`Antall må være et helt tall mellom 1 og ${CALLOUT_NEEDED_MAX}`)
    }
    needed = value
  }

  return {
    kind: draft.kind,
    projectId: linked ? draft.projectId! : null,
    eventDate: linked ? null : eventDate,
    startTime: linked ? null : startTime,
    location: linked ? null : (draft.location ?? '').trim().slice(0, CALLOUT_LOCATION_MAX) || null,
    respondBy,
    needed,
  }
}

/** Kort merknad. Tom tekst er `null`, ikke en tom streng. */
export function normalizeCalloutNote(input: string | null | undefined): string | null {
  const text = (input ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, CALLOUT_NOTE_MAX) : null
}

export type CalloutTiming = {
  eventDate: string | null
  startTime: string | null
  respondBy: string | null
  closedAt: number | null
}

export type CalloutState = {
  phase: 'open' | 'late' | 'closed' | 'past'
  /** Svarene som kan settes nå. */
  allowed: CalloutStatus[]
  /** Kan svaret trekkes helt? Bare mens det er åpent. */
  canClear: boolean
  /** Én setning om hvorfor. Tom når det er åpent. */
  message: string
}

function hasPassed(eventDate: string | null, startTime: string | null, now: number): boolean {
  if (!eventDate) return false
  const today = toOsloDate(now)
  if (eventDate !== today) return eventDate < today
  if (!startTime) return false
  const [y = 0, m = 1, d = 1] = eventDate.split('-').map(Number)
  const [hour = 0, minute = 0] = startTime.split(':').map(Number)
  return now >= floatingToUtc(Date.UTC(y, m - 1, d, hour, minute), TIME_ZONE)
}

/**
 * Hva et medlem kan svare nå. Etter fristen, eller når svarene er stengt, kan
 * man fortsatt si fra om at man ikke kan: den som blir syk dagen før, må kunne
 * melde det. Først når datoen har vært, er svaret låst.
 */
export function calloutState(timing: CalloutTiming, now: number): CalloutState {
  if (hasPassed(timing.eventDate, timing.startTime, now)) {
    return { phase: 'past', allowed: [], canClear: false, message: 'Dette har vært.' }
  }
  if (timing.closedAt !== null) {
    return { phase: 'closed', allowed: ['no'], canClear: false, message: 'Svarene er stengt. Du kan fortsatt si fra hvis du ikke kan.' }
  }
  if (timing.respondBy && toOsloDate(now) > timing.respondBy) {
    return { phase: 'late', allowed: ['no'], canClear: false, message: 'Svarfristen er ute. Du kan fortsatt si fra hvis du ikke kan.' }
  }
  return { phase: 'open', allowed: [...CALLOUT_STATUSES], canClear: true, message: '' }
}

/** «3 kan» eller «3 av 6 kan». */
export function calloutCountLabel(yes: number, needed: number | null): string {
  return needed === null ? `${yes} kan` : `${yes} av ${needed} kan`
}

/** Linjen under knappene, etter hva svaret betyr for akkurat denne typen. */
export function calloutMineLabel(kind: CalloutKind, status: CalloutStatus, isCrew: boolean): string {
  if (status === 'no') return isCrew ? 'Du er satt opp, men har svart at du ikke kan' : 'Du har svart at du ikke kan'
  if (kind === 'spilleoppdrag' && isCrew) return 'Du er med på oppdraget'
  if (status === 'maybe') return 'Du har svart usikker'
  return kind === 'dugnad' ? 'Du er med' : 'Du er aktuell. Den ansvarlige velger hvem som spiller.'
}

/** Sortering i velgeren: de som kan først, de som ikke kan til slutt. */
export const CALLOUT_STATUS_RANK: Record<CalloutStatus | 'none', number> = { yes: 0, maybe: 1, none: 2, no: 3 }
