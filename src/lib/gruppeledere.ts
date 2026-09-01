/**
 * Regelen for hvem som er gruppeleder (#81). Ren funksjon uten server- eller
 * DOM-avhengigheter, slik at den kan brukes både av guarden i
 * `src/server/gruppeledere.ts`, av `beforeLoad` på `/gruppeledere`, av
 * toppmenyen i `Shell.tsx` og av `areasFor` i `src/lib/hub.ts` — uten at noen av
 * dem skriver sin egen variant.
 *
 * Tilgangen er BEVISST ikke koblet til visningsnavnet på en rolle: «Gruppeleder»
 * som rollenavn er en tekst noen kan endre i rollematrisen, og den ville ikke
 * sagt noe om hvem hen faktisk leder. To ting må være sanne samtidig:
 *
 * 1. rettigheten `members.manage.section` (eller `*`), og
 * 2. minst én aktiv rad i `section_leaders` (`me.leadsPartIds`, beregnet i
 *    `currentUser()`).
 *
 * Nummer to er den viktige: en admin uten leiarbinding leder ingen gruppe og
 * skal ikke sitte i gruppeledernes chat. Og siden `leadsPartIds` leses ferskt
 * ved hvert kall, forsvinner tilgangen med én gang bindingen fjernes.
 */

/** Rettigheten som gater gruppelederområdet. Én sannhetskilde for nøkkelen. */
export const GROUP_LEADER_PERMISSION = 'members.manage.section'

/** Det lille utsnittet av `Me` regelen faktisk bruker. */
export type GroupLeaderSubject = {
  permissions: string[]
  /** Stemmene brukeren er seksjonsleder for, ekspandert nedover treet. */
  leadsPartIds: string[]
}

/**
 * Rettighet OG leiarbinding. Mangler én av dem, finnes ikke området for deg.
 */
export function isGroupLeader(me: GroupLeaderSubject | null | undefined): boolean {
  if (!me) return false
  const allowed = me.permissions.includes('*') || me.permissions.includes(GROUP_LEADER_PERMISSION)
  return allowed && me.leadsPartIds.length > 0
}
