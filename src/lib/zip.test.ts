import { describe, expect, it } from 'vitest'
import {
  buildZip,
  crc32,
  fileExtension,
  sanitizeZipEntryName,
  uniqueZipEntryNames,
  zipArchiveName,
  zipEntryName,
} from './zip'

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

/** CRC-32 regnet bit for bit — uavhengig referanse for den tabelldrevne. */
function crc32Bitwise(input: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of input) {
    c ^= byte
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (~c >>> 0) >>> 0
}

// ---------- Minimal utpakker, kun til testene ----------

type ReadEntry = {
  name: string
  crc: number
  compressedSize: number
  uncompressedSize: number
  method: number
  flags: number
  localOffset: number
  data: Uint8Array
}

/**
 * Leser arkivet slik en utpakker gjør: finn EOCD, følg den sentrale katalogen,
 * hopp til hver lokale header og trekk ut dataene. Alt som ikke stemmer kaster.
 * Dette er fasiten testene under måler mot — ikke bytetellinger.
 */
function readZip(zip: Uint8Array): { entries: ReadEntry[]; centralOffset: number; centralSize: number } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const eocd = zip.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  expect(view.getUint16(eocd + 8, true)).toBe(count)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  expect(centralOffset + centralSize).toBe(eocd)

  const entries: ReadEntry[] = []
  let at = centralOffset
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const uncompressedSize = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = text(zip.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    // Den lokale headeren må si det samme som katalogen, ellers avviser
    // utpakkere arkivet (eller pakker ut noe annet enn listen viser).
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    expect(view.getUint16(localOffset + 6, true)).toBe(flags)
    expect(view.getUint16(localOffset + 8, true)).toBe(method)
    expect(view.getUint32(localOffset + 14, true)).toBe(crc)
    expect(view.getUint32(localOffset + 18, true)).toBe(compressedSize)
    expect(view.getUint32(localOffset + 22, true)).toBe(uncompressedSize)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    expect(text(zip.subarray(localOffset + 30, localOffset + 30 + localNameLength))).toBe(name)
    const dataAt = localOffset + 30 + localNameLength + localExtraLength

    entries.push({
      name,
      crc,
      compressedSize,
      uncompressedSize,
      method,
      flags,
      localOffset,
      data: zip.subarray(dataAt, dataAt + compressedSize),
    })
  }
  expect(at).toBe(eocd)
  return { entries, centralOffset, centralSize }
}

// ---------- CRC32 ----------

describe('crc32', () => {
  it('treffer kjente kontrollverdier', () => {
    expect(crc32(bytes(''))).toBe(0)
    expect(crc32(bytes('a'))).toBe(0xe8b7be43)
    expect(crc32(bytes('abc'))).toBe(0x352441c2)
    // Standardens egen «check»-verdi for CRC-32.
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })

  it('gir samme svar som en bit-for-bit-implementasjon', () => {
    const cases = [
      bytes(''),
      bytes('2. kornett — æøå'),
      Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + 11) % 256),
      new Uint8Array(1000),
    ]
    for (const input of cases) expect(crc32(input)).toBe(crc32Bitwise(input))
  })

  it('kan fortsette på en delsum', () => {
    const whole = bytes('01 - Where Eagles Sing - 2. kornett')
    const split = crc32(whole.subarray(10), crc32(whole.subarray(0, 10)))
    expect(split).toBe(crc32(whole))
  })
})

// ---------- Filnavn ----------

describe('sanering av filnavn', () => {
  it('lar et ryddig norsk navn stå urørt', () => {
    expect(sanitizeZipEntryName('01 - Où sont les æøå - 2. kornett.pdf')).toBe(
      '01 - Où sont les æøå - 2. kornett.pdf',
    )
  })

  it('fjerner mappeskiller og ulovlige tegn', () => {
    expect(sanitizeZipEntryName('../../etc/passwd')).toBe('-..-etc-passwd')
    expect(sanitizeZipEntryName('C:\\noter\\Es*bass?.pdf')).toBe('C--noter-Es-bass-.pdf')
  })

  it('rydder tomrom, skjulte navn og etterstilt punktum', () => {
    expect(sanitizeZipEntryName('  2.\tkornett  ')).toBe('2. kornett')
    expect(sanitizeZipEntryName('.skjult')).toBe('skjult')
    expect(sanitizeZipEntryName('noter...')).toBe('noter')
    expect(sanitizeZipEntryName('   ')).toBe('fil')
  })

  it('kutter for lange navn, men beholder endelsen', () => {
    const long = sanitizeZipEntryName(`${'Tittel '.repeat(40)}.pdf`)
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long.endsWith('.pdf')).toBe(true)
  })

  it('plukker endelsen ut av kildefilnavnet', () => {
    expect(fileExtension('Gaelforce – Score.PDF')).toBe('.pdf')
    expect(fileExtension('opptak.M4A')).toBe('.m4a')
    expect(fileExtension('uten-endelse')).toBe('')
  })

  it('setter sammen nummer, verk og stemme', () => {
    expect(zipEntryName(['01', 'Where Eagles Sing', '2. kornett'], 'we-2nd-cornet.pdf')).toBe(
      '01 - Where Eagles Sing - 2. kornett.pdf',
    )
    // Tomme deler hoppes over i stedet for å gi doble bindestreker.
    expect(zipEntryName(['03', 'Vårsuite', null], 'x.pdf')).toBe('03 - Vårsuite.pdf')
  })

  it('navngir selve arkivet', () => {
    expect(zipArchiveName('Julekonsert 2026')).toBe('Julekonsert 2026.zip')
    expect(zipArchiveName('Vår/Høst: 2026')).toBe('Vår-Høst- 2026.zip')
    expect(zipArchiveName('alt.zip')).toBe('alt.zip')
  })
})

