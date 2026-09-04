/**
 * Reglene for mediearkivet (#32). Rene funksjoner uten server- eller
 * DOM-avhengigheter, slik at serveren, skjemaet, API-rutene og testene er enige
 * om hva et gyldig medieelement er — og slik at ingen av dem kan dra
 * `cloudflare:workers` inn i klientbygget ved et uhell.
 *
 * Området heter **Media** overalt: i URL-en (`/media`), i overskriften, i
 * hub-kortet og i denne modulen (docs/designprinsipper.md §1). «Opptak» ble
 * vurdert og forkastet — arkivet inneholder også PR-bilder og video fra
 * prosjekter, og et ord som bare dekker lyden ville vært feil på to av tre
 * skjermer.
 */

/** Rettigheten som gater ALL skriving i mediearkivet. Lesing er en annen sak — se `canViewMedia`. */
export const MEDIA_PERMISSION = 'media.manage'

/** Rettigheten som gir innsyn i elementer merket «Bare styret». */
export const BOARD_PERMISSION = 'board.manage'

// ---------- Type ----------

/**
 * Typen er BEVISST ikke et fritt valg i skjemaet: den utledes av innholdstypen
 * på fila (`mediaKindFor`). Et element merket «lyd» som egentlig er en MP4 ville
 * gitt en `<audio>`-tagg rundt en video, og verre: to kilder til sannhet om hva
 * bytene er. Kolonnen finnes likevel, slik at lista kan filtrere uten å parse
 * MIME-typer i hver rad.
 */
export const MEDIA_KINDS = ['lyd', 'bilde', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export function isMediaKind(value: string): value is MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(value)
}

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  lyd: 'Lyd',
  bilde: 'Bilde',
  video: 'Video',
}

// ---------- Tilgangsnivå ----------

/**
 * Tre nivåer, og bare det midterste er en gate:
 *
 * - `intern` — alle aktive medlemmer. Standarden.
 * - `styre` — krever `board.manage`, også for å SE at elementet finnes.
 * - `offentlig-kandidat` — en **merking**, ikke en publisering. Elementet leses
 *   av nøyaktig de samme som et `intern`-element; forskjellen er at noen har
 *   sagt «denne kan vi bruke utad». Ingenting i denne kodebasen eksponerer et
 *   slikt element for verden, og det skal det heller ikke gjøre uten et eget,
 *   bevisst produktvalg. Verdien er en huskelapp til den som en dag skal lage
 *   PR-materiell — den er ikke en tilgang.
 */
export const MEDIA_VISIBILITIES = ['intern', 'styre', 'offentlig-kandidat'] as const
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number]

export function isMediaVisibility(value: string): value is MediaVisibility {
  return (MEDIA_VISIBILITIES as readonly string[]).includes(value)
}

export const VISIBILITY_LABELS: Record<MediaVisibility, string> = {
  intern: 'Intern',
  styre: 'Bare styret',
  'offentlig-kandidat': 'Kandidat for offentlig bruk',
}

export const VISIBILITY_HINTS: Record<MediaVisibility, string> = {
  intern: 'Alle aktive medlemmer kan se og spille av dette.',
  styre: 'Kun de som har styretilgang ser at elementet finnes.',
  'offentlig-kandidat':
    'Synlig for alle medlemmer, som «Intern». Merkingen betyr bare at opptaket kan brukes utad senere — det blir ikke publisert av seg selv.',
}

/**
 * Kan denne leseren se elementet? Regelen er ÉN funksjon, brukt av lista,
 * detaljsiden, redigeringen og filgaten — de fire kan ikke komme i utakt.
 *
 * `styre` er den eneste verdien som skjuler noe. `offentlig-kandidat` gir
 * bevisst samme svar som `intern`: en merking som også utvidet lesekretsen
 * ville vært to ting i ett felt, og den slags ender alltid med at noen setter
 * den uten å vite hva de gjorde.
 */
export function canViewMedia(
  item: { visibility: MediaVisibility },
  viewer: { canManageBoard: boolean },
): boolean {
  if (item.visibility === 'styre') return viewer.canManageBoard
  return true
}

