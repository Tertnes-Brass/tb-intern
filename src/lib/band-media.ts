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

/** Rettigheten som gir «Legg til» og «Fjern» i fanen. Å se og velge krever bare innlogging. */
export const BAND_MEDIA_PERMISSION = 'gifs.manage'

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