describe('unike navn', () => {
  it('nummererer kolliderende navn og holder rekkefølgen', () => {
    expect(uniqueZipEntryNames(['Kornett.pdf', 'Kornett.pdf', 'Kornett.pdf'])).toEqual([
      'Kornett.pdf',
      'Kornett (2).pdf',
      'Kornett (3).pdf',
    ])
  })

  it('regner store og små bokstaver som samme navn', () => {
    // Windows og macOS pakker ellers ut det ene oppå det andre.
    expect(uniqueZipEntryNames(['Es-bass.pdf', 'ES-BASS.pdf'])).toEqual([
      'Es-bass.pdf',
      'ES-BASS (2).pdf',
    ])
  })

  it('kolliderer ikke med et navn som allerede het «(2)»', () => {
    expect(uniqueZipEntryNames(['Horn.pdf', 'Horn (2).pdf', 'Horn.pdf'])).toEqual([
      'Horn.pdf',
      'Horn (2).pdf',
      'Horn (3).pdf',
    ])
  })
})

// ---------- Arkivet ----------

const modifiedAt = new Date('2026-07-29T14:31:05')

describe('buildZip', () => {
  it('skriver et arkiv som kan leses tilbake oppføring for oppføring', () => {
    const files = [
      { name: '01 - Where Eagles Sing - 2. kornett.pdf', bytes: bytes('%PDF-1.7 kornett\n') },
      { name: '02 - Vårsuite - Es-bass.pdf', bytes: bytes('%PDF-1.7 bass\n') },
    ]
    const { entries, centralOffset } = readZip(buildZip(files, { modifiedAt }))

    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name))
    for (const [i, entry] of entries.entries()) {
      expect(entry.method).toBe(0) // store — ingen komprimering
      expect(entry.flags & 0x0800).toBe(0x0800) // UTF-8-flagget
      expect(entry.uncompressedSize).toBe(files[i]!.bytes.length)
      expect(entry.compressedSize).toBe(entry.uncompressedSize)
      expect(entry.crc).toBe(crc32Bitwise(files[i]!.bytes))
      expect(text(entry.data)).toBe(text(files[i]!.bytes))
    }

    // Forskyvningene skal peke framover, og katalogen ligge etter dataene.
    expect(entries[0]!.localOffset).toBe(0)
    expect(entries[1]!.localOffset).toBeGreaterThan(entries[0]!.localOffset)
    expect(centralOffset).toBeGreaterThan(entries[1]!.localOffset)
  })

  it('bevarer norske tegn i filnavnet', () => {
    const name = 'Où sont les æøå — 3. kornett.pdf'
    const zip = buildZip([{ name, bytes: bytes('noter') }], { modifiedAt })
    const { entries } = readZip(zip)
    expect(entries[0]!.name).toBe(name)
    // Navnet ligger som UTF-8 i arkivet — flere byte enn tegn.
    const view = new DataView(zip.buffer)
    expect(view.getUint16(26, true)).toBeGreaterThan(name.length)
  })

  it('gjør kolliderende navn unike i selve arkivet', () => {
    const { entries } = readZip(
      buildZip(
        [
          { name: 'Kornett.pdf', bytes: bytes('en') },
          { name: 'Kornett.pdf', bytes: bytes('to') },
        ],
        { modifiedAt },
      ),
    )
    expect(entries.map((e) => e.name)).toEqual(['Kornett.pdf', 'Kornett (2).pdf'])
    expect(entries.map((e) => text(e.data))).toEqual(['en', 'to'])
  })

  it('gir et gyldig, tomt arkiv uten filer', () => {
    const zip = buildZip([], { modifiedAt })
    expect(zip.length).toBe(22) // bare EOCD
    const { entries, centralSize, centralOffset } = readZip(zip)
    expect(entries).toEqual([])
    expect(centralSize).toBe(0)
    expect(centralOffset).toBe(0)
  })

  it('tar med tomme filer uten å ødelegge forskyvningene', () => {
    const { entries } = readZip(
      buildZip(
        [
          { name: 'tom.pdf', bytes: new Uint8Array(0) },
          { name: 'etter.pdf', bytes: bytes('kommer etter') },
        ],
        { modifiedAt },
      ),
    )
    expect(entries[0]!.uncompressedSize).toBe(0)
    expect(entries[0]!.crc).toBe(0)
    expect(text(entries[1]!.data)).toBe('kommer etter')
  })

  it('skriver tidsstempelet i DOS-format', () => {
    const view = new DataView(buildZip([{ name: 'a.pdf', bytes: bytes('a') }], { modifiedAt }).buffer)
    const time = view.getUint16(10, true)
    const date = view.getUint16(12, true)
    expect([time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2]).toEqual([14, 31, 4])
    expect([1980 + (date >> 9), (date >> 5) & 0xf, date & 0x1f]).toEqual([2026, 7, 29])
  })
})