/**
 * Nivåene denne skriveren kan SETTE. `styre` krever `board.manage` i tillegg til
 * `media.manage`, av en praktisk grunn like mye som en prinsipiell: uten regelen
 * kunne en medieansvarlig uten styretilgang merke sitt eget opptak «Bare styret»
 * og i samme sekund miste det selv — elementet ville forsvunnet fra hens egen
 * liste, uten en vei tilbake.
 */
export function assignableVisibilities(writer: { canManageBoard: boolean }): MediaVisibility[] {
  return MEDIA_VISIBILITIES.filter((v) => v !== 'styre' || writer.canManageBoard)
}

/**
 * Kan denne brukeren endre eller slette elementet? `media.manage` alene holder
 * ikke: du må også kunne SE det. Uten den andre halvdelen kunne en
 * medieansvarlig uten styretilgang slettet et styreopptak hen ikke har lov til
 * å høre — og få tittelen i feilmeldingen på kjøpet.
 *
 * Det finnes ingen «egen» opplasting som gir ekstra rett, slik det finnes et
 * eget innlegg på veggen. Den som lastet opp er en OPPLYSNING om hvor filen kom
 * fra, ikke en rettighet i systemet — samme linje som utstyrsregisteret trekker
 * for eierskap.
 */
export function canEditMedia(
  item: { visibility: MediaVisibility },
  viewer: { canManageMedia: boolean; canManageBoard: boolean },
): boolean {
  return viewer.canManageMedia && canViewMedia(item, viewer)
}

// ---------- Filer ----------

/**
 * 95 MB. Grensen er ikke en smakssak, den er plattformens: en Cloudflare Worker
 * tar imot en request-body på omtrent 100 MB, og alt over blir avvist av
 * kanten før koden vår ser den — altså en uforståelig nettverksfeil i stedet
 * for en melding. Vi avviser derfor selv, tidlig, med norsk tekst.
 *
 * KJENT HULL: et fullt konsertopptak i video sprenger dette lett. Løsningen er
 * multipart eller direkteopplasting mot R2 med en presignert URL, og det er et
 * eget arbeid — se rapporten for #32.
 */
export const MAX_MEDIA_BYTES = 95 * 1024 * 1024
export const MAX_MEDIA_MB = 95

/**
 * Innholdstypene arkivet tar imot, gruppert etter typen de gir. Lista er
 * bevisst kort og består av formater nettlesere faktisk spiller av: en `.mkv`
 * eller en rå `.aiff` ville blitt liggende som en fil ingen kan åpne i
 * grensesnittet, og da er den bedre tjent med et annet sted.
 */
export const MEDIA_TYPES: Record<MediaKind, readonly string[]> = {
  lyd: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/webm'],
  bilde: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
}

/**
 * Typen som følger av bytene. `null` betyr «ikke et format vi tar imot», og er
 * dermed også hele valideringen av innholdstypen — vi trenger ingen egen
 * allowlist ved siden av.
 */
export function mediaKindFor(contentType: string): MediaKind | null {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  for (const kind of MEDIA_KINDS) {
    if (MEDIA_TYPES[kind].includes(type)) return kind
  }
  return null
}

/** `null` = greit. Ellers en norsk begrunnelse klienten kan vise rått. */
export function mediaRejectionReason(file: { type: string; size: number }): string | null {
  if (!mediaKindFor(file.type)) {
    return 'Filtypen støttes ikke. Lyd (MP3, M4A, WAV, FLAC), bilde (JPG, PNG, WebP, HEIC) eller video (MP4, WebM, MOV)'
  }
  if (file.size <= 0) return 'Tom fil'
  if (file.size > MAX_MEDIA_BYTES) {
    return `Filen er større enn ${MAX_MEDIA_MB} MB. Større opptak må deles opp eller legges et annet sted inntil videre`
  }
  return null
}

/**
 * Filendelsen R2-nøkkelen skal ha. Nøkkelen bygges ALDRI av filnavnet, som er
 * brukerstyrt — den er en fersk id pluss denne endelsen.
 */
