/**
 * Ren logikk for varsling om prosjekter (#18 + #51) — hvem som skal ha e-post,
 * hva som har endret seg siden sist, og hvordan resultatet av en utsending
 * beskrives ærlig. Ingen server- eller DOM-avhengigheter, slik at reglene kan
 * testes uten database og e-postbinding.
 *
 * De to sakene er bygget som ÉTT system med vilje. #18 varsler om at prosjektet
 * finnes, #51 om at noe i det er endret; det er samme mottakerliste, samme
 * varslingsvalg, samme idempotenstabell og samme e-postramme. To parallelle
 * systemer ville før eller siden gitt medlemmet to brytere for det samme.
 */

// ---------- Varslingsvalget per medlem ----------

/** Valget medlemmet gjør på /min-profil. Ingen rad i databasen = `all`. */
export type ProjectNotificationChoice = 'all' | 'off'

export const PROJECT_NOTIFICATION_CHOICES = ['all', 'off'] as const

/**
 * Er «Send e-post …» huket av når publiseringsdialogen åpnes? Nei — samme
 * prinsipp som `DEFAULT_NOTIFY` for beskjeder (#85).
 *
 * Å publisere et prosjekt og å sende e-post til hele korpset er to forskjellige
 * handlinger, og bare den ene kan angres. Et prosjekt publiseres ofte lenge før
 * det er ferdig satt opp — repertoaret kommer stykkevis — og da skal det ikke
 * være nok å overse en avkrysning for å sende ut en halvferdig konsert.
 *
 * Konstanten deles av dialogen og testen, slik at en senere UI-endring ikke kan
 * slå standarden på igjen uten at testen faller.
 */
export const DEFAULT_PROJECT_NOTIFY = false

/** Ingen rad = alle prosjektvarsler. Fravær av valg betyr aldri «ingen varsler». */
export function wantsProjectEmail(choice: ProjectNotificationChoice | null | undefined): boolean {
  return (choice ?? 'all') !== 'off'
}

// ---------- Mottakerutvalg ----------

/** Et potensielt mottakende medlem, slik varslingen henter det fra databasen. */
export type ProjectRecipient = {
  userId: string
  email: string | null
  isActive: boolean
}

/**
 * Hvem skal ha e-post om dette prosjektet?
 *
 * Tre krav, alle må være oppfylt: medlemmet er aktivt, har en e-postadresse, og
 * varslingsvalget tillater det. Ingen målgruppe-inndeling som på veggen — et
 * prosjekt gjelder korpset, og «bare styret»-prosjekter finnes ikke i modellen.
 *
 * Idempotens (hvem som allerede er varslet) håndteres av `project_notifications`,
 * ikke her: denne funksjonen svarer på «hvem er dette relevant for», ikke «hvem
 * mangler det».
 */
export function projectRecipientsFor(
  members: ProjectRecipient[],
  prefs: Map<string, ProjectNotificationChoice> | Record<string, ProjectNotificationChoice>,
): ProjectRecipient[] {
  const lookup = (userId: string): ProjectNotificationChoice | undefined =>
    prefs instanceof Map ? prefs.get(userId) : prefs[userId]

  return members.filter((m) => {
    if (!m.isActive) return false
    if (!m.email || !m.email.trim()) return false
    return wantsProjectEmail(lookup(m.userId))
  })
}

// ---------- Hva som har endret seg (#51) ----------

/**
 * Endringene som er verdt å varsle om. Listen er bevisst kort: den dekker
 * repertoar og tidsplan, som er det saken ber om, pluss de opplysningene om
 * selve prosjektet et medlem planlegger etter (dato, sted, navn).
 *
 * Nøklene lagres i `project_changes.kind`. De er en åpen streng i databasen —
 * en ukjent nøkkel skal gi en rolig fallback, ikke en krasj, den dagen en
 * kolonne er skrevet av en nyere versjon enn den som leser den.
 */
