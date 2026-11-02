/**
 * Reglene for oppmøte og fravær på en kalenderforekomst (#82 + #24). Rene
 * funksjoner uten server- eller DOM-avhengigheter, slik at innsynsregelen kan
 * testes uten database — og slik at serveren og UI-et ikke kan komme i utakt
 * om hvem som får se hva.
 *
 * **Én status per medlem per forekomst.** Selvbetjent RSVP (#24) og
 * administrert fravær (#82) skriver til SAMME rad i `event_attendance`. Det er
 * ikke en forenkling, det er selve poenget: to tabeller ville før eller siden
 * gitt to svar på «kommer Ingrid på torsdag?», og ingen av dem ville vært
 * gale. Siste skriving vinner; `source` (`self` | `admin`) og `registered_by`
 * er sporbarheten — man ser hvem som satte statusen, ikke bare hva den er.
 *
 * **Fravær er unntaket (2. november 2026).** Alle aktive medlemmer regnes som
 * kommer; man trykker bare når man IKKE kan («Kan ikke komme»), og angrer ved å
 * fjerne raden igjen. Ingen rad = kommer. `attending` og `unsure` er fortsatt
 * gyldige verdier — mobil-API v1 og installerte apper sender dem, og eldre rader
 * har dem — men nettsiden lager dem ikke lenger: `attending` er det samme som
 * ingen rad, og `unsure` vises som «Usikker» der den finnes.
 *
 * **Ingen fraværsgrunn.** Feltet som finnes er en kort, valgfri kommentar, og
 * den følger samme innsyn som navnelisten (#82: «unngå å samle inn
 * fråværsgrunn eller andre sensitive opplysningar»).
 */

import { SECTION_LABELS, SECTION_ORDER, type SectionId } from './taxonomy'

export const ATTENDANCE_STATUSES = ['attending', 'not_attending', 'unsure'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const ATTENDANCE_SOURCES = ['self', 'admin'] as const
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]

/** Rettigheten som gir fullt innsyn i og skriverett på andres oppmøte. */
export const ATTENDANCE_PERMISSION = 'attendance.manage'
/** Rettigheten som gir skriverett på øvingsplanen (verk, rekkefølge, prosjektkobling). */
export const CALENDAR_PERMISSION = 'calendar.manage'

/** Kort kommentar — «kommer 19:30» eller «sitter i tog». Ikke et fraværsskjema. */
export const ATTENDANCE_COMMENT_MAX = 200

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  attending: 'Kommer',
  not_attending: 'Kan ikke',
  unsure: 'Usikker',
}

/**
 * Statusen slik den skal leses: `null` (ingen rad) og `attending` er det samme
 * — medlemmet regnes som kommer. Bruk denne i stedet for å sammenligne med
 * `'attending'`, så en gammel rad og en manglende rad aldri vises ulikt.
 */
export function effectiveStatus(status: AttendanceStatus | null | undefined): AttendanceStatus {
  return status === 'not_attending' || status === 'unsure' ? status : 'attending'
}

/** Har medlemmet meldt noe annet enn «kommer»? Det er dette fraværsoversikten lister. */
export function hasReportedAbsence(status: AttendanceStatus | null | undefined): boolean {
  return effectiveStatus(status) !== 'attending'
}

/** Hurtigvalg som fyller ut kommentaren. Ikke et felt i databasen — bare tekst. */
export const ABSENCE_REASONS = ['Jobb', 'Syk', 'Reise', 'Annet'] as const
export type AbsenceReason = (typeof ABSENCE_REASONS)[number]

const REASON_SEPARATOR = ' – '

/** «Jobb – rekker kanskje siste halvtime». Tomt er `null`. */
export function composeAbsenceComment(reason: AbsenceReason | null, text: string): string | null {
  return [reason, text.trim()].filter(Boolean).join(REASON_SEPARATOR) || null
}

/**
 * Det motsatte av `composeAbsenceComment`, så arket kan åpnes igjen med grunnen
 * valgt og bare fritekstdelen i feltet — ellers ville «Jobb» blitt lagt til to
 * ganger når man endrer en kommentar.
 */
export function splitAbsenceComment(comment: string | null | undefined): { reason: AbsenceReason | null; text: string } {
  const value = comment ?? ''
  for (const reason of ABSENCE_REASONS) {
    if (value === reason) return { reason, text: '' }
    if (value.startsWith(reason + REASON_SEPARATOR)) return { reason, text: value.slice(reason.length + REASON_SEPARATOR.length) }
  }
  return { reason: null, text: value }
}

/** Utsnittet av `Me` reglene faktisk bruker. */
export type AttendanceViewer = {
  id: string
  permissions: string[]
  /** Stemmene brukeren er seksjonsleder for, ekspandert nedover (`me.leadsPartIds`). */
  leadsPartIds: string[]
}

/** Et medlem slik oversikten trenger det. `partIds` er medlemmets tildelte stemmer. */
export type AttendanceMember = {
  id: string
  partIds: string[]
}

function allows(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission)
}

/**
 * Hvor mye av navnelisten leseren får se.
 *
 * - `all` — `attendance.manage` (eller admin `*`): hele korpset, med navn og
 *   kommentarer.
 * - `sections` — en gruppeleder med aktiv `section_leaders`-binding: navnene i
 *   SINE egne stemmegrupper, ingen andre. Bindingen bærer tilgangen alene, som
 *   i `isGroupLeader` (#81) — en gruppeleder er sjelden en rettighetshaver.
 * - `self` — alle andre: bare sin egen status. Tallene får de uansett.
 */
export type AttendanceScope = { kind: 'all' } | { kind: 'sections'; partIds: string[] } | { kind: 'self' }

