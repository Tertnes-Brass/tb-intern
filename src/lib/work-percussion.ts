/**
 * Slagverksinstrumentene et VERK krever (#34) — instrumentlista som følger
 * stykket, ikke prosjektet.
 *
 * **Hvorfor på verket og ikke på prosjektverket.** «Gaelforce» trenger pauker,
 * skarptromme og klokkespill uansett hvem som spiller det og når. Den lista
 * skulle slagverkerne slippe å lese ut av PDF-ene på nytt hver gang stykket
 * settes opp — det er hele saken. Fordelingen «hvem spiller hva denne gangen»
 * er noe annet og bor fortsatt i `project_works.percussion_setup`
 * (`src/lib/percussion.ts`), som er prosjektets egen kolonne.
 *
 * **Manuell registrering nå.** Saken skisserer at systemet senere kan foreslå
 * instrumenter ved å lese tekst fra PDF eller OCR. Ingenting her forutsetter
 * hvordan raden ble til, så et forslagssteg kan skrive de samme radene senere —
 * men det er ikke bygget, og lista er ikke en gjetning før noen har skrevet den.
 *
 * Rene funksjoner: ingen DB, ingen React. Importeres av `src/server/*.ts`,
 * komponentene og testene.
 */

import { PERCUSSION_SECTION } from './percussion'

export { PERCUSSION_SECTION }

/** Instrumentnavnet: «Pauker», «Klokkespill», «Tam-tam». Ikke en setning. */
export const PERCUSSION_INSTRUMENT_MAX = 80

/** Fritekstnotatet: «deles med perc 2», «må lånes», «kan erstattes med vibrafon». */
export const PERCUSSION_ITEM_NOTE_MAX = 200

/** Taket per verk. Et stykke med førti slagverksinstrumenter er en feilføring. */
export const MAX_PERCUSSION_ITEMS_PER_WORK = 40

/**
 * Forslagslista i skjemaet. Instrumentnavnet er FRITEKST i databasen — samme
 * begrunnelse som `ASSET_CATEGORIES` i `src/lib/utstyr.ts`: et nytt instrument
 * skal ikke kreve en migrasjon, og en SQLite-enum kan ikke utvides uten
 * tabell-rebuild (se AGENTS.md om D1). Lista er en hjelp til å stave det samme
 * ordet likt to ganger, ikke en begrensning.
 */
export const PERCUSSION_INSTRUMENTS = [
  'Pauker',
  'Skarptromme',
  'Stortromme',
  'Cymbaler (håndcymbaler)',
  'Hengende cymbal',
  'Trommesett',
  'Klokkespill',
  'Xylofon',
  'Vibrafon',
  'Marimba',
  'Rørklokker',
  'Triangel',
  'Tamburin',
  'Tam-tam / gong',
  'Woodblock',
  'Kubjelle',
  'Shaker / maracas',
  'Congas / bongos',
  'Piatti',
  'Kastanjetter',
] as const

export type PercussionItemInput = {
  instrument: string
  note?: string | null
  /** Slagverksstemmen instrumentet står i («Slagverk 2»). Valgfritt. */
  partId?: string | null
}

export type PercussionItemValue = {
  instrument: string
  note: string | null
  partId: string | null
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return text.length > 0 ? text : null
}

/**
 * Normaliserer én instrumentlinje før lagring. Kaster med en norsk melding når
 * instrumentnavnet mangler — notatet og stemmen er valgfrie, og et instrument
 * uten navn er ingenting.
 */
export function parsePercussionItemInput(input: PercussionItemInput): PercussionItemValue {
  const instrument = cleanText(input.instrument, PERCUSSION_INSTRUMENT_MAX)
  if (!instrument) throw new Error('Instrumentet må ha et navn')
  return {
    instrument,
    note: cleanText(input.note, PERCUSSION_ITEM_NOTE_MAX),
    partId: cleanText(input.partId, 64),
  }
}

/** Stemmene et instrument kan knyttes til: kun slagverksstemmene i besetningen. */
export function percussionPartOptions<T extends { id: string; section: string; sortOrder: number }>(
  parts: T[],
): T[] {
  return parts.filter((p) => p.section === PERCUSSION_SECTION).sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Er stemmen en slagverksstemme? Håndheves server-side ved skriving. */
export function isPercussionPart(part: { section: string } | null | undefined): boolean {
  return part?.section === PERCUSSION_SECTION
}

// ---------- Samlet behov på tvers av repertoaret ----------

export type PercussionSourceRow = {
  workId: string
  workTitle: string
  /** Plassen verket har i programmet — brukes til rekkefølgen innenfor et instrument. */
  position: number
  instrument: string
  note: string | null
  partName: string | null
}

export type PercussionNeedUse = {
  workId: string
  workTitle: string
  position: number
  note: string | null
  partName: string | null
}

export type PercussionNeed = {
  /** Navnet slik det først ble skrevet i programrekkefølgen. */
  instrument: string
  /** Normalisert nøkkel — «pauker» og «Pauker» er samme instrument. */
  key: string
  uses: PercussionNeedUse[]
}

/**
 * Slår instrumentlistene til alle verkene i et program sammen til ÉN riggeliste:
 * «Pauker — Gaelforce, Napoli», «Marimba — Napoli (må lånes)».
 *
 * Nøkkelen er instrumentnavnet i små bokstaver uten doble mellomrom, så
 * «Pauker» og «pauker» ikke blir to linjer i lista. Visningsnavnet er den
 * FØRSTE stavemåten i programrekkefølgen — vi retter ikke på hva arkivaren
 * skrev, vi slår bare sammen.
 *
 * Rekkefølgen er alfabetisk på norsk. En riggeliste leses som en huskeliste,
 * ikke som et program, og da er «finn Marimba» lettere enn «finn verk 4».
 */
export function aggregatePercussionNeeds(rows: PercussionSourceRow[]): PercussionNeed[] {
  const byKey = new Map<string, PercussionNeed>()
  const ordered = [...rows].sort((a, b) => a.position - b.position || a.instrument.localeCompare(b.instrument, 'nb'))

  for (const row of ordered) {
    const key = row.instrument.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key) continue
    const need = byKey.get(key) ?? { instrument: row.instrument, key, uses: [] }
    need.uses.push({
      workId: row.workId,
      workTitle: row.workTitle,
      position: row.position,
      note: row.note,
      partName: row.partName,
    })
    byKey.set(key, need)
  }

  return [...byKey.values()].sort((a, b) => a.instrument.localeCompare(b.instrument, 'nb'))
}

/** «Gaelforce · Napoli (må lånes)» — verkene ett instrument trengs i. */
export function percussionUseSummary(need: PercussionNeed): string {
  return need.uses.map((use) => (use.note ? `${use.workTitle} (${use.note})` : use.workTitle)).join(' · ')
}