export const PROJECT_CHANGE_KINDS = [
  'work_added',
  'work_removed',
  'work_order',
  'work_percussion',
  'time_added',
  'time_changed',
  'time_removed',
  'date_changed',
  'venue_changed',
  'name_changed',
  'info_changed',
  'percussion_notes',
] as const

export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number]

export type ProjectChange = {
  kind: string
  /** Hva endringen gjelder — verkstittelen, navnet på tidspunktet. */
  subject: string | null
  /** Den nye verdien, når den er verdt å si i klartekst. */
  detail: string | null
}

/** Emnet som en lesbar bit, eller en nøytral fallback når raden mangler det. */
function subjectOf(change: ProjectChange, fallback: string): string {
  const value = change.subject?.trim()
  return value ? `«${value}»` : fallback
}

/**
 * Én endring som én norsk setning.
 *
 * Setningen bygges her og lagres ALDRI i databasen: formuleringen skal kunne
 * rettes uten en datamigrering, og en e-post som ble sendt i går skal ikke
 * kunne motsi det siden viser i dag. Raden holder strukturen (`kind`,
 * `subject`, `detail`), teksten er utledet.
 */
export function describeProjectChange(change: ProjectChange): string {
  const detail = change.detail?.trim() || null
  switch (change.kind) {
    case 'work_added':
      return `${subjectOf(change, 'Et verk')} er lagt til i programmet`
    case 'work_removed':
      return `${subjectOf(change, 'Et verk')} er tatt ut av programmet`
    case 'work_order':
      return 'Rekkefølgen i programmet er endret'
    case 'work_percussion':
      return `Slagverksoppsettet for ${subjectOf(change, 'et verk')} er oppdatert`
    case 'time_added':
      return `Nytt tidspunkt i tidsplanen: ${subjectOf(change, 'et punkt')}${detail ? ` (${detail})` : ''}`
    case 'time_changed':
      return `Endret tidspunkt: ${subjectOf(change, 'et punkt')}${detail ? ` (${detail})` : ''}`
    case 'time_removed':
      return `${subjectOf(change, 'Et tidspunkt')} er tatt ut av tidsplanen`
    case 'date_changed':
      return detail ? `Datoen er endret til ${detail}` : 'Datoen er endret'
    case 'venue_changed':
      return detail ? `Stedet er endret til ${detail}` : 'Stedet er endret'
    case 'name_changed':
      return detail ? `Prosjektet heter nå «${detail}»` : 'Prosjektet har fått nytt navn'
    case 'info_changed':
      return 'Beskrivelsen av prosjektet er oppdatert'
    case 'percussion_notes':
      return 'Slagverksnotatene er oppdatert'
    default:
      // En ukjent nøkkel skal aldri velte en e-post eller en side. Den sier det
      // eneste vi vet med sikkerhet.
      return 'Noe i prosjektet er endret'
  }
}

/** Så mange linjer får plass i én e-post før resten telles opp. */
export const MAX_CHANGE_LINES = 12

export type ProjectChangeSummary = {
  /** Setningene, i den rekkefølgen endringene skjedde, uten gjentakelser. */
  lines: string[]
  /** Hvor mange linjer som ikke fikk plass. 0 når alt er med. */
  more: number
  /** Hvor mange endringer summeringen bygger på, før dedupe og kutt. */
  total: number
}

/**
 * Alt som har skjedd siden forrige varsel, som ÉN liste.
 *
 * To regler gjør dette til en e-post folk orker å lese, og de er hele grunnen
 * til at #51 ber om samling framfor ett varsel per endring:
 *
 * 1. **Gjentakelser slås sammen.** Flyttes et verk fem ganger, står det «Rekke-
 *    følgen i programmet er endret» én gang. Sammenligningen skjer på den
 *    ferdige SETNINGEN, ikke på raden: to rader som sier det samme er én
 *    opplysning for den som leser.
 * 2. **Lista har et tak.** Er det gjort mer enn `MAX_CHANGE_LINES` ulike ting,
 *    kuttes den og resten telles opp. En e-post med seksti linjer blir ikke
 *    lest, og prosjektsiden har uansett fasiten.
 */