export function attendanceScope(viewer: AttendanceViewer | null | undefined): AttendanceScope {
  if (!viewer) return { kind: 'self' }
  if (allows(viewer.permissions, ATTENDANCE_PERMISSION)) return { kind: 'all' }
  if (viewer.leadsPartIds.length > 0) return { kind: 'sections', partIds: viewer.leadsPartIds }
  return { kind: 'self' }
}

/**
 * Får leseren se navn (og kommentar) for dette medlemmet? Egen rad er alltid
 * synlig — man skal kunne lese sitt eget svar.
 */
export function canSeeMemberAttendance(
  viewer: AttendanceViewer,
  member: AttendanceMember,
  scope: AttendanceScope = attendanceScope(viewer),
): boolean {
  if (member.id === viewer.id) return true
  if (scope.kind === 'all') return true
  if (scope.kind === 'self') return false
  return member.partIds.some((partId) => scope.partIds.includes(partId))
}

/**
 * Kan `viewer` sette eller fjerne status for `target`?
 *
 * - Seg selv: alltid (det er RSVP-en, `source: 'self'`).
 * - `attendance.manage`/`*`: hvem som helst (`source: 'admin'`).
 * - Gruppeleder: kun medlemmer i egne stemmegrupper (`source: 'admin'`).
 *
 * Ingen kan svare på en annens vegne uten en av de to siste; en vanlig musiker
 * kan bare røre sin egen rad. Håndheves server-side i `src/server/event-meta.ts`,
 * med målets stemmer lest ferskt fra databasen (ikke fra klienten).
 */
export function canSetAttendanceFor(viewer: AttendanceViewer, target: AttendanceMember): boolean {
  if (viewer.id === target.id) return true
  if (allows(viewer.permissions, ATTENDANCE_PERMISSION)) return true
  if (viewer.leadsPartIds.length === 0) return false
  return target.partIds.some((partId) => viewer.leadsPartIds.includes(partId))
}

/** `self` når man svarer for seg selv, ellers `admin`. Ett sted, så kolonnen ikke kan lyve. */
export function attendanceSourceFor(viewer: AttendanceViewer, targetUserId: string): AttendanceSource {
  return viewer.id === targetUserId ? 'self' : 'admin'
}

export type AttendanceCounts = {
  /** Aktive medlemmer som regnes som kommer — uten rad, eller med `attending`. */
  attending: number
  notAttending: number
  unsure: number
  /** Antall aktive medlemmer totalt. */
  total: number
}

/**
 * Tallene alle får se — også den som ikke får se navnelisten. «24 kommer · 3
 * kan ikke» er ikke personopplysninger, det er om øvelsen kan gjennomføres.
 * Siden fravær er unntaket, er «kommer» alle som ikke har meldt noe annet.
 */
export function countAttendance(rows: Array<{ status: AttendanceStatus | null }>): AttendanceCounts {
  const counts: AttendanceCounts = { attending: 0, notAttending: 0, unsure: 0, total: rows.length }
  for (const row of rows) {
    const status = effectiveStatus(row.status)
    if (status === 'not_attending') counts.notAttending++
    else if (status === 'unsure') counts.unsure++
    else counts.attending++
  }
  return counts
}

/** «24 kommer · 3 kan ikke · 1 usikker». Tomme ledd utelates (bortsett fra «kommer»). */
export function attendanceSummary(counts: AttendanceCounts): string {
  if (counts.total === 0) return 'Ingen aktive medlemmer'
  const parts: string[] = [`${counts.attending} kommer`]
  if (counts.notAttending > 0) parts.push(`${counts.notAttending} kan ikke`)
  if (counts.unsure > 0) parts.push(`${counts.unsure} ${counts.unsure === 1 ? 'usikker' : 'usikre'}`)
  return parts.join(' · ')
}

/** Medlemmer uten stemme havner her — de skal ikke forsvinne ut av oversikten. */
export const NO_SECTION = 'none' as const
export type AttendanceSectionId = SectionId | typeof NO_SECTION

export function sectionLabel(section: AttendanceSectionId): string {
  return section === NO_SECTION ? 'Uten stemmegruppe' : SECTION_LABELS[section]
}

export type SectionGroup<T> = {
  section: AttendanceSectionId
  label: string
  members: T[]
}

/**
 * Grupperer medlemmene per stemmegruppe i besetningens rekkefølge
 * (`SECTION_ORDER`), ikke alfabetisk: en dirigent leser lista som et
 * besetningskart. Tomme grupper utelates.
 */
export function groupBySection<T extends { section: string | null; sortOrder?: number; name: string }>(
  members: T[],
): Array<SectionGroup<T>> {
  const order: AttendanceSectionId[] = [...SECTION_ORDER, NO_SECTION]
  const groups = new Map<AttendanceSectionId, T[]>()
  for (const member of members) {
    const raw = member.section
    const section: AttendanceSectionId =
      raw !== null && (SECTION_ORDER as readonly string[]).includes(raw) ? (raw as SectionId) : NO_SECTION
    const list = groups.get(section) ?? []
    list.push(member)
    groups.set(section, list)
  }
  return order
    .filter((section) => (groups.get(section)?.length ?? 0) > 0)
    .map((section) => ({
      section,
      label: sectionLabel(section),
      members: groups
        .get(section)!
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name, 'nb')),
    }))
}

/** Trimmer og kutter kommentaren. Tom tekst er `null`, ikke tom streng. */
export function normalizeAttendanceComment(input: string | null | undefined): string | null {
  const trimmed = (input ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, ATTENDANCE_COMMENT_MAX) : null
}
