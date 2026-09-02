import { type PermissionInfo, describePermissions, permissionsInclude } from './permissions'

/**
 * Ren logikk for roller (#78 navnekollisjoner, #48 flere roller per medlem).
 * Ingen server- eller DOM-avhengigheter, slik at reglene kan testes uten database.
 *
 * **Ingen zod her.** `Shell.tsx` bruker `roleLabel`, og `Shell` ligger i
 * rot-chunken som lastes på HVER side — en zod-import her dro hele
 * skjemabiblioteket (~130 kB ubehandlet) inn i det bundtet, målt i et bygg.
 * Valideringsskjemaet for et rollesett bor derfor sammen med de andre
 * inndata-reglene for medlemsadministrasjonen, i `src/lib/invitation.ts`.
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

// ---------- Flere roller per medlem (#48) ----------

/** Det oversiktene og velgerne trenger å vite om en rolle. */
export type RoleSummary = {
  id: string
  name: string
  isSystem: boolean
  /** Rettighetene rollen gir, slik de står i rollematrisen. `*` = full tilgang. */
  permissions: string[]
}

/**
 * Rollene et medlem faktisk har, med fallback til den deprecated énrolle-kolonnen.
 *
 * Fallbacken er ikke pynt: mellom migrasjonen og deployen kjører fortsatt gammel
 * kode, og en konto som opprettes i det vinduet får bare `member_profiles.role_id`.
 * Uten fallbacken ville et slikt medlem logget inn uten en eneste rettighet.
 * Finnes det koblingsrader, er de sannheten og kolonnen ignoreres helt.
 */
export function effectiveRoleIds(linkedRoleIds: string[], legacyRoleId?: string | null): string[] {
  const unique = [...new Set(linkedRoleIds)]
  if (unique.length > 0) return unique
  return legacyRoleId ? [legacyRoleId] : []
}

/**
 * Tilgangene til et medlem = UNIONEN av rettighetene fra alle rollene. Ingen
 * rolle kan trekke fra, så en person mister aldri noe ved å få et verv til.
 * Resultatet er sortert og uten duplikater, slik at to like rollesett alltid gir
 * nøyaktig samme liste (viktig for øyeblikksbilder og tester).
 */
export function unionRolePermissions(roleIds: string[], permissionsByRole: Map<string, string[]>): string[] {
  const out = new Set<string>()
  for (const roleId of roleIds) {
    for (const permission of permissionsByRole.get(roleId) ?? []) out.add(permission)
  }
  return [...out].sort()
}

/**
 * Verdien den deprecated kolonnen `member_profiles.role_id` skal ha etter en
 * endring. Kolonnen leses aldri når koblingsradene finnes, men den er NOT NULL
 * og skal ikke bli usann: beholder medlemmet rollen den pekte på, står den, og
 * ellers arver den den første valgte. At den ikke hopper rundt uten grunn gjør
 * også revisjonsloggen lesbar.
 */
export function primaryRoleId(selectedRoleIds: string[], currentRoleId?: string | null): string | null {
  if (selectedRoleIds.length === 0) return null
  if (currentRoleId && selectedRoleIds.includes(currentRoleId)) return currentRoleId
  return selectedRoleIds[0]!
}

/**
 * Rollene i rekkefølgen rollelista har, ikke i den rekkefølgen de tilfeldigvis
 * ble haket av. Ellers ville «Musiker · Styremedlem» og «Styremedlem · Musiker»
 * vært to måter å vise det samme medlemmet på.
 */
export function orderRoles<T extends { id: string }>(roleIds: string[], allRoles: T[]): T[] {
  const wanted = new Set(roleIds)
  return allRoles.filter((role) => wanted.has(role.id))
}

/** Rollene som én lesbar linje. Tom liste skal si fra, ikke bli et tomt felt. */
export function roleLabel(roleNames: string[]): string {
  return roleNames.length > 0 ? roleNames.join(' · ') : 'Ingen rolle'
}

/** Én rettighet, og rollene som er grunnen til at medlemmet har den. */
export type AccessSource = { permission: PermissionInfo; roleNames: string[] }

/**
 * Svaret på «hva får denne personen faktisk tilgang til, og hvorfor?» — det
 * akseptansekriteriet i #48 som ikke handler om datamodellen.
 *
 * Hver rettighet i unionen listes med rollene som gir den. En rolle med `*`
 * (administrator) gir alt, og oppgis som kilde til hver enkelt rettighet — det
 * er sannheten, og det er mer forståelig enn en egen «alt»-rad.
 */
export function accessSources(roles: Array<{ name: string; permissions: string[] }>): AccessSource[] {
  const union = new Set<string>()
  for (const role of roles) for (const p of role.permissions) union.add(p)
  return describePermissions(union).map((permission) => ({
    permission,
    roleNames: roles.filter((r) => permissionsInclude(r.permissions, permission.key)).map((r) => r.name),
  }))
}

