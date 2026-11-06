/**
 * Bilder, GIF-er, stickers og memes i samtalene: forumet, kommentarene på veggen
 * og de to chattene. Rene regler her — ingen database, ingen R2, ingen
 * nettleser-API-er — så de kan brukes både av API-rutene, serverfunksjonene og
 * skrivefeltene, og testes uten Workers-runtime.
 *
 * To kilder:
 * - Opplastet: bytene ligger i R2 under `message-media/<fersk id>.<ext>` og
 *   hentes KUN via `/api/message-media/$mediaId`, som gjentar tilgangsregelen
 *   til det bildet står i (se `src/server/message-media.ts`).
 * - Fra GIF-velgeren (KLIPY): leserens nettleser henter mediet rett fra KLIPYs
 *   CDN — det er vilkåret for å bruke KLIPY (se `src/lib/klipy.ts` og
 *   docs/bilder-i-samtaler.md). Et bevisst unntak fra regelen om ingen bilder
 *   fra tredjepart, og bare for adresser `isKlipyMediaUrl` godtar.
 */

/** Hvor et bilde kan stå. Null i databasen = lastet opp, men ennå ikke sendt. */
export const MESSAGE_MEDIA_TARGETS = ['forum_topic', 'forum_reply', 'post_comment', 'board_message', 'leader_message'] as const
export type MessageMediaTarget = (typeof MESSAGE_MEDIA_TARGETS)[number]

/**
 * Bare formater alle nettlesere kan vise. HEIC er med vilje utelatt (veggen
 * tar det, men Chrome og Firefox viser det ikke) — iPhone gjør det om til JPEG
 * selv når filvelgeren ikke ber om HEIC. SVG kommer aldri inn: det er et
 * dokument med skript, ikke et bilde.
 */
export const MESSAGE_MEDIA_TYPES = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'] as const
export type MessageMediaType = (typeof MESSAGE_MEDIA_TYPES)[number]

/** `accept` på filvelgeren. */
export const MESSAGE_MEDIA_ACCEPT = MESSAGE_MEDIA_TYPES.join(',')

/** Maks størrelse per fil — som bildene på veggen. En lang GIF kan være stor. */
export const MAX_MESSAGE_MEDIA_BYTES = 10 * 1024 * 1024
/** Maks antall bilder i ett innlegg, svar, kommentar eller melding. */
export const MAX_MEDIA_PER_ITEM = 4
/**
 * Maks antall opplastede, ikke sendte bilder per medlem. Et tak, så et rått
 * kall ikke kan fylle lageret med filer som aldri sendes.
 */
export const MAX_PENDING_MEDIA = 12
/** Så lenge et opplastet, ikke sendt bilde får ligge før den daglige ryddingen tar det. */
export const PENDING_MEDIA_TTL_MS = 24 * 60 * 60 * 1000
/**
 * Et utkast eldre enn dette regnes som forlatt når taket er nådd: den nye
 * opplastingen får plassen. (Laster man siden på nytt med bilder i
 * skrivefeltet, kan utkastene bli liggende — ingen skal låses ute i et døgn.)
 */
export const PENDING_MEDIA_STALE_MS = 60 * 60 * 1000
/**
 * Bilder som er koblet til noe som ikke finnes lenger (slettet melding eller
 * kommentar, slettet innlegg) ryddes først når koblingen er så gammel. Et bilde
 * kobles FØR raden det står i skrives, og ryddingen skal aldri treffe det
 * øyeblikket imellom.
 */
export const ORPHAN_MEDIA_GRACE_MS = 60 * 60 * 1000
/**
 * Største bildeflate vi tar imot. Nok for et 48 MP telefonbilde, men stopper en
 * liten fil som pakker seg ut til et enormt bilde (og tar ned en telefon).
 */
export const MAX_MESSAGE_MEDIA_PIXELS = 100_000_000

/** Hva et valg fra GIF-velgeren er. Opplastede bilder har ingen. */
export const EXTERNAL_MEDIA_KINDS = ['gif', 'sticker', 'meme'] as const
export type ExternalMediaKind = (typeof EXTERNAL_MEDIA_KINDS)[number]

/** Det klienten trenger for å vise et bilde. Aldri R2-nøkkelen. */
export type MessageMediaItem = {
  id: string
  contentType: string
  /** Fra bytene ved opplasting, eller fra KLIPY. Kun til layout. */
  width: number | null
  height: number | null
  /**
   * Adressen på KLIPYs CDN for et valg fra GIF-velgeren (vises direkte derfra);
   * null for et opplastet bilde, som alltid går gjennom gaten.
   */
  externalUrl?: string | null
  externalKind?: ExternalMediaKind | null
  /** Tittelen fra KLIPY — alt-tekst. */
  title?: string | null
}

