/**
 * Minimal ZIP-skriver — «store» (metode 0, ingen komprimering).
 *
 * Notene er PDF-er som allerede er komprimerte, så deflate ville kostet CPU
 * uten å spare plass. Arkivet settes sammen i NETTLESEREN: CRC32 må røre hver
 * byte i hver fil, og det sprenger CPU-grensen per request på Workers — samme
 * grunn som at sidetellingen ved opplasting ble flyttet til klienten.
 *
 * Ren modul: ingen `cloudflare:workers`, ingen DB, ingen DOM. Alt her er
 * enhetstestet i `zip.test.ts`.
 */

export type ZipEntry = {
  /** Ønsket filnavn i arkivet. Saneres og gjøres unikt av `buildZip`. */
  name: string
  bytes: Uint8Array
}

/** UTF-8-flagget (generelt flagg bit 11) — uten det blir «æøå» søppel. */
const FLAG_UTF8 = 0x0800

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

/** Versjon 2.0 er nok for «store» uten zip64. */
const VERSION = 20

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

/**
 * Zip64 er ikke implementert, så hele arkivet må holde seg innenfor 32-bits
 * felt for størrelser og forskyvninger.
 */
const MAX_ZIP_BYTES = 0xffff_ffff

/** Antall oppføringer i EOCD er også et 16-bits felt. */
const MAX_ZIP_ENTRIES = 0xffff

/** Nok til lange verkstitler, kort nok for Windows sin stigrense. */
const MAX_ENTRY_NAME_LENGTH = 120

// ---------- CRC32 ----------

/** Standard CRC-32 (IEEE 802.3), reversert polynom 0xEDB88320. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

/**
 * CRC32 over alle bytene, tabelldrevet. `seed` gjør det mulig å fortsette på en
 * tidligere delsum (brukes ikke av `buildZip`, men holder funksjonen ærlig).
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (~c >>> 0) >>> 0
}

// ---------- Filnavn ----------

// Kontrolltegn og tegn som er ulovlige i filnavn på Windows/macOS. `/` og `\`
// må bort spesielt: de ville gjort oppføringen til en mappe i arkivet.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g

/** «.pdf» fra «Score.PDF». Tom streng når endelsen ikke ser ut som en endelse. */
export function fileExtension(fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]{1,8})$/)
  return match ? `.${match[1]!.toLowerCase()}` : ''
}

/**
 * Rydder ett filnavn: ulovlige tegn erstattes, mellomrom kollapses, skjulte
 * navn («.», «..») og etterstilt punktum (som Windows nekter) fjernes. Kutter
 * langt navn, men beholder endelsen.
 */
export function sanitizeZipEntryName(raw: string): string {
  const cleaned = raw
    // Tabulator og linjeskift blir mellomrom før kontrolltegnene fjernes —
    // ellers ville «2.\tkornett» kollapset til «2.kornett».
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(ILLEGAL_CHARS, '-')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim()
  if (!cleaned) return 'fil'

  const ext = fileExtension(cleaned)
  const stem = ext ? cleaned.slice(0, -ext.length) : cleaned
  if (cleaned.length <= MAX_ENTRY_NAME_LENGTH) return stem ? cleaned : `fil${ext}`
  return `${stem.slice(0, MAX_ENTRY_NAME_LENGTH - ext.length).trimEnd()}${ext}`
}

/** Setter inn «(2)» foran endelsen: «Kornett.pdf» → «Kornett (2).pdf». */
function withCounter(name: string, counter: number): string {
  const ext = fileExtension(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  return `${stem} (${counter})${ext}`
}

/**
 * Saner alle navn og gjør dem unike, i samme rekkefølge som inn. Sammenligningen
 * er ufølsom for store/små bokstaver siden Windows og macOS ellers ville sett to
 * oppføringer som samme fil ved utpakking.
 */
export function uniqueZipEntryNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw) => {
    const base = sanitizeZipEntryName(raw)
    let name = base
    for (let counter = 2; used.has(name.toLowerCase()); counter++) {
      name = sanitizeZipEntryName(withCounter(base, counter))
    }
    used.add(name.toLowerCase())
    return name
  })
}

/**
 * Filnavn på selve arkivet: «Julekonsert 2026» → «Julekonsert 2026.zip».
 */
