/**
 * Reglene for sosiale arrangement med påmelding (#31): pub etter øving,
 * julebord, fjelltur, dugnad, brettspillkveld. Rene funksjoner uten server-
 * eller DOM-avhengigheter, slik at serveren og skjermen ikke kan komme i utakt
 * om hvem som får plass, når påmeldingen er stengt og hvem som kan endre hva.
 *
 * **Egne, lokale arrangement — ikke Google-feeden.** De har en egen id og en
 * egen detaljside, og blandes bevisst ikke inn i `occurrenceKey`-verdenen
 * (`src/lib/occurrence.ts`), som forutsetter en hendelse i feeden å utlede
 * nøkkelen fra. De vises likevel i kalenderområdets liste sammen med
 * feed-hendelsene — `mergeCalendarRows` er stedet det skjer, og den er felles
 * for `/kalender` og hub-en så de to listene ikke kan sortere ulikt.
 *
 * **Statusene er de samme tre ordene som oppmøte (#24), men er ikke samme
 * begrep.** `src/lib/attendance.ts` svarer på «kom Ingrid på øvelsen», med
 * seksjonsinnsyn, registrert fravær og en gruppelederregel. Her er spørsmålet
 * «blir du med på julebordet», med frist, maks antall og venteliste — og
 * deltakerlista er åpen for alle medlemmer. To tabeller, to regelsett; at
 * etikettene er like er en likhet i ordvalg, ikke en delt sannhet.
 */

import { wallClockToUtc } from './wallclock'

export const SOCIAL_STATUSES = ['attending', 'not_attending', 'unsure'] as const
export type SocialStatus = (typeof SOCIAL_STATUSES)[number]

export const SOCIAL_LABELS: Record<SocialStatus, string> = {
  attending: 'Kommer',
  not_attending: 'Kommer ikke',
  unsure: 'Usikker',
}

/**
 * Rettigheten som gir moderasjon av ANDRES arrangement. Å opprette krever
 * ingen rettighet i det hele tatt — korpset er et sosialt fellesskap, og lav
 * terskel er hele poenget med saken. Arrangøren eier sitt eget; denne nøkkelen
 * er for den som må rydde opp i noe andre har laget, på samme måte som
 * `posts.publish` modererer veggen.
 */
export const SOCIAL_MODERATE_PERMISSION = 'members.manage'

export const SOCIAL_TITLE_MAX = 120
export const SOCIAL_DESCRIPTION_MAX = 2000
export const SOCIAL_LOCATION_MAX = 160
/** Kort merknad ved påmelding: kosthold, skyss, «kommer etter jobb». */
export const SOCIAL_COMMENT_MAX = 200
/** Et tak som er høyt nok for hele korpset med følge, lavt nok til å fange skrivefeil. */
export const SOCIAL_CAPACITY_MAX = 500

// ---------- Opprettelse og redigering ----------

/** Feltene skjemaet sender inn. Dato og klokkeslett er norsk veggklokke. */
export type SocialEventDraft = {
  title: string
  description?: string | null
  location?: string | null
  /** `YYYY-MM-DD` fra `<input type="date">`. */
  startDate: string
  /** `HH:MM` fra `<input type="time">`. */
  startTime: string
  /** Valgfri påmeldingsfrist, kun dato — fristen går ut ved dagens slutt. */
  deadlineDate?: string | null
  /** Valgfritt maks antall. Tom streng betyr «ingen grense». */
  capacity?: string | number | null
}

/** Verdiene som faktisk lagres. Tidspunkter er epoch-ms i UTC. */
export type SocialEventValues = {
  title: string
  description: string | null
  location: string | null
  startsAt: number
  signupDeadline: number | null
  capacity: number | null
}

function trimmed(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').trim()
  return text ? text.slice(0, max) : null
}

/**
 * Validerer og normaliserer skjemaet. Kaster med en norsk feilmelding, som er
 * den brukeren faktisk får se — serverfunksjonen sender den videre uendret.
 *
 * Fristen er en DATO, ikke et klokkeslett: «frist 5. desember» betyr hele den
 * dagen. Er fristen satt til selve arrangementsdagen, går den ut når
 * arrangementet starter — ikke ved midnatt etterpå.
 *
 * Et tidspunkt i fortiden avvises IKKE. En arrangør skal kunne rette adressen
 * på gårsdagens dugnad, og et arrangement som har vært stenger uansett for
 * påmelding av seg selv (`signupState`).
 */