/**
 * Gaten for et bilde. For et opplastet bilde er det den ENESTE veien til
 * bytene; for et KLIPY-valg sender den videre til KLIPY etter tilgangssjekken.
 */
export function messageMediaUrl(id: string): string {
  return `/api/message-media/${encodeURIComponent(id)}`
}

/** Adressen nettleseren viser bildet fra. */
export function mediaSrc(item: MessageMediaItem): string {
  return item.externalUrl ?? messageMediaUrl(item.id)
}

/** Filendelsen R2-nøkkelen får. Nøkkelen bygges ALDRI av filnavnet. */
export function messageMediaExtension(type: MessageMediaType): string {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length)
}

/**
 * Tidlig avvisning i nettleseren, før noe lastes opp. Serveren stoler ikke på
 * dette: den leser formatet fra selve bytene (`sniffImage`).
 */
export function mediaRejectionReason(file: { type: string; size: number }): string | null {
  if (!(MESSAGE_MEDIA_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return 'Bare bilder og GIF-er (JPG, PNG, WebP eller GIF)'
  }
  if (file.size > MAX_MESSAGE_MEDIA_BYTES) return 'Filen er større enn 10 MB'
  if (file.size <= 0) return 'Tom fil'
  return null
}

type Labelled = { contentType: string; externalKind?: ExternalMediaKind | null }

/** En GIF — opplastet som .gif, eller valgt som GIF i velgeren (KLIPY leverer animert WebP). */
export const isGifItem = (item: Labelled) => item.externalKind === 'gif' || (!item.externalKind && item.contentType === 'image/gif')
/** Beveger det seg? GIF-er og stickers (som oftest er animerte). */
export const isAnimatedItem = (item: Labelled) => isGifItem(item) || item.externalKind === 'sticker'

const singleLabel = (item: Labelled) =>
  isGifItem(item) ? 'GIF' : item.externalKind === 'sticker' ? 'Sticker' : item.externalKind === 'meme' ? 'Meme' : 'Bilde'

/**
 * Det et bilde heter der det ikke kan vises: utdrag, svarreferanser, push og
 * mobilappen. «GIF», «Sticker», «Meme», «Bilde», «2 GIF-er» eller «3 bilder»;
 * tom streng uten bilder.
 */
export function mediaLabel(items: ReadonlyArray<Labelled>): string {
  if (items.length === 0) return ''
  if (items.length === 1) return singleLabel(items[0]!)
  return items.every(isGifItem) ? `${items.length} GIF-er` : `${items.length} bilder`
}

/**
 * Teksten, eller merkelappen for bildene når teksten er tom — en melding som
 * bare er en GIF skal ikke bli et tomt utdrag eller et tomt varsel.
 */
export function textOrMediaLabel(text: string, items: ReadonlyArray<Labelled>): string {
  return text.trim() ? text : mediaLabel(items)
}

/**
 * Til mobilappen, som viser ETT bilde per rad (`imagePath`) og bare henter fra
 * vår egen vert — appen følger med vilje aldri en omdirigering (innloggingen
 * skal ikke følge med ut), så et KLIPY-valg kan ikke vises der. Raden får det
 * første OPPLASTEDE bildet, og teksten sier hva som ellers ble sendt
 * («(+ GIF)», «(+ 2 bilder)»). Uten tekst blir det merkelappen, så raden aldri
 * står tom.
 */
export function mobileMediaRow(text: string, items: ReadonlyArray<MessageMediaItem>): { body: string; imagePath?: string } {
  if (items.length === 0) return { body: text }
  const shown = items.find((i) => !i.externalUrl)
  const rest = items.filter((i) => i !== shown)
  const lead = text.trim() ? text : shown ? mediaLabel([shown]) : ''
  const more = rest.length ? (lead ? `(+ ${mediaLabel(rest)})` : mediaLabel(rest)) : ''
  const body = [lead, more].filter(Boolean).join('\n\n')
  return shown ? { body, imagePath: messageMediaUrl(shown.id) } : { body }
}

/** Feilmeldingen når en melding verken har tekst eller bilde. */
export const EMPTY_MESSAGE = 'Skriv noe eller legg til et bilde'

/** En melding må ha tekst, et bilde eller begge deler. */
export function hasMessageContent(body: string, mediaIds: readonly unknown[]): boolean {
  return body.trim().length > 0 || mediaIds.length > 0
}

/** Bilde-id-ene fra klienten: unike, i rekkefølgen de ble lagt til. */
export function uniqueMediaIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

// ---------- Formatet fra bytene ----------

export type SniffedImage = { contentType: MessageMediaType; width: number | null; height: number | null }

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!)
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + ((b[i + 3]! << 24) >>> 0)
const ascii = (b: Uint8Array, i: number, s: string) => {
  if (i + s.length > b.length) return false
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false
  return true
}
const size = (width: number, height: number) =>
  width > 0 && height > 0 ? { width, height } : { width: null, height: null }

