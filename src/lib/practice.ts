/**
 * Frivillig øvingsstatus per medlem per prosjektverk (#30).
 *
 * **Tonen er en del av kravet, ikke pynt.** Saken ber om noe som «føles
 * støttende, ikke kontrollerende». Det har tre konkrete følger som denne
 * modulen håndhever, og som ikke er til forhandling:
 *
 * 1. **Ingen «mangler status»-liste.** `PracticeCounts.total` teller dem som HAR
 *    sagt noe — aldri antall aktive medlemmer. Uten et totaltall finnes det
 *    ingen rest å presentere som en mangel, og «7 av 28 har ikke svart» kan ikke
 *    regnes ut av det vi sender til klienten.
 * 2. **Medlemmet eier sin egen rad.** Bare du kan sette og fjerne din status.
 *    Det finnes ingen «registrer for»-vei her, i motsetning til oppmøte
 *    (`src/lib/attendance.ts`), der en fraværsansvarlig faktisk skal kunne føre
 *    for andre. Status er en invitasjon til å be om hjelp, ikke en journal.
 * 3. **«Trenger hjelp» er et ønske, ikke en advarsel.** Etiketten sier «Vil øve
 *    med noen», og navnene vises kun til dem som kan gjøre noe med det:
 *    dirigenten og din egen gruppeleder.
 *
 * Innsynsregelen er bevisst BYGGET LIK `attendanceScope`: `all` for den som
 * forvalter, `sections` for gruppelederen med aktiv `section_leaders`-binding,
 * `self` for alle andre. Rettighetene er andre (her: `projects.manage` /
 * `calendar.manage`), men to ulike former for «hvem ser hvem» i samme app ville
 * vært en felle. Modulen er egen og ikke en utvidelse av `attendance.ts` fordi
 * de to ikke skal kunne endres i utakt ved et uhell.
 */

import { permissionsInclude } from './permissions'

export const PRACTICE_STATUSES = ['looked_at', 'practicing', 'needs_help'] as const
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number]

export function isPracticeStatus(value: string): value is PracticeStatus {
  return (PRACTICE_STATUSES as readonly string[]).includes(value)
}

/** Etikettene medlemmet velger mellom. Alle tre er noe man sier om SEG SELV. */
export const PRACTICE_LABELS: Record<PracticeStatus, string> = {
  looked_at: 'Sett på',
  practicing: 'Øver på',
  needs_help: 'Vil øve med noen',
}

/** Den lille forklaringen under valget — det er den som setter tonen. */
export const PRACTICE_HINTS: Record<PracticeStatus, string> = {
  looked_at: 'Jeg har spilt gjennom den',
  practicing: 'Jeg jobber med den nå',
  needs_help: 'Jeg vil gjerne ta den med noen',
}

/** Kort merknad: «takt 40 og utover», «trenger sidemann på duetten». */
export const PRACTICE_COMMENT_MAX = 200

/** Trimmer og kutter kommentaren. Tom tekst er `null`, ikke tom streng. */
export function normalizePracticeComment(input: string | null | undefined): string | null {
  const trimmed = (input ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, PRACTICE_COMMENT_MAX) : null
}

/**
 * Rettighetene som gir hele oversikten. Dirigenten har som regel begge:
 * `calendar.manage` (øvingsplanen) og `projects.manage` (programmet). Det holder
 * å ha én av dem — den som planlegger øvingen skal kunne se hva folk ber om
 * hjelp til, uten også å måtte forvalte repertoaret.
 */
export const PRACTICE_OVERVIEW_PERMISSIONS = ['projects.manage', 'calendar.manage']

/** Utsnittet av `Me` reglene bruker. Samme form som `AttendanceViewer`. */
export type PracticeViewer = {
  id: string
  permissions: string[]
  /** Stemmene brukeren er gruppeleder for, ekspandert nedover (`me.leadsPartIds`). */
  leadsPartIds: string[]
}

export type PracticeMember = {
  id: string
  partIds: string[]
}

export type PracticeScope = { kind: 'all' } | { kind: 'sections'; partIds: string[] } | { kind: 'self' }

/**
 * Hvor mye av navnelisten leseren får se — samme tre nivåer som
 * `attendanceScope`, med prosjektets rettigheter i stedet for fraværets.
 */
export function practiceScope(viewer: PracticeViewer | null | undefined): PracticeScope {
  if (!viewer) return { kind: 'self' }
  if (PRACTICE_OVERVIEW_PERMISSIONS.some((p) => permissionsInclude(viewer.permissions, p))) {
    return { kind: 'all' }
  }
  if (viewer.leadsPartIds.length > 0) return { kind: 'sections', partIds: viewer.leadsPartIds }
  return { kind: 'self' }
}

/**
 * Får leseren se navnet (og kommentaren) til dette medlemmet? Egen rad er
 * alltid synlig — man skal kunne lese sitt eget svar.
 */
export function canSeeMemberPractice(
  viewer: PracticeViewer,
  member: PracticeMember,
  scope: PracticeScope = practiceScope(viewer),
): boolean {
  if (member.id === viewer.id) return true
  if (scope.kind === 'all') return true
  if (scope.kind === 'self') return false
  return member.partIds.some((partId) => scope.partIds.includes(partId))
}

export type PracticeCounts = {
  lookedAt: number
  practicing: number
  needsHelp: number
  /**
   * Antall som har markert NOE. Bevisst ikke antall medlemmer: se punkt 1 i
   * modulkommentaren. Det finnes ingen rest å kalle en mangel.
   */
  total: number
}

export function countPractice(rows: Array<{ status: PracticeStatus }>): PracticeCounts {
  const counts: PracticeCounts = { lookedAt: 0, practicing: 0, needsHelp: 0, total: 0 }
  for (const row of rows) {
    if (row.status === 'looked_at') counts.lookedAt++
    else if (row.status === 'practicing') counts.practicing++
    else if (row.status === 'needs_help') counts.needsHelp++
    else continue
    counts.total++
  }
  return counts
}

/**
 * «4 øver på den · 2 har sett på den · 1 vil øve med noen». Tomme ledd
 * utelates, og uten noen markeringer sier den ingenting om hvem som ikke har
 * svart — den sier bare at ingen har sagt noe ennå.
 */
export function practiceSummary(counts: PracticeCounts): string {
  const parts: string[] = []
  if (counts.practicing > 0) parts.push(`${counts.practicing} øver på den`)
  if (counts.lookedAt > 0) parts.push(`${counts.lookedAt} har sett på den`)
  if (counts.needsHelp > 0) {
    parts.push(counts.needsHelp === 1 ? '1 vil øve med noen' : `${counts.needsHelp} vil øve med noen`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'Ingen har markert noe ennå'
}
