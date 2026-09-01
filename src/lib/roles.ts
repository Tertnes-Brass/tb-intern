/**
 * Ren logikk for rollenavn (#78). Ingen server- eller DOM-avhengigheter, slik at
 * reglene kan testes uten database.
 *
 * Bakgrunn: migrasjon `0008_board-role.sql` la inn systemrollen `board`
 * («Styremedlem») og sjekket bare rolle-ID-en. I prod fantes det allerede en
 * brukeropprettet rolle med ID `styremedlem` og NØYAKTIG samme visningsnavn, og
 * rollematrisen endte med to visuelt identiske rader med ulike rettigheter.
 * Ingen kunne se hvilken som var hvilken, og den gamle kunne ikke slettes fordi
 * invitasjoner fortsatt pekte på den.
 *
 * Derfor: sammenlign rollenavn *normalisert*, ikke tegn for tegn, både når en
 * admin oppretter/omdøper en rolle og når `seedBaseConfig` legger inn en
 * manglende systemrolle.
 */

/** Kombinerende diakritiske tegn (U+0300–U+036F) — det NFD skiller ut. */
const COMBINING_MARKS = /[̀-ͯ]/g

/**
 * Navnet slik kollisjonssjekken ser det: trimmet, med indre mellomrom slått
 * sammen til ett, i små bokstaver og uten diakritika (NFD + fjernede
 * kombinasjonstegn, så «Å» ≡ «A» og «é» ≡ «e»).
 *
 * `ø` og `æ` dekomponerer ikke i NFD og beholdes derfor som de er: «Møter» og
 * «Moter» er to synlig forskjellige ord, og skal ikke regnes som samme navn.
 * Poenget er å fange navn en leser ikke klarer å skille, ikke å slå sammen alt
 * som ligner.
 */
export function normalizeRoleName(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Det kollisjonssjekken trenger å vite om en eksisterende rolle. */
export type RoleNameCandidate = {
  id: string
  name: string
  isSystem: boolean
}

/**
 * Finner en eksisterende rolle med samme normaliserte navn, eller `null`.
 *
 * `excludeId` er rollen som skal omdøpes — den kolliderer aldri med seg selv.
 * Systemroller prioriteres i svaret: er det flere treff, er systemrollen den
 * brukeren trenger å få vite om (den kan ikke slettes eller flyttes på).
 */
export function findRoleNameCollision(
  name: string,
  existing: RoleNameCandidate[],
  options: { excludeId?: string } = {},
): RoleNameCandidate | null {
  const normalized = normalizeRoleName(name)
  if (!normalized) return null
  const matches = existing.filter(
    (role) => role.id !== options.excludeId && normalizeRoleName(role.name) === normalized,
  )
  return matches.find((role) => role.isSystem) ?? matches[0] ?? null
}

/**
 * Feilmeldingen brukeren får. Den peker eksplisitt på hvilken rolle som står i
 * veien og om den er systemrollen, slik at kollisjonen kan avklares manuelt
 * (issue #78: «Vis tydeleg kva rolle som er systemrolla»).
 */
export function roleNameCollisionMessage(collision: RoleNameCandidate): string {
  const what = collision.isSystem
    ? `systemrollen «${collision.name}» (${collision.id})`
    : `rollen «${collision.name}» (${collision.id})`
  return `Det finnes allerede ${what}. To roller med samme navn kan ikke skilles i rollematrisen — velg et annet navn, eller gi den eksisterende rollen nytt navn først.`
}