export function sanitizeSocialInput(draft: SocialEventDraft): SocialEventValues {
  const title = trimmed(draft.title, SOCIAL_TITLE_MAX)
  if (!title) throw new Error('Arrangementet må ha en tittel')

  const startsAt = wallClockToUtc(draft.startDate ?? '', draft.startTime ?? '')
  if (startsAt === null) throw new Error('Sett en gyldig dato og et klokkeslett for start')

  let signupDeadline: number | null = null
  const deadlineDate = (draft.deadlineDate ?? '').trim()
  if (deadlineDate) {
    const endOfDay = wallClockToUtc(deadlineDate, '23:59')
    if (endOfDay === null) throw new Error('Påmeldingsfristen er ikke en gyldig dato')
    if (deadlineDate > draft.startDate.trim()) {
      throw new Error('Påmeldingsfristen kan ikke være etter at arrangementet starter')
    }
    signupDeadline = Math.min(endOfDay, startsAt)
  }

  let capacity: number | null = null
  const rawCapacity = typeof draft.capacity === 'number' ? String(draft.capacity) : (draft.capacity ?? '').trim()
  if (rawCapacity) {
    const value = Number(rawCapacity)
    if (!Number.isInteger(value) || value < 1 || value > SOCIAL_CAPACITY_MAX) {
      throw new Error(`Maks antall må være et helt tall mellom 1 og ${SOCIAL_CAPACITY_MAX}`)
    }
    capacity = value
  }

  return {
    title,
    description: trimmed(draft.description, SOCIAL_DESCRIPTION_MAX),
    location: trimmed(draft.location, SOCIAL_LOCATION_MAX),
    startsAt,
    signupDeadline,
    capacity,
  }
}

function allows(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission)
}

/**
 * Arrangøren sin egen, eller en moderator. Samme form som `canEditPost` på
 * veggen: en arrangør uten `host_user_id` (brukeren er slettet) kan bare
 * moderatoren rydde i.
 */
export function canEditSocialEvent(
  viewer: { id: string; permissions: string[] } | null | undefined,
  event: { hostUserId: string | null },
): boolean {
  if (!viewer) return false
  if (allows(viewer.permissions, SOCIAL_MODERATE_PERMISSION)) return true
  return event.hostUserId !== null && event.hostUserId === viewer.id
}

// ---------- Påmelding ----------

export type SocialEventTiming = {
  startsAt: number
  signupDeadline: number | null
  cancelledAt: number | null
}

export type SocialSignupState = {
  /** Kan man melde seg på (eller endre til hva som helst)? */
  open: boolean
  /** Statusene som kan settes nå. Tom liste betyr at svaret er låst. */
  allowed: SocialStatus[]
  /** Kan svaret fjernes helt? Kun mens påmeldingen er åpen. */
  canClear: boolean
  /** Én setning om hvorfor. Tom når påmeldingen er åpen. */
  message: string
}

/**
 * Hva et medlem kan gjøre med svaret sitt nå.
 *
 * Rekkefølgen er bevisst: et avlyst arrangement er avlyst uansett frist, og et
 * arrangement som har startet er over uansett hva som står i fristfeltet.
 *
 * **Etter fristen kan man fortsatt melde avbud.** Å låse svaret helt ville
 * gjort at den som blir syk dagen før enten møter opp eller lar arrangøren
 * dekke på til en som ikke kommer — og plassen ville ikke gått videre til
 * ventelista. Å melde seg PÅ etter fristen er derimot stengt: da har arrangøren
 * allerede bestilt bord.
 */
export function signupState(event: SocialEventTiming, now: number): SocialSignupState {
  if (event.cancelledAt !== null) {
    return { open: false, allowed: [], canClear: false, message: 'Arrangementet er avlyst.' }
  }
  if (now >= event.startsAt) {
    return { open: false, allowed: [], canClear: false, message: 'Arrangementet har vært.' }
  }
  if (event.signupDeadline !== null && now > event.signupDeadline) {
    return {
      open: false,
      allowed: ['not_attending'],
      canClear: false,
      message: 'Påmeldingsfristen har gått ut. Du kan fortsatt melde avbud.',
    }
  }
  return { open: true, allowed: [...SOCIAL_STATUSES], canClear: true, message: '' }
}

/**
 * Trimmer og kutter kommentaren ved påmelding. Tom tekst er `null`, ikke tom
 * streng — «kommer, men er vegetarianer» og «» skal ikke se like ut i lista.
 */
export function normalizeSocialComment(input: string | null | undefined): string | null {
  const trimmedText = (input ?? '').replace(/\s+/g, ' ').trim()
  return trimmedText ? trimmedText.slice(0, SOCIAL_COMMENT_MAX) : null
}

/** Raden ventelista sorteres på. `attendingSince` er null for alt annet enn «kommer». */
export type QueuedSignup = { userId: string; attendingSince: number | null }

