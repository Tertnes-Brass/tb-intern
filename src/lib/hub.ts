import { isGroupLeader } from './gruppeledere'

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
  /**
   * Stabil nøkkel for forekomsten (`src/lib/occurrence.ts`). Hub-en bruker den
   * KUN til å lenke «Neste» videre til `/kalender/$eventId` — payloaden skal
   * ellers holdes liten (§4), så det er ett felt, ikke en ny blokk.
   */
  occurrenceKey: string
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

/** Publisert innlegg fra veggen, redusert til det hub-en viser. */
export type HubPost = {
  id: string
  /** Tittel når den finnes, ellers første linje av teksten (`postHeading`). */
  heading: string
  excerpt: string
  /** Epoch-ms. Utkast kommer aldri hit. */
  publishedAt: number
  important: boolean
  /** Merket «Fra styret». */
  official: boolean
  authorName: string
  commentCount: number
  likeCount: number
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
  | '/utstyr'
  | '/media'
  | '/gruppeledere'
  | '/styre'
  | '/innstillinger/nedlastinger'
  | '/innstillinger'

export type HubArea = {
  to: HubAreaTo
  label: string
  /** Én linje om hva du gjør der. */
  description: string
  /**
   * Valgfri statuslinje med tall, f.eks. «3 åpne oppgaver, 1 forfalt».
   * `areasFor` setter den aldri — den fylles i `getHub`, som er stedet som har
   * databasen. Rettighetene avgjør *om* området er med; tallene er pynt oppå.
   */
  note?: string
}

const BASE_AREAS: HubArea[] = [
  { to: '/beskjeder', label: 'Beskjeder', description: 'Veggen: beskjeder fra styret og alt korpset deler.' },
  { to: '/noter', label: 'Noter', description: 'Åpne stemmene dine, se programmet og bla i arkivet.' },
  { to: '/kalender', label: 'Kalender', description: 'Øvelser, konserter og oppmøtetider fremover.' },
  { to: '/medlemmer', label: 'Medlemmer', description: 'Se hvem som spiller hvilken stemme.' },
  // Utstyr (#13) er åpent for lesing, som Beskjeder og Medlemmer, og står
  // derfor blant grunnområdene. Det har BEVISST ingen oppføring i toppmenyen:
  // §6 i docs/designprinsipper.md er allerede på taket, og et sjette punkt for
  // et vanlig medlem ville skjøvet noe bak fade-gradienten på mobil uten at
  // noen merket det. Samme løsning som Filtilganger fikk 31. august 2026 —
  // eget område, egen oversikt, egen gate, men vei inn herfra.
  {
    to: '/utstyr',
    label: 'Utstyr',
    description: 'Instrumenter og utstyr: hvem eier hva, og hva er lånt inn.',
  },
  // Media (#32) er åpent for lesing på samme måte som Utstyr — `intern` og
  // «kandidat utad» leses av alle aktive medlemmer, og bare `styre`-elementer
  // krever `board.manage`. Det står derfor blant grunnområdene, og har BEVISST
  // ingen oppføring i toppmenyen: §6 i docs/designprinsipper.md er passert to
  // ganger fra før, og et nytt punkt for et vanlig medlem ville skjøvet noe bak
  // fade-gradienten på mobil uten at noen merket det. Samme løsning som
  // Filtilganger (31. august 2026) og Utstyr (2. september 2026) fikk.
  {
    to: '/media',
    label: 'Media',
    description: 'Opptak, bilder og video fra øvinger, konserter og prosjekter.',
  },
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
 *
 * Gruppeledere (#81) er det ene kortet som ikke kan avgjøres av rettighetene
 * alene: det krever i tillegg en aktiv leiarbinding, derfor `opts.leadsPartIds`.
 */
export function areasFor(
  permissions: string[],
  /**
   * Leiarbindingene fra `section_leaders` (`me.leadsPartIds`). Gruppelederkortet
   * er det eneste som trenger mer enn rettighetene, og flagget er derfor
   * eksplisitt: en tom/utelatt liste betyr «leder ingen gruppe», ikke «vet ikke».
   */
  opts: { leadsPartIds?: string[] } = {},
): HubArea[] {
  const areas: HubArea[] = [...BASE_AREAS]
  if (isGroupLeader({ permissions, leadsPartIds: opts.leadsPartIds ?? [] })) {
    areas.push({
      to: '/gruppeledere',
      label: 'Gruppeledere',
      description: 'Koordiner på tvers av stemmegruppene, og se hvem som leder hva.',
    })
  }
  if (allows(permissions, 'board.manage')) {
    areas.push({
      to: '/styre',
      label: 'Styre',
      description: 'Oppgaver, møter og dokumenter for styret.',
    })
  }
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
