/**
 * Tertnes-fanen i GIF-velgeren: korpsets egne GIF-er og memes. Rene regler her
 * — ingen database, ingen R2 — så de kan brukes av API-rutene, serverfunksjonene
 * og velgeren, og testes uten Workers-runtime.
 *
 * Bytene ligger i R2 bak innloggingen (`/api/band-media/$id`), aldri i git eller
 * `public/`: repoet er offentlig, og GIF-ene viser folk i korpset. Et valg i
 * velgeren kopieres til et vanlig opplastet bilde i meldingen
 * (`src/server/band-media.ts`), så alt etter valget er som en opplasting.
 */

import { foldForSearch, searchTerms } from './post-search'

/**
 * Moderering: fjerne ALLE GIF-er i fanen, også andres. Å se, velge og legge til
 * krever bare innlogging, og alle kan fjerne sine egne (`canRemoveBandMedia`).
 */
export const BAND_MEDIA_PERMISSION = 'gifs.manage'

/**
 * Den som legger til, bekrefter at alle som er med har sagt ja. Avkrysningen er
 * påkrevd i skjemaet, og opplastingen avvises uten den (`?consent=1`) — også
 * for et rått kall.
 */
export const BAND_MEDIA_CONSENT_REQUIRED = 'Bekreft at alle som er med i GIF-en har sagt ja'

/** Feilen når noen prøver å fjerne en annens GIF uten `gifs.manage`. */
export const BAND_MEDIA_NOT_YOURS = 'Du kan bare fjerne GIF-er du har lagt til selv'

/** Et tak, så samlingen ikke vokser seg til et nytt arkiv. Rikelig for et korps. */
export const MAX_BAND_MEDIA = 200

/** Navnet står i velgeren og er alt-tekst: kort. */
export const MAX_BAND_MEDIA_TITLE = 60

/** Feilen når noen velger en GIF som nettopp ble fjernet. */
export const BAND_MEDIA_GONE = 'GIF-en finnes ikke lenger i Tertnes-samlingen'

/** Det velgeren får. Aldri R2-nøkkelen. */
export type BandMediaItem = {
  id: string
  title: string
  contentType: string
  width: number
  height: number
}

/** Det fanen får: hver GIF, om den er din, og hvem som la den til (til «Fjern»). */
export type BandMediaListItem = BandMediaItem & { mine: boolean; addedByName: string | null }

/** Egne GIF-er kan alltid fjernes; andres bare med `gifs.manage`. */
export function canRemoveBandMedia(item: { addedBy: string | null }, me: { id: string; canModerate: boolean }): boolean {
  return me.canModerate || (item.addedBy !== null && item.addedBy === me.id)
}

/** Den eneste veien til bytene. */
export function bandMediaUrl(id: string): string {
  return `/api/band-media/${encodeURIComponent(id)}`
}

/** Navnet slik det lagres: uten kontrolltegn, mellomrom samlet og trimmet. */
export function normalizeBandMediaTitle(title: string): string {
  return title
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Null når navnet kan brukes; ellers en feilmelding som kan vises. */
export function bandMediaTitleRejection(title: string): string | null {
  const normalized = normalizeBandMediaTitle(title)
  if (!normalized) return 'Gi GIF-en et navn'
  if (normalized.length > MAX_BAND_MEDIA_TITLE) return `Navnet kan være maks ${MAX_BAND_MEDIA_TITLE} tegn`
  return null
}

/**
 * Søket i fanen. Samme ordregler som søket på veggen (`searchTerms`): alle ord
 * må stå i navnet, æ/ø/å er egne bokstaver, andre aksenter foldes bort.
 * Rekkefølgen beholdes.
 */
export function filterBandMedia<T extends { title: string }>(items: readonly T[], query: string): T[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return [...items]
  return items.filter((item) => {
    const title = foldForSearch(item.title)
    return terms.every((term) => title.includes(term))
  })
}
