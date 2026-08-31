/**
 * Ren hjelpelogikk for hub-forsiden (`/`): hvilken hendelse som blir hero, og
 * hvilke områder brukeren får snarvei til. Ingen server- eller DOM-avhengigheter,
 * slik at reglene kan testes uten database og kalenderfeed.
 *
 * Hub-en er plattformflaten (docs/designprinsipper.md §7 pkt 3): den viser *det
 * neste* og *veien videre*, ikke hvert områdes oversikt i miniatyr (§4).
 */

/** Kalenderhendelse redusert til feltene hub-en faktisk viser. */
export type HubEvent = {
  id: string
  title: string
  /** ISO-8601 i UTC. */
  start: string
  end: string | null
  allDay: boolean
  location: string | null
}

/** Publisert prosjekt med det hub-en trenger for kortet «Mine noter». */
export type HubProject = {
  id: string
  name: string
  /** ISO-dato. Prosjekter uten dato kommer aldri hit. */
  eventDate: string
  venue: string | null
  description: string | null
  /** Antall verk i programmet — ikke selve repertoarlisten, den bor på /noter. */
  workCount: number
}

/** Publisert beskjed, redusert til det hub-en viser. Hele teksten bor på /beskjeder. */
export type HubPost = {
  id: string
  title: string
  excerpt: string
  /** Epoch-ms. Utkast kommer aldri hit. */
  publishedAt: number
  important: boolean
}

export type HubCalendar = {
  /** `CALENDAR_ICS_URL` er satt. */
  configured: boolean
  /** Henting eller parsing feilet. */
  error: boolean
  next: HubEvent | null
  /** De neste hendelsene etter `next`. */
  upcoming: HubEvent[]
}

export type HubHero =
  | { kind: 'event'; event: HubEvent }
  | { kind: 'project'; project: HubProject }
  | { kind: 'none' }

/**
 * Hero er neste kalenderhendelse når kalenderen svarer. Er den ikke konfigurert,
 * feiler den, eller står den tom, faller vi tilbake til neste publiserte
 * prosjekt — hub-en skal aldri være tom bare fordi en integrasjon mangler.
 */
export function chooseHero(input: {
  calendar: HubCalendar
  nextProject: HubProject | null
}): HubHero {
  const { calendar, nextProject } = input
  if (calendar.configured && !calendar.error && calendar.next) {
    return { kind: 'event', event: calendar.next }
  }
  if (nextProject) return { kind: 'project', project: nextProject }
  return { kind: 'none' }
}

/**
 * Hendelsene etter hero, i samme rekkefølge som feeden. `next` finnes i `events`
 * når den kommer fra `loadCalendar`; er den filtrert bort (utenfor vinduet)
 * beholdes lista som den er.
 */
export function eventsAfter(events: HubEvent[], next: HubEvent | null, limit: number): HubEvent[] {
  if (!next) return events.slice(0, limit)
  const index = events.findIndex((e) => e.id === next.id)
  return (index === -1 ? events : events.slice(index + 1)).slice(0, limit)
}

/** Rutene hub-en kan lenke til. Holdes som union så `Link to` forblir typet. */
export type HubAreaTo =
  | '/beskjeder'
  | '/noter'
  | '/kalender'
  | '/medlemmer'
  | '/innstillinger/nedlastinger'
  | '/innstillinger'

export type HubArea = {
  to: HubAreaTo
  label: string
  /** Én linje om hva du gjør der. */
  description: string
}

const BASE_AREAS: HubArea[] = [
  { to: '/beskjeder', label: 'Beskjeder', description: 'Informasjon fra styret — og hele historikken.' },
  { to: '/noter', label: 'Noter', description: 'Åpne stemmene dine, se programmet og bla i arkivet.' },
  { to: '/kalender', label: 'Kalender', description: 'Øvelser, konserter og oppmøtetider fremover.' },
  { to: '/medlemmer', label: 'Medlemmer', description: 'Se hvem som spiller hvilken stemme.' },
]

function allows(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission)
}

/**
 * Samme betingelser som toppmenyen i `Shell.tsx` — snarveiene og menyen skal
 * ikke kunne komme i utakt. UI-et er uansett kosmetikk; serveren avviser selv.
 *
 * Ett unntak, bevisst: Filtilganger ble tatt ut av toppmenyen da Beskjeder kom
 * (docs/designprinsipper.md §6), men beholder kortet her — hub-en har plass, og
 * området må fortsatt ha en vei inn (§4).
 */
export function areasFor(permissions: string[]): HubArea[] {
  const areas: HubArea[] = [...BASE_AREAS]
  if (allows(permissions, 'downloads.view')) {
    areas.push({
      to: '/innstillinger/nedlastinger',
      label: 'Filtilganger',
      description: 'Finn ut hvem som har åpnet eller lastet ned en fil.',
    })
  }
  if (allows(permissions, 'settings.manage')) {
    areas.push({
      to: '/innstillinger',
      label: 'Innstillinger',
      description: 'Forvalt besetningen og rollematrisen.',
    })
  }
  return areas
}
