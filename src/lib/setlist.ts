/**
 * Reglene for ett punkt i øvingsplanen (#82). Rene funksjoner, testet i
 * `setlist.test.ts`, slik at serveren og skjemaet er enige om hva et gyldig
 * punkt er.
 *
 * Et punkt er ENTEN et verk fra arkivet (`workId`) ELLER en fritekst-tittel
 * (`customTitle`) — oppvarming, gjennomgang av marsjoppstilling, en pause. Uten
 * fritekst måtte alt som skal øves på ligge i notearkivet, og planen ville
 * blitt løyet til; med begge satt ville visningen måttet gjette hvilken tittel
 * som gjelder. `note` er den korte merknaden saken ber om: sats, taktnummer
 * eller omtrentlig tidsbruk.
 */

export const SETLIST_TITLE_MAX = 120
export const SETLIST_NOTE_MAX = 160

export type SetlistInput = {
  workId?: string | null
  customTitle?: string | null
  note?: string | null
}

export type SetlistValue = {
  workId: string | null
  customTitle: string | null
  note: string | null
}

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Normaliserer og håndhever «enten verk eller fritekst». Kaster med en norsk
 * melding UI-et kan vise rått — samme mønster som resten av serverfunksjonene.
 * Et verk vinner over en fritekst-tittel hvis begge er sendt inn: da er
 * fritekstfeltet en rest fra skjemaet, ikke et valg.
 */
export function parseSetlistInput(input: SetlistInput): SetlistValue {
  const workId = clean(input.workId, 64)
  const customTitle = clean(input.customTitle, SETLIST_TITLE_MAX)
  const note = clean(input.note, SETLIST_NOTE_MAX)
  if (!workId && !customTitle) {
    throw new Error('Velg et verk fra arkivet, eller skriv inn en tittel')
  }
  return { workId, customTitle: workId ? null : customTitle, note }
}

/**
 * Tittelen som vises for et punkt. `workTitle` er null når verket er slettet
 * fra arkivet (`work_id` er `ON DELETE SET NULL`) — da står punktet igjen med
 * rekkefølgen og merknaden sin, og sier hva som skjedde i stedet for å
 * forsvinne fra planen.
 */
export function setlistItemTitle(item: {
  workId: string | null
  workTitle?: string | null
  customTitle: string | null
}): string {
  if (item.workId) return item.workTitle ?? 'Ukjent verk'
  if (item.customTitle) return item.customTitle
  return 'Slettet fra arkivet'
}