/**
 * Hvilket bildeformat bytene FAKTISK er, og hvor stort bildet er. Null for alt
 * som ikke er GIF, PNG, JPEG eller WebP — uansett hva filnavnet eller
 * `Content-Type` påstår. Serveren lagrer og serverer med typen herfra, så en
 * HTML-fil kalt «meme.gif» blir avvist i stedet for å havne bak vår egen
 * opprinnelse.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) {
    if (bytes.length < 10) return null
    return { contentType: 'image/gif', ...size(u16le(bytes, 6), u16le(bytes, 8)) }
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) {
    if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null
    return { contentType: 'image/png', ...size(u32be(bytes, 16), u32be(bytes, 20)) }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', ...jpegSize(bytes) }
  }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return webp(bytes)
  }
  return null
}

function webp(b: Uint8Array): SniffedImage | null {
  if (ascii(b, 12, 'VP8X') && b.length >= 30) {
    return { contentType: 'image/webp', ...size(u24le(b, 24) + 1, u24le(b, 27) + 1) }
  }
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const bits = u32le(b, 21)
    return { contentType: 'image/webp', ...size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) }
  }
  if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { contentType: 'image/webp', ...size(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff) }
  }
  return null
}

/**
 * Bredde og høyde fra JPEG-ens SOF-segment, byttet om når EXIF sier at bildet
 * skal roteres 90° (telefonbilder lagres ofte liggende med en «snu meg»-merknad,
 * og nettleseren viser dem stående). Tallene brukes bare til å holde av plass
 * før bildet er lastet; finner vi dem ikke, blir det null.
 */
function jpegSize(b: Uint8Array): { width: number | null; height: number | null } {
  let rotated = false
  let i = 2
  while (i + 4 <= b.length) {
    // Løse bytes mellom segmentene hoppes over, slik dekoderne gjør — ellers
    // kunne én slik byte skjult størrelsen (og dermed pikseltaket).
    if (b[i] !== 0xff) { i += 1; continue }
    const marker = b[i + 1]!
    if (marker === 0xff) { i += 1; continue } // fyllbyte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (marker === 0xd9 || marker === 0xda) break // slutt / bildedata: ingen SOF før dette
    const length = u16be(b, i + 2)
    if (length < 2) break
    const start = i + 4
    if (marker === 0xe1 && ascii(b, start, 'Exif\0\0')) rotated = exifRotated(b, start + 6, Math.min(b.length, i + 2 + length))
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof && start + 5 <= b.length) {
      const height = u16be(b, start + 1)
      const width = u16be(b, start + 3)
      return rotated ? size(height, width) : size(width, height)
    }
    i += 2 + length
  }
  return { width: null, height: null }
}

/** Orienteringen i EXIF (tagg 0x0112) er 5–8: bildet vises rotert 90°. */
function exifRotated(b: Uint8Array, tiff: number, end: number): boolean {
  if (tiff + 8 > end) return false
  const little = ascii(b, tiff, 'II')
  if (!little && !ascii(b, tiff, 'MM')) return false
  const r16 = (i: number) => (little ? u16le(b, i) : u16be(b, i))
  const r32 = (i: number) => (little ? u32le(b, i) : u32be(b, i))
  const ifd = tiff + r32(tiff + 4)
  if (ifd + 2 > end) return false
  const entries = r16(ifd)
  for (let k = 0; k < entries; k++) {
    const entry = ifd + 2 + k * 12
    if (entry + 12 > end) return false
    if (r16(entry) === 0x0112) {
      const orientation = r16(entry + 8)
      return orientation >= 5 && orientation <= 8
    }
  }
  return false
}

/** Avvisning ut fra det bytene sa — samme meldinger som `mediaRejectionReason`. */
export function sniffedRejectionReason(image: SniffedImage | null, byteLength: number): string | null {
  if (byteLength <= 0) return 'Tom fil'
  if (byteLength > MAX_MESSAGE_MEDIA_BYTES) return 'Filen er større enn 10 MB'
  if (!image) return 'Bare bilder og GIF-er (JPG, PNG, WebP eller GIF)'
  // Uten størrelse kan pikseltaket ikke håndheves — et ekte bilde har alltid en.
  if (!image.width || !image.height) return 'Kunne ikke lese bildet'
  if (image.width * image.height > MAX_MESSAGE_MEDIA_PIXELS) return 'Bildet har for mange piksler'
  return null
}