export function summarizeProjectChanges(
  changes: ProjectChange[],
  max: number = MAX_CHANGE_LINES,
): ProjectChangeSummary {
  const seen = new Set<string>()
  const all: string[] = []
  for (const change of changes) {
    const line = describeProjectChange(change)
    if (seen.has(line)) continue
    seen.add(line)
    all.push(line)
  }
  const limit = Math.max(0, max)
  return { lines: all.slice(0, limit), more: Math.max(0, all.length - limit), total: changes.length }
}

/** «3 endringer siden forrige varsel», «1 endring …», «Ingen nye endringer». */
export function pendingChangesLabel(n: number): string {
  if (n <= 0) return 'Ingen nye endringer siden forrige varsel'
  return n === 1 ? '1 endring siden forrige varsel' : `${n} endringer siden forrige varsel`
}

// ---------- Kvittering etter utsending ----------

/** Resultatet av én sendingsrunde. `skipped` = mottakere som allerede stod i loggen. */
export type ProjectNotifyResult = { sent: number; logged: number; failed: number; skipped: number }

/**
 * Én linje om hva som FAKTISK skjedde — samme sannhetskilde i toast og
 * kvittering, og samme regel som `notifyResultMessage` for beskjeder:
 * **`logged` skal aldri presenteres som «sendt»**. Det betyr at e-post ikke er
 * aktivert her og at innholdet bare gikk til konsollen.
 *
 * `lead` er handlingen som nettopp ble gjort («Prosjektet er publisert»,
 * «Oppdateringsvarsel»), slik at den samme funksjonen kan brukes fra
 * publisering, «send på nytt» og endringsvarselet uten at noen av dem må klippe
 * i en ferdig setning.
 */
export function projectNotifyMessage(
  result: ProjectNotifyResult,
  lead: string,
): { message: string; kind: 'ok' | 'error' } {
  const { sent, logged, failed, skipped } = result
  if (sent === 0 && logged === 0 && failed === 0) {
    return {
      message: `${lead}. ${skipped > 0 ? 'Alle mottakerne har allerede fått e-post.' : 'Ingen e-post ble sendt.'}`,
      kind: 'ok',
    }
  }
  if (logged > 0 && sent === 0 && failed === 0) {
    return {
      message: `${lead}, men e-post er ikke aktivert her — ${logged} varsler ble bare loggført lokalt.`,
      kind: 'error',
    }
  }
  const parts = [`Sendt til ${sent} ${sent === 1 ? 'medlem' : 'medlemmer'}`]
  if (logged > 0) parts.push(`${logged} loggført lokalt`)
  if (failed > 0) parts.push(`${failed} feilet`)
  if (skipped > 0) parts.push(`${skipped} hadde den fra før`)
  return { message: `${lead}. ${parts.join(' · ')}.`, kind: failed > 0 ? 'error' : 'ok' }
}

/** Etiketten ved avkryssingen. Målgruppen står i etiketten, ikke bare i hjelpeteksten. */
export const PROJECT_NOTIFY_LABEL = 'Send e-post til alle aktive medlemmer nå'

/**
 * `projects.kind` er allerede et norsk ord («konsert», «seminar») — den skal
 * bare begynne med stor bokstav når den står som stempel i en e-post. Egen
 * funksjon fordi kolonnen er fri tekst med en anbefalt liste: en ukjent verdi
 * skal vises som den er, ikke oversettes bort.
 */
export function projectKindLabel(kind: string): string {
  const value = kind.trim()
  if (!value) return 'Prosjekt'
  return value.charAt(0).toUpperCase() + value.slice(1)
}
