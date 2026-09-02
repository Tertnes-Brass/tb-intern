/**
 * Praktisk info rundt et prosjekt: tidspunktene i tidsplanen (#9) og den
 * praktiske infoen på én øving (#10).
 *
 * Rene funksjoner uten server- eller DOM-avhengigheter, slik at serveren og
 * skjemaet ikke kan komme i utakt om hva et gyldig tidspunkt er — og slik at
 * sorteringen kan testes uten database.
 *
 * **Hvorfor ÉN modul for begge sakene:** de deler de to skrankene som faktisk
 * er vanskelige — klokkeslettet (`parseClockTime`) og kartlenka (`parseMapUrl`)
 * — og de er to sider av samme historie: når skal jeg møte, og hvor. To
 * moduler ville betydd at den ene importerte den andre for et klokkeslett,
 * eller at regelen sto to steder.
 *
 * **Veggklokke, ikke tidsstempel.** Tidspunktene lagres som ISO-dato (`date`)
 * pluss `HH:MM` (`time`), ikke som epoch-ms. Et oppmøte klokka 17:30 er 17:30
 * i Bergen uansett hva serveren mener om sommertid, og en dato som skrives inn
 * i et skjema har ingen tidssone å bevare. Kalenderhendelsene (`event_meta`)
 * har fortsatt ekte tidsstempler — de kommer fra Google og er ikke skrevet inn
 * av noen.
 */

// ---------- Felles skranker ----------

export const PRACTICAL_LABEL_MAX = 80
export const PRACTICAL_NOTE_MAX = 400
export const PRACTICAL_LOCATION_MAX = 160
export const PRACTICAL_ADDRESS_MAX = 200
export const PRACTICAL_NAME_MAX = 160
export const PRACTICAL_URL_MAX = 500
export const PRACTICAL_PHONE_MAX = 32

/**
 * Kontrolltegn og usynlige styretegn. Fjernes FØR all annen tolkning, av samme
 * grunn som `safeHref` i `src/lib/markdown.ts` gjør det: et felt som ser tomt
 * ut skal være tomt, og et `\t` inne i «java(tab)script:» skal ikke kunne
 * gjemme seg gjennom en skjemasjekk. Linjeskift og tab er ikke med her —
 * `cleanLines` trenger dem, og `cleanText` slår dem sammen som mellomrom.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g

/** Trimmer, slår sammen mellomrom og kutter. Tom tekst blir `null`, aldri `''`. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Flerlinjet fritekst — riggegruppe, vikarer, praktiske beskjeder. Beholder
 * linjeskift (lista er poenget), men fjerner kontrolltegn og trimmer hver linje.
 */
export function cleanLines(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, max) : null
}

/**
 * `HH:MM` i veggklokke-tid. Godtar det folk faktisk skriver — «1930», «19.30»,
 * «9:05», «19:30» — og gir alltid tosifret time tilbake. Ugyldig klokkeslett
 * kaster; tomt felt er `null` (et tidspunkt uten klokke er lov, «lasting på
 * lørdag» er en avtale selv om timen ikke er satt).
 */
export function parseClockTime(value: string | null | undefined): string | null {
  const raw = (value ?? '').replace(CONTROL_CHARS, '').trim()
  if (!raw) return null
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(raw)
  if (!m) throw new Error('Ugyldig klokkeslett — skriv det som 19:30')
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) throw new Error('Ugyldig klokkeslett — skriv det som 19:30')
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** ISO-dato som FAKTISK finnes. `2026-02-31` er en skrivefeil, ikke en dato. */
export function parseIsoDate(value: string | null | undefined): string {
  const raw = (value ?? '').replace(CONTROL_CHARS, '').trim()
  const m = ISO_DATE.exec(raw)
  if (!m) throw new Error('Ugyldig dato')
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    throw new Error('Ugyldig dato')
  }
  return raw
}

/**
 * Kartlenka. Samme disiplin som `safeHref` i `src/lib/markdown.ts`:
 * kontrolltegn strippes FØR skjemasjekken, slik at «java(tab)script:» ikke
 * slipper forbi, og kun `http(s):` godtas. En relativ sti gir ingen mening for
 * et kart, og `javascript:`/`data:` skal aldri kunne lagres og senere klikkes
 * av noen.
 */
export function parseMapUrl(value: string | null | undefined): string | null {
  const raw = (value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[\t\n\r]/g, '')
    .trim()
  if (!raw) return null
  if (!/^https?:\/\/./i.test(raw)) {
    throw new Error('Kartlenka må begynne med http:// eller https://')
  }
  return raw.slice(0, PRACTICAL_URL_MAX)
}

/**
 * Telefonnummer slik det skal STÅ på en tidspunktsrad. Samme tegnsett som
 * `phoneSchema` i `src/lib/profile.ts`, men her er nummeret et publisert
 * kontaktpunkt for én oppgave — ikke medlemsdata. Se `docs/tilgangsstyring.md`.
 */
