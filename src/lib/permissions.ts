/**
 * Rettighetskatalogen — de kjente rettighetene med norske etiketter og en
 * forklaring hver (#48).
 *
 * Katalogen lå tidligere i `src/server/settings.ts`. Den er ren data uten
 * server-avhengigheter, og både `/innstillinger` (rollematrisen + rolleoversikten)
 * og `/medlemmer` (rollevelgeren) trenger den. Å importere `settings.ts` fra
 * `members.ts` ville dratt en modul full av `createServerFn`-kall — og dermed
 * `cloudflare:workers` — inn i klientbygget for medlemsruta. Katalogen bor
 * derfor i `lib/`, og `settings.ts` re-eksporterer den for gamle importører.
 *
 * `hint` er teksten en administrator faktisk leser når hen skal svare på «hva
 * får denne personen tilgang til?». Den skal beskrive HANDLINGEN, ikke tabellen.
 */

export type PermissionInfo = { key: string; label: string; hint: string }

/** Kjente rettigheter med norske etiketter — vises i rolle-matrisen. */
export const PERMISSION_CATALOG: PermissionInfo[] = [
  { key: 'works.manage', label: 'Verk og filer', hint: 'Opprette, redigere og laste opp i arkivet' },
  { key: 'projects.manage', label: 'Prosjekter', hint: 'Lage prosjekter, sette repertoar, publisere' },
  { key: 'shares.manage', label: 'Vikarlenker', hint: 'Dele stemmer med vikarer' },
  { key: 'members.manage', label: 'Medlemmer', hint: 'Invitere og endre roller/stemmer' },
  { key: 'members.manage.section', label: 'Lede egen seksjon', hint: 'Tildele stemmer og se noter for egen seksjon' },
  { key: 'scores.view', label: 'Partitur', hint: 'Se og laste ned partitur' },
  { key: 'archive.viewAll', label: 'Se hele arkivet', hint: 'Se og laste ned ALLE stemmer, ikke bare egne' },
  { key: 'downloads.view', label: 'Filtilgangslogg', hint: 'Se hvem som har vist eller lastet ned filer' },
  { key: 'board.manage', label: 'Styrearbeid', hint: 'Se og redigere styrets oppgaver, møter og dokumenter' },
  { key: 'calendar.manage', label: 'Øvingsplan', hint: 'Sette verk, rekkefølge og prosjektkobling på en øvelse' },
  {
    key: 'attendance.manage',
    label: 'Fravær og oppmøte',
    hint: 'Se hele oppmøtelista og registrere fravær for et medlem',
  },
  { key: 'posts.publish', label: 'Beskjeder', hint: 'Skrive og publisere beskjeder til korpset' },
  { key: 'settings.manage', label: 'Innstillinger', hint: 'Administrere besetning og roller' },
]

/** Jokeren administratorrollen har. Slår ut alle enkeltrettigheter. */
export const ALL_PERMISSIONS = '*'

/**
 * Har dette settet rettigheten? Samme regel som `hasPermission` i
 * `src/server/access.ts`, men over en vilkårlig samling — brukes når vi vurderer
 * ANDRE medlemmer enn den innloggede (varsling, omtaler, ansvarlig-lista).
 */
export function permissionsInclude(permissions: Iterable<string>, permission: string): boolean {
  for (const p of permissions) {
    if (p === ALL_PERMISSIONS || p === permission) return true
  }
  return false
}

/**
 * Rettighetene katalogen kjenner, i katalogens rekkefølge. Ukjente nøkler
 * (rettigheter som er tatt ut av katalogen, men står igjen i databasen) faller
 * bevisst ut: rolleoversikten skal beskrive tilgang på norsk, og en nøkkel uten
 * etikett kan den ikke forklare.
 */
export function describePermissions(permissions: Iterable<string>): PermissionInfo[] {
  const set = new Set(permissions)
  if (set.has(ALL_PERMISSIONS)) return [...PERMISSION_CATALOG]
  return PERMISSION_CATALOG.filter((p) => set.has(p.key))
}