export function zipArchiveName(base: string): string {
  const name = sanitizeZipEntryName(base)
  return /\.zip$/i.test(name) ? name : `${name}.zip`
}

/**
 * Ryddig navn inne i arkivet, satt sammen av delene som finnes:
 * `zipEntryName(['01', 'Where Eagles Sing', '2. kornett'], 'we-2nd-cornet.pdf')`
 * → `01 - Where Eagles Sing - 2. kornett.pdf`. Endelsen tas fra kildefilen.
 */
export function zipEntryName(segments: Array<string | null | undefined>, sourceFileName: string): string {
  const base = segments.map((s) => (s ?? '').trim()).filter(Boolean).join(' - ')
  return sanitizeZipEntryName(`${base}${fileExtension(sourceFileName)}`)
}

// ---------- Arkivet ----------

/** DOS-tid/dato slik ZIP vil ha det. Sekunder har bare 2-sekunders oppløsning. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear())
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

/**
 * Bygger et komplett ZIP-arkiv: lokal header + data per fil, deretter den
 * sentrale katalogen og end-of-central-directory. Tom liste gir et gyldig, tomt
 * arkiv (bare EOCD).
 *
 * `modifiedAt` er felles tidsstempel for alle oppføringer — filene i R2 har
 * hvert sitt, men det er ikke tilgjengelig her, og utpakkeren trenger bare noe
 * gyldig.
 */
export function buildZip(
  entries: ZipEntry[],
  options: { modifiedAt?: Date } = {},
): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error('For mange filer i ett arkiv — last ned færre om gangen')
  }
  const encoder = new TextEncoder()
  const names = uniqueZipEntryNames(entries.map((e) => e.name)).map((n) => encoder.encode(n))
  const { time, date } = dosDateTime(options.modifiedAt ?? new Date())

  const localSize = entries.reduce(
    (sum, e, i) => sum + LOCAL_HEADER_SIZE + names[i]!.length + e.bytes.length,
    0,
  )
  const centralSize = names.reduce((sum, n) => sum + CENTRAL_HEADER_SIZE + n.length, 0)
  const total = localSize + centralSize + EOCD_SIZE
  if (total > MAX_ZIP_BYTES) {
    throw new Error('Arkivet ble for stort — last ned færre filer om gangen')
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let at = 0
  const u16 = (v: number) => {
    view.setUint16(at, v, true)
    at += 2
  }
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true)
    at += 4
  }
  const raw = (bytes: Uint8Array) => {
    out.set(bytes, at)
    at += bytes.length
  }

  // Lokale headere med data. Forskyvningen til hver header må huskes til den
  // sentrale katalogen.
  const offsets: number[] = []
  const crcs: number[] = []
  for (const [i, entry] of entries.entries()) {
    offsets.push(at)
    crcs.push(crc32(entry.bytes))
    u32(SIG_LOCAL)
    u16(VERSION)
    u16(FLAG_UTF8)
    u16(0) // metode: store
    u16(time)
    u16(date)
    u32(crcs[i]!)
    u32(entry.bytes.length) // komprimert = ukomprimert ved store
    u32(entry.bytes.length)
    u16(names[i]!.length)
    u16(0) // ingen ekstrafelt
    raw(names[i]!)
    raw(entry.bytes)
  }

  const centralStart = at
  for (const [i, entry] of entries.entries()) {
    u32(SIG_CENTRAL)
    u16(VERSION) // laget av
    u16(VERSION) // kreves for å pakke ut
    u16(FLAG_UTF8)
    u16(0)
    u16(time)
    u16(date)
    u32(crcs[i]!)
    u32(entry.bytes.length)
    u32(entry.bytes.length)
    u16(names[i]!.length)
    u16(0) // ekstrafelt
    u16(0) // kommentar
    u16(0) // disk
    u16(0) // interne attributter
    u32(0) // eksterne attributter
    u32(offsets[i]!)
    raw(names[i]!)
  }

  // `at` løper videre mens EOCD skrives, så katalogens størrelse må leses av
  // før den brukes.
  const centralEnd = at
  u32(SIG_EOCD)
  u16(0) // denne disken
  u16(0) // disken katalogen starter på
  u16(entries.length)
  u16(entries.length)
  u32(centralEnd - centralStart)
  u32(centralStart)
  u16(0) // ingen arkivkommentar

  return out
}