/**
 * Deler dem som har svart «kommer» i dem som har plass og dem som står på
 * venteliste. Førstemann til mølla, sortert på når svaret SIST ble «kommer».
 *
 * Fordelingen skjer ved LESING, ikke ved skriving. Det er derfor ingen
 * `insert … where (select count(*)) < max` er nødvendig — som er greit, siden
 * D1 ikke har interaktive transaksjoner. Det gir også den oppførselen man
 * faktisk vil ha: melder én av de påmeldte avbud, rykker nummer én på
 * ventelista opp med det samme, uten et opprydningssteg som kan glemmes.
 *
 * `attendingSince === null` skal ikke forekomme for en «kommer»-rad, men
 * sorteres først om den gjør det — en rad uten tidsstempel er eldre enn alle
 * andre, aldri yngre. Uavgjort brytes på `userId`, så rekkefølgen er den samme
 * ved hver lesing.
 */
export function splitByCapacity<T extends QueuedSignup>(
  attending: T[],
  capacity: number | null,
): { going: T[]; waitlist: T[] } {
  const queue = [...attending].sort(
    (a, b) => (a.attendingSince ?? 0) - (b.attendingSince ?? 0) || a.userId.localeCompare(b.userId),
  )
  if (capacity === null) return { going: queue, waitlist: [] }
  return { going: queue.slice(0, capacity), waitlist: queue.slice(capacity) }
}

export type SocialCounts = {
  /** Har plass. */
  going: number
  /** Har svart «kommer», men står bak maks antall. */
  waitlist: number
  notAttending: number
  unsure: number
}

export function socialCounts(
  rows: Array<{ status: SocialStatus; userId: string; attendingSince: number | null }>,
  capacity: number | null,
): SocialCounts {
  const attending = rows.filter((r) => r.status === 'attending')
  const { going, waitlist } = splitByCapacity(attending, capacity)
  return {
    going: going.length,
    waitlist: waitlist.length,
    notAttending: rows.filter((r) => r.status === 'not_attending').length,
    unsure: rows.filter((r) => r.status === 'unsure').length,
  }
}

/** Ledige plasser, eller `null` når arrangementet ikke har noe tak. */
export function spotsLeft(counts: SocialCounts, capacity: number | null): number | null {
  if (capacity === null) return null
  return Math.max(0, capacity - counts.going)
}

/** «12 av 20 plasser · 2 på venteliste · 3 usikre» — antallet vises alltid. */
export function socialSummary(counts: SocialCounts, capacity: number | null): string {
  const parts: string[] = []
  parts.push(capacity === null ? `${counts.going} påmeldt` : `${counts.going} av ${capacity} plasser`)
  if (counts.waitlist > 0) parts.push(`${counts.waitlist} på venteliste`)
  if (counts.unsure > 0) parts.push(`${counts.unsure} ${counts.unsure === 1 ? 'usikker' : 'usikre'}`)
  return parts.join(' · ')
}

// ---------- Kalenderlista ----------

/** Et sosialt arrangement slik kalenderlista og hub-en trenger det. */
export type SocialListItem = {
  id: string
  title: string
  /** ISO-8601 i UTC, samme form som `CalendarEvent.start` — så listene kan slås sammen. */
  start: string
  location: string | null
  cancelled: boolean
  going: number
  waitlist: number
  capacity: number | null
  /** Leserens eget svar. `null` når hen ikke har svart. */
  myStatus: SocialStatus | null
}

export type CalendarRow<E> =
  | { kind: 'feed'; id: string; start: string; event: E }
  | { kind: 'social'; id: string; start: string; social: SocialListItem }

/**
 * Slår feed-hendelsene og de sosiale arrangementene sammen til ÉN liste sortert
 * på starttidspunkt. Medlemmet har ett program, selv om det har to kilder.
 *
 * Funksjonen deles av `/kalender` og hub-ens «Kommende» nettopp for at de to
 * ikke skal kunne sortere ulikt. Ved likt tidspunkt kommer feed-hendelsen
 * først (`sort` er stabil, og feeden legges inn først): øvelsen er avtalen,
 * puben etterpå er tillegget.
 */
export function mergeCalendarRows<E extends { id: string; start: string }>(
  events: E[],
  social: SocialListItem[],
): Array<CalendarRow<E>> {
  const rows: Array<CalendarRow<E>> = [
    ...events.map((event): CalendarRow<E> => ({ kind: 'feed', id: event.id, start: event.start, event })),
    ...social.map((item): CalendarRow<E> => ({ kind: 'social', id: item.id, start: item.start, social: item })),
  ]
  return rows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