export function mediaExtension(contentType: string): string {
  switch (contentType.split(';')[0]!.trim().toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/flac':
      return 'flac'
    case 'audio/webm':
      return 'weba'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/heic':
      return 'heic'
    case 'image/jpeg':
      return 'jpg'
    case 'video/webm':
      return 'webm'
    case 'video/quicktime':
      return 'mov'
    default:
      return 'mp4'
  }
}

// Filstørrelse på norsk: `formatBytes` i src/lib/format.ts. Ingen egen her —
// «5.2 MB» skal se likt ut på en mediefil og en notefil.

// ---------- Range-forespørsler ----------

export type ByteRange = { offset: number; length: number }

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'range'; range: ByteRange }
  /** Klienten ba om noe utenfor filen — svaret er 416, ikke bytes. */
  | { kind: 'unsatisfiable' }

/**
 * Tolker en `Range`-header slik R2 og `<audio>`/`<video>` trenger det.
 *
 * Dette er grunnen til at avspillingen fungerer i det hele tatt: en `<audio>`
 * uten `Accept-Ranges`/206 kan ikke spole, og på Safari (iOS) starter den ikke
 * engang — nettleseren sender en `Range`-forespørsel først og gir opp hvis
 * serveren svarer 200 med hele filen. Et 40 minutters konsertopptak skal ikke
 * måtte lastes ned i sin helhet for at noen skal høre siste sats.
 *
 * Reglene følger RFC 9110 §14, med to bevisste forenklinger:
 *
 * - **Flere områder i én header** (`bytes=0-99,200-299`) behandles som «ingen
 *   range» og gir hele filen med 200. Et multipart/byteranges-svar er en helt
 *   annen responsform, og ingen mediespiller ber om det.
 * - **Ugyldig syntaks ignoreres** og gir hele filen, slik RFC-en foreskriver —
 *   det er bare et område som er *utenfor* filen som er en feil (416).
 */
export function parseByteRange(header: string | null | undefined, size: number): RangeResult {
  const raw = (header ?? '').trim()
  if (!raw) return { kind: 'full' }

  const match = /^bytes\s*=\s*(.+)$/i.exec(raw)
  if (!match) return { kind: 'full' } // ukjent enhet: skal ignoreres
  const spec = match[1]!.trim()
  if (spec.includes(',')) return { kind: 'full' }

  const parts = /^(\d*)-(\d*)$/.exec(spec)
  if (!parts) return { kind: 'full' }
  const startText = parts[1]!
  const endText = parts[2]!
  if (!startText && !endText) return { kind: 'full' }

  // En tom fil kan ikke tilfredsstille noe område i det hele tatt.
  if (size <= 0) return { kind: 'unsatisfiable' }

  if (!startText) {
    // `bytes=-500`: de siste N bytene. N = 0 er ikke tilfredsstillbart.
    const suffix = Number(endText)
    if (suffix <= 0) return { kind: 'unsatisfiable' }
    const length = Math.min(suffix, size)
    return { kind: 'range', range: { offset: size - length, length } }
  }

  const offset = Number(startText)
  if (offset >= size) return { kind: 'unsatisfiable' }
  if (!endText) return { kind: 'range', range: { offset, length: size - offset } }

  const endInclusive = Number(endText)
  if (endInclusive < offset) return { kind: 'full' } // ugyldig, ikke utenfor
  const last = Math.min(endInclusive, size - 1)
  return { kind: 'range', range: { offset, length: last - offset + 1 } }
}