export function parseContactPhone(value: string | null | undefined): string | null {
  const raw = (value ?? '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
  if (!raw) return null
  if (!/^[+0-9][0-9 ()-]*$/.test(raw)) throw new Error('Telefonnummeret inneholder ugyldige tegn')
  return raw.slice(0, PRACTICAL_PHONE_MAX)
}

// ---------- #9: tidspunkter i prosjekt ----------

/**
 * Typene tidspunkt. Lista er bevisst kort og konkret — den er en *etikett*,
 * ikke en tilstandsmaskin: ingen logikk henger på hvilken type et tidspunkt
 * har, bortsett fra rekkefølgen når to punkter står på samme klokkeslett.
 * `annet` finnes for at ingen skal måtte lyve om hva de holder på med.
 */
export const PROJECT_TIME_KINDS = [
  'oppmote_lasting',
  'avreise',
  'oppmote_rigg',
  'oppmote_musikanter',
  'ovingsstart',
  'lydprove',
  'konsertstart',
  'seminarstart',
  'pause',
  'nedrigg',
  'retur',
  'annet',
] as const
export type ProjectTimeKind = (typeof PROJECT_TIME_KINDS)[number]

export const PROJECT_TIME_KIND_LABELS: Record<ProjectTimeKind, string> = {
  oppmote_lasting: 'Oppmøte lasting',
  avreise: 'Avreise',
  oppmote_rigg: 'Oppmøte rigg i lokalet',
  oppmote_musikanter: 'Oppmøte musikanter',
  ovingsstart: 'Øvingsstart',
  lydprove: 'Lydprøve',
  konsertstart: 'Konsertstart',
  seminarstart: 'Seminarstart',
  pause: 'Pause',
  nedrigg: 'Nedrigg',
  retur: 'Retur til lager',
  annet: 'Annet',
}

export function isProjectTimeKind(value: string): value is ProjectTimeKind {
  return (PROJECT_TIME_KINDS as readonly string[]).includes(value)
}

/**
 * Hvem tidspunktet gjelder. «Alle» er standarden, og en musikant skal ikke
 * måtte lure på om «Oppmøte 15:00» gjelder hen eller riggegruppa.
 */
export const PROJECT_TIME_AUDIENCES = [
  'alle',
  'musikanter',
  'riggegruppe',
  'slagverk',
  'dirigent',
  'styret',
  'vikarer',
] as const
export type ProjectTimeAudience = (typeof PROJECT_TIME_AUDIENCES)[number]

export const PROJECT_TIME_AUDIENCE_LABELS: Record<ProjectTimeAudience, string> = {
  alle: 'Alle',
  musikanter: 'Musikanter',
  riggegruppe: 'Riggegruppe',
  slagverk: 'Slagverk',
  dirigent: 'Dirigent',
  styret: 'Styret',
  vikarer: 'Vikarer',
}

export function isProjectTimeAudience(value: string): value is ProjectTimeAudience {
  return (PROJECT_TIME_AUDIENCES as readonly string[]).includes(value)
}

export type ProjectTimeInput = {
  kind?: string | null
  label?: string | null
  date?: string | null
  time?: string | null
  location?: string | null
  audience?: string | null
  note?: string | null
  responsibleUserId?: string | null
  responsibleName?: string | null
  contactPhone?: string | null
}

export type ProjectTimeValue = {
  kind: ProjectTimeKind
  label: string | null
  date: string
  time: string | null
  location: string | null
  audience: ProjectTimeAudience
  note: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  contactPhone: string | null
}

/**
 * Normaliserer og validerer ett tidspunkt. Kaster med en norsk melding UI-et
 * kan vise rått — samme mønster som `parseSetlistInput`.
 *
 * Ansvarlig kan være ENTEN et medlem (`responsibleUserId`, navnet slås alltid
 * opp ferskt) ELLER et navn utenfra (`responsibleName`) — sjåføren fra
 * transportfirmaet har ingen konto. Er begge sendt inn, vinner medlemmet: da er
 * fritekstfeltet en rest fra skjemaet, ikke et valg.
 */
export function parseProjectTimeInput(input: ProjectTimeInput): ProjectTimeValue {
  const kindRaw = (input.kind ?? 'annet').trim()
  if (!isProjectTimeKind(kindRaw)) throw new Error('Ukjent type tidspunkt')
  const audienceRaw = (input.audience ?? 'alle').trim()
  if (!isProjectTimeAudience(audienceRaw)) throw new Error('Ukjent målgruppe')

  const label = cleanText(input.label, PRACTICAL_LABEL_MAX)
  if (kindRaw === 'annet' && !label) {
    throw new Error('Gi tidspunktet et navn når typen er «Annet»')
  }

  const responsibleUserId = cleanText(input.responsibleUserId, 64)
  return {
    kind: kindRaw,
    label,
    date: parseIsoDate(input.date),
    time: parseClockTime(input.time),
    location: cleanText(input.location, PRACTICAL_LOCATION_MAX),
    audience: audienceRaw,
    note: cleanText(input.note, PRACTICAL_NOTE_MAX),
    responsibleUserId,
    responsibleName: responsibleUserId ? null : cleanText(input.responsibleName, PRACTICAL_NAME_MAX),
    contactPhone: parseContactPhone(input.contactPhone),
  }
}

/** Overskriften på et tidspunkt: egen etikett når den finnes, ellers typen. */
export function projectTimeTitle(entry: { kind: string; label: string | null }): string {
  if (entry.label) return entry.label
  return isProjectTimeKind(entry.kind) ? PROJECT_TIME_KIND_LABELS[entry.kind] : 'Tidspunkt'
}

export type SortableProjectTime = {
  date: string
  time: string | null
  kind: string
  createdAt?: number
}

/**
 * Kronologisk. To punkter samme dag uten klokkeslett kan ikke skilles på tid,
 * og da avgjør typens rekkefølge (lasting før konsertstart) og til slutt når
 * raden ble laget — aldri tilfeldig, slik at lista ikke hopper mellom to
 * lastinger av samme side.
 *
 * Et punkt UTEN klokkeslett sorteres sist på dagen: «lasting en gang på
 * lørdag» er mindre presist enn «konsert 19:00», og en uspesifisert tid skal
 * ikke skyve et konkret klokkeslett nedover.
 */
export function sortProjectTimes<T extends SortableProjectTime>(entries: T[]): T[] {
  const kindRank = (kind: string) => {
    const index = (PROJECT_TIME_KINDS as readonly string[]).indexOf(kind)
    return index === -1 ? PROJECT_TIME_KINDS.length : index
  }
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      kindRank(a.kind) - kindRank(b.kind) ||
      (a.createdAt ?? 0) - (b.createdAt ?? 0),
  )
}

