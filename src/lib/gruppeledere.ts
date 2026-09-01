/**
 * Regelen for hvem som er gruppeleder (#81). Ren funksjon uten server- eller
 * DOM-avhengigheter, slik at den kan brukes både av guarden i
 * `src/server/gruppeledere.ts`, av `beforeLoad` på `/gruppeledere`, av
 * toppmenyen i `Shell.tsx` og av `areasFor` i `src/lib/hub.ts` — uten at noen av
 * dem skriver sin egen variant.
 *
 * Tilgangen er BEVISST ikke koblet til visningsnavnet på en rolle: «Gruppeleder»
 * som rollenavn er en tekst noen kan endre i rollematrisen, og den ville ikke
 * sagt noe om hvem hen faktisk leder. Det som teller er **leiarbindingen**:
 * minst én aktiv rad i `section_leaders` (`me.leadsPartIds`, beregnet i
 * `currentUser()`).
 *
 * Justert 2. september 2026 (var opprinnelig rettighet OG binding, per #81):
 * korpset har én rolle per medlem, og de faktiske gruppelederne i prod hadde
 * rollene Styremedlem og Musiker — de kunne aldri fått `members.manage.section`
 * uten å miste rollen sin. Bindingen er uansett den eksplisitte, admin-styrte
 * sannheten (settes kun via «Seksjonsleder»-modalen i /medlemmer, gated på
 * global `members.manage`), så den bærer tilgangen alene. Rettigheten
 * `members.manage.section` styrer fortsatt stemme-TILDELING i eget omfang
 * (src/server/members.ts) — det er en annen ting enn å se området.
 *
 * Siden `leadsPartIds` leses ferskt ved hvert kall, forsvinner tilgangen med
 * én gang bindingen fjernes.
 */

/** Rettigheten for stemmetildeling i eget omfang — IKKE en port til området. */
export const GROUP_LEADER_PERMISSION = 'members.manage.section'

/** Det lille utsnittet av `Me` regelen faktisk bruker. */
export type GroupLeaderSubject = {
  permissions: string[]
  /** Stemmene brukeren er seksjonsleder for, ekspandert nedover treet. */
  leadsPartIds: string[]
}

/**
 * Leiarbindingen alene avgjør. Ingen binding, ikke noe område — uansett rolle.
 */
export function isGroupLeader(me: GroupLeaderSubject | null | undefined): boolean {
  if (!me) return false
  return me.leadsPartIds.length > 0
}