/** `Content-Range` for et delsvar (206). */
export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`
}

/** `Content-Range` for et 416-svar: «filen er så stor, be om noe innenfor». */
export function unsatisfiableRangeHeader(size: number): string {
  return `bytes */${size}`
}

// ---------- Søk, filtrering og sortering ----------

export type MediaSummary = {
  id: string
  title: string
  kind: MediaKind
  visibility: MediaVisibility
  /** ISO-dato for når opptaket ble gjort. Null når ingen har oppgitt det. */
  recordedOn: string | null
  description: string | null
  projectName: string | null
  workTitle: string | null
}

export type MediaFilter = {
  q?: string
  kind?: MediaKind | null
  visibility?: MediaVisibility | null
  projectId?: string | null
  workId?: string | null
}

/**
 * Fritekstsøket treffer tittelen, beskrivelsen og navnene på prosjektet og
 * verket. Man husker som regel «Gaelforce på julekonserten», ikke filnavnet —
 * og filnavnet er derfor bevisst IKKE med: det er ofte `IMG_4711.mov` og ville
 * bare gitt tilfeldige treff.
 */
export function matchesMediaQuery(item: MediaSummary, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [item.title, item.description, item.projectName, item.workTitle, item.recordedOn]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

/** Filtrene kombineres med OG. Tomt filter gir hele lista, i samme rekkefølge. */
export function filterMedia<T extends MediaSummary & { projectId?: string | null; workId?: string | null }>(
  items: T[],
  filter: MediaFilter,
): T[] {
  return items.filter((item) => {
    if (filter.q && !matchesMediaQuery(item, filter.q)) return false
    if (filter.kind && item.kind !== filter.kind) return false
    if (filter.visibility && item.visibility !== filter.visibility) return false
    if (filter.projectId && (item.projectId ?? null) !== filter.projectId) return false
    if (filter.workId && (item.workId ?? null) !== filter.workId) return false
    return true
  })
}

/**
 * Nyeste først. Datoen er den som står PÅ opptaket (`recordedOn`), ikke når
 * noen fikk lastet det opp: et opptak fra 2019 som legges inn i dag hører
 * hjemme i 2019. Elementer uten dato havner sist, sortert på tittel — de kan
 * ikke rangeres på tid, og en gjetning ville vært verre enn en bunke bakerst.
 */
export function compareMedia(a: MediaSummary, b: MediaSummary): number {
  const da = a.recordedOn ?? ''
  const db = b.recordedOn ?? ''
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return db.localeCompare(da)
  }
  return a.title.localeCompare(b.title, 'nb')
}

// ---------- Validering ----------

export const MEDIA_TITLE_MAX = 160
export const MEDIA_DESCRIPTION_MAX = 4000

export type MediaInput = {
  title?: string | null
  recordedOn?: string | null
  description?: string | null
  visibility?: string | null
  projectId?: string | null
  workId?: string | null
}

export type MediaValue = {
  title: string
  recordedOn: string | null
  description: string | null
  visibility: MediaVisibility
  projectId: string | null
  workId: string | null
}

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Normaliserer og håndhever invariantene. Kaster med en norsk melding UI-et kan
 * vise rått — samme mønster som `sanitizeAssetInput` i src/lib/utstyr.ts.
 *
 * Kalles på BÅDE opprettelse og redigering, slik at et rått kall aldri kan
 * snike inn et tilgangsnivå kalleren ikke har lov til å sette. `writer` er
 * derfor et argument og ikke noe funksjonen slår opp selv: den skal kunne
 * testes uten database.
 */
export function sanitizeMediaInput(input: MediaInput, writer: { canManageBoard: boolean }): MediaValue {
  const title = clean(input.title, MEDIA_TITLE_MAX)
  if (!title) throw new Error('Medieelementet må ha en tittel')

  const rawVisibility = (input.visibility ?? 'intern').trim()
  if (!isMediaVisibility(rawVisibility)) throw new Error('Ugyldig tilgangsnivå')
  if (!assignableVisibilities(writer).includes(rawVisibility)) {
    throw new Error('Du kan ikke merke media «Bare styret» uten styretilgang')
  }

  const recordedOn = clean(input.recordedOn, 20)
  if (recordedOn && !/^\d{4}-\d{2}-\d{2}$/.test(recordedOn)) throw new Error('Datoen må være på formen ÅÅÅÅ-MM-DD')

  return {
    title,
    recordedOn,
    description: cleanText(input.description, MEDIA_DESCRIPTION_MAX),
    visibility: rawVisibility,
    projectId: clean(input.projectId, 64),
    workId: clean(input.workId, 64),
  }
}