/**
 * Det neste tidspunktet som ikke er passert — det prosjektsiden løfter fram
 * øverst på mobil. «Nå» sendes inn som veggklokke i norsk tid (ingen skjult
 * `Date.now()`, ingen tidssoneregning her), og sammenligningen skjer på
 * nøyaktig de strengene brukeren skrev inn i skjemaet.
 *
 * Et punkt uten klokkeslett regnes som aktuelt HELE dagen: «lasting på lørdag»
 * skal ikke forsvinne klokka 00:01 på lørdag.
 */
export function nextProjectTime<T extends SortableProjectTime>(
  entries: T[],
  nowDate: string,
  nowTime: string,
): T | null {
  for (const entry of sortProjectTimes(entries)) {
    if (entry.date > nowDate) return entry
    if (entry.date === nowDate && (entry.time === null || entry.time >= nowTime)) return entry
  }
  return null
}

// ---------- #10: praktisk info per øving ----------

export type EventPracticalInput = {
  locationName?: string | null
  locationAddress?: string | null
  mapUrl?: string | null
  meetupCrew?: string | null
  meetupMusicians?: string | null
  conductor?: string | null
  keyholder?: string | null
  crew?: string | null
  substitutes?: string | null
  practicalNote?: string | null
}

export type EventPracticalValue = {
  locationName: string | null
  locationAddress: string | null
  mapUrl: string | null
  meetupCrew: string | null
  meetupMusicians: string | null
  conductor: string | null
  keyholder: string | null
  crew: string | null
  substitutes: string | null
  practicalNote: string | null
}

/**
 * Praktisk info på én øving. Alt er valgfritt — en vanlig torsdagsøving i
 * kjelleren trenger ingen av feltene, og en tom rad skal ikke se ut som en
 * mangel.
 *
 * **Hva som er strukturert og hva som er fritekst:** de to oppmøtetidspunktene
 * er klokkeslett fordi de skal kunne leses side om side med hendelsens egen
 * start; adresse og kartlenke er egne felt fordi lenka må valideres. Resten —
 * riggegruppe, vikarer, dirigent, nøkkelansvarlig — er navn, og navn er
 * fritekst: en riggegruppe er tre personer, en innleid sjåfør og av og til «Kim
 * spør faren sin». En medlemsreferanse per rolle ville krevd en tabell til for
 * å modellere noe som i praksis avtales i en chattetråd.
 */
export function parseEventPracticalInput(input: EventPracticalInput): EventPracticalValue {
  return {
    locationName: cleanText(input.locationName, PRACTICAL_LOCATION_MAX),
    locationAddress: cleanText(input.locationAddress, PRACTICAL_ADDRESS_MAX),
    mapUrl: parseMapUrl(input.mapUrl),
    meetupCrew: parseClockTime(input.meetupCrew),
    meetupMusicians: parseClockTime(input.meetupMusicians),
    conductor: cleanText(input.conductor, PRACTICAL_NAME_MAX),
    keyholder: cleanText(input.keyholder, PRACTICAL_NAME_MAX),
    crew: cleanLines(input.crew, PRACTICAL_NOTE_MAX),
    substitutes: cleanLines(input.substitutes, PRACTICAL_NOTE_MAX),
    practicalNote: cleanLines(input.practicalNote, PRACTICAL_NOTE_MAX),
  }
}

/** Har øvingen praktisk info i det hele tatt? Styrer om seksjonen vises. */
export function hasEventPractical(value: Partial<EventPracticalValue> | null | undefined): boolean {
  if (!value) return false
  return Object.values(value).some((field) => field !== null && field !== undefined && field !== '')
}
