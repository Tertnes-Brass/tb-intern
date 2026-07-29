/**
 * Ren, runtime-uavhengig logikk for prosjektlista: sortering, gruppering på
 * sesong og hvilken sesong en dato hører til.
 * Holdes fri for importer (db, auth m.m.) så den kan enhetstestes i node.
 *
 * Alle datoer er ISO (`YYYY-MM-DD`) og sammenlignes som strenger —
 * leksikografisk rekkefølge er kronologisk for det formatet. «I dag» sendes
 * inn som parameter, aldri lest fra klokka her, slik at serveren avgjør hva
 * som er kommende og SSR og klient ikke kan bli uenige.
 */

// Verdiene fra `projects.kind` i skjemaet. Ligger her så både validatoren,
// filteret i UI-et og testene har én kilde.
export const PROJECT_KINDS = ['konsert', 'konkurranse', 'seminar', 'annet'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

export const PROJECT_STATUSES = ['kommende', 'tidligere'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_SORTS = ['standard', 'dato-stigende', 'dato-synkende'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

/** «Standard» = nærmeste kommende prosjekt først, historikken bakerst. */
export const DEFAULT_PROJECT_SORT: ProjectSort = 'standard'

/** Gruppenavn for prosjekter som ikke er knyttet til en sesong. */
export const NO_SEASON = 'Uten sesong'

export type SortableProject = { name: string; eventDate: string | null }

export type SeasonalProject = SortableProject & {
  seasonName: string | null
  seasonStartsOn: string | null
}

export type SeasonGroup<T> = {
  name: string
  startsOn: string | null
  /** Sesongen har minst ett prosjekt som ikke er avholdt ennå. */
  hasUpcoming: boolean
  projects: T[]
}

/**
 * Ikke avholdt ennå (dagen i dag regnes som kommende). Et prosjekt uten dato
 * er ikke plassert i tid, og regnes derfor aldri som kommende.
 */
export function isUpcoming(eventDate: string | null, today: string): boolean {
  return eventDate != null && eventDate >= today
}

/**
 * Total rekkefølge på prosjekter:
 * - `standard`: kommende først med nærmeste dato øverst, deretter avholdte med
 *   det sist avholdte øverst — altså «bevegelsen ut fra i dag» i begge retninger.
 * - `dato-stigende` / `dato-synkende`: ren kronologi uansett om prosjektet er
 *   avholdt.
 *
 * Datoløse prosjekter havner alltid til slutt, og lik dato brytes på navn, slik
 * at rekkefølgen er den samme for hver spørring (SQL gir ingen garanti selv).
 */
export function sortProjects<T extends SortableProject>(
  rows: readonly T[],
  sort: ProjectSort,
  today: string,
): T[] {
  return [...rows].sort((a, b) => {
    if ((a.eventDate == null) !== (b.eventDate == null)) return a.eventDate == null ? 1 : -1
    if (a.eventDate != null && b.eventDate != null) {
      const chronological = a.eventDate.localeCompare(b.eventDate)
      if (sort === 'standard') {
        const aUpcoming = isUpcoming(a.eventDate, today)
        if (aUpcoming !== isUpcoming(b.eventDate, today)) return aUpcoming ? -1 : 1
        if (chronological !== 0) return aUpcoming ? chronological : -chronological
      } else if (chronological !== 0) {
        return sort === 'dato-synkende' ? -chronological : chronological
      }
    }
    return a.name.localeCompare(b.name, 'nb')
  })
}

/**
 * Grupperer en ALLEREDE sortert liste (se `sortProjects`) på sesong.
 * Rekkefølgen innenfor hver sesong er inn-rekkefølgen.
 *
 * Sesongene ordnes på `seasonStartsOn`, ikke på navn — «Vår 2026» og
 * «Høst 2025» sorterer ikke kronologisk som tekst. Retningen følger
 * sorteringen: i `standard` legges sesonger med kommende prosjekt først
 * (stigende), og historikken bakerst med den ferskeste sesongen øverst.
 * Sesonger uten startdato (typisk «Uten sesong») kommer alltid til slutt.
 */
export function groupBySeason<T extends SeasonalProject>(
  rows: readonly T[],
  sort: ProjectSort,
  today: string,
): Array<SeasonGroup<T>> {
  const groups = new Map<string, SeasonGroup<T>>()
  for (const row of rows) {
    const name = row.seasonName ?? NO_SEASON
    let group = groups.get(name)
    if (!group) {
      group = { name, startsOn: null, hasUpcoming: false, projects: [] }
      groups.set(name, group)
    }
    group.startsOn ??= row.seasonStartsOn
    group.hasUpcoming ||= isUpcoming(row.eventDate, today)
    group.projects.push(row)
  }

  return [...groups.values()].sort((a, b) => {
    if (a.startsOn == null || b.startsOn == null) {
      return (a.startsOn == null ? 1 : 0) - (b.startsOn == null ? 1 : 0)
    }
    if (sort === 'standard' && a.hasUpcoming !== b.hasUpcoming) return a.hasUpcoming ? -1 : 1
    const descending = sort === 'dato-synkende' || (sort === 'standard' && !a.hasUpcoming)
    const chronological = a.startsOn.localeCompare(b.startsOn)
    return descending ? -chronological : chronological
  })
}

/**
 * Sesongen en dato hører til: vår = januar–juli, høst = august–desember.
 * Én kilde for regelen, slik at både opprettelse og flytting av et prosjekt
 * havner i samme sesong for samme dato.
 */
export function seasonForDate(eventDate: string): { name: string; startsOn: string; endsOn: string } {
  const year = Number(eventDate.slice(0, 4))
  const isSpring = Number(eventDate.slice(5, 7)) <= 7
  return isSpring
    ? { name: `Vår ${year}`, startsOn: `${year}-01-01`, endsOn: `${year}-07-31` }
    : { name: `Høst ${year}`, startsOn: `${year}-08-01`, endsOn: `${year}-12-31` }
}
