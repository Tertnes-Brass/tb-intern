import { type RoleSummary, accessSources, roleLabel } from '../lib/roles'
import { Stamp } from './ui'

/**
 * Rolleoversikten (#48): hva en rolle — eller et sett av roller — faktisk gir
 * tilgang til, på norsk.
 *
 * Rene visningskomponenter uten server- eller ruteavhengigheter, slik at de kan
 * brukes både i rollematrisen på `/innstillinger` og i rollevelgeren på
 * `/medlemmer`. All logikk ligger i `src/lib/roles.ts` og
 * `src/lib/permissions.ts`; her er det bare oppsett.
 *
 * Tallene og navnene kommer alltid fra serveren. Skjermen regner ikke ut
 * tilgang selv — den forklarer den.
 */

/** Rettigheten som ikke er en rettighet: gruppelederområdet gates av bindingen. */
const LEADER_NOTE =
  'Gruppelederområdet (/gruppeledere) følger ikke rollen. Det åpnes av leiarbindingen — «Leder…» i medlemslista — og forsvinner straks bindingen fjernes.'

function AdminNote() {
  return (
    <p className="text-xs leading-relaxed text-ink-soft">
      Full tilgang til alt, inkludert rettigheter som kommer senere. Kan ikke finjusteres.
    </p>
  )
}

/** Rettighetene én rolle gir, som en liste med etikett + forklaring. */
export function RolePermissionList({ role }: { role: RoleSummary }) {
  const isAdmin = role.permissions.includes('*')
  const sources = accessSources([role])
  if (isAdmin) return <AdminNote />
  if (sources.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-ink-soft">
        Ingen egne rettigheter. Rollen sier hvem personen er i korpset, men åpner ingen dører utover det alle medlemmer
        har: beskjeder, kalender, medlemslista og egne stemmer.
      </p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {sources.map(({ permission }) => (
        <li key={permission.key} className="text-xs leading-relaxed">
          <span className="font-semibold text-ink">{permission.label}</span>
          <span className="text-ink-soft"> — {permission.hint}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Ett kort per rolle: navn, systemmerke, antall medlemmer og hva rollen gir.
 * Dette er svaret på «hvilken rolle skal denne personen ha?» — matrisen under
 * er svaret på «hva består rollen av?».
 */
export function RoleGuide({ roles }: { roles: Array<RoleSummary & { memberCount?: number }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {roles.map((role) => (
        <div key={role.id} className="sheet flex flex-col gap-2.5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.95rem] font-semibold text-ink">{role.name}</span>
            {role.isSystem && (
              <Stamp tone="brass" title="Systemrolle — plattformens egen, kan ikke slettes">
                systemrolle
              </Stamp>
            )}
            {typeof role.memberCount === 'number' && (
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
                {role.memberCount} medlem{role.memberCount === 1 ? '' : 'mer'}
              </span>
            )}
          </div>
          <RolePermissionList role={role} />
        </div>
      ))}
    </div>
  )
}

/**
 * Den samlede tilgangen til ett medlem: unionen av rettighetene fra alle
 * rollene, med rollen(e) som er grunnen til hver enkelt. Akseptansekriteriet i
 * #48 — «en administrator kan se hva en person faktisk får tilgang til» — er
 * denne lista.
 */
export function AccessSummary({
  roles,
  emptyHint = 'Velg minst én rolle.',
}: {
  roles: Array<{ id: string; name: string; permissions: string[] }>
  emptyHint?: string
}) {
  const sources = accessSources(roles)
  const isAdmin = roles.some((r) => r.permissions.includes('*'))

  return (
    <div className="rounded-xl border border-line bg-paper-sunken/50 px-4 py-3">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">Samlet tilgang</p>
      <p className="mt-1 text-sm font-semibold text-ink">{roleLabel(roles.map((r) => r.name))}</p>
      {roles.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">{emptyHint}</p>
      ) : isAdmin ? (
        <div className="mt-2">
          <AdminNote />
        </div>
      ) : sources.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          Ingen ekstra rettigheter — samme tilgang som et vanlig medlem.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {sources.map(({ permission, roleNames }) => (
            <li key={permission.key} className="text-xs leading-relaxed">
              <span className="font-semibold text-ink">{permission.label}</span>
              <span className="text-ink-soft"> — {permission.hint}</span>
              {roles.length > 1 && (
                <span className="ml-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ink-faint">
                  fra {roleNames.join(' + ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-faint">
        Roller legges sammen — ingen rolle tar tilgang fra en annen. {LEADER_NOTE}
      </p>
    </div>
  )
}

/** Rollene som stempler. Brukes i medlemslista der plassen er én linje. */
export function RoleStamps({ roles }: { roles: Array<{ id: string; name: string }> }) {
  if (roles.length === 0) return <Stamp>Ingen rolle</Stamp>
  return (
    <>
      {roles.map((role) => (
        <Stamp key={role.id} tone={role.id === 'member' ? 'neutral' : 'brass'}>
          {role.name}
        </Stamp>
      ))}
    </>
  )
}
