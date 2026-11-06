import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_MEDIA_BYTES,
  hasMessageContent,
  mediaLabel,
  mediaRejectionReason,
  messageMediaExtension,
  messageMediaUrl,
  mobileMediaRow,
  sniffImage,
  sniffedRejectionReason,
  textOrMediaLabel,
  uniqueMediaIds,
} from './message-media'

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const le16 = (n: number) => [n & 0xff, n >> 8]
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

const gif = (w: number, h: number) => bytes('GIF89a', le16(w), le16(h), [0, 0, 0])
const png = (w: number, h: number) => bytes([0x89], 'PNG\r\n\x1a\n', be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0])
const sof0 = (w: number, h: number) => [0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
/** APP1 med en TIFF-header og én IFD-oppføring: orientering. */
const exif = (orientation: number, little: boolean) => {
  const u16 = little ? le16 : be16
  const u32 = (n: number) => (little ? be32(n).reverse() : be32(n))
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)]
  const data = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(tiff)
  return [0xff, 0xe1, ...be16(data.length + 2), ...data]
}
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 0xff, 0xd9])

describe('sniffImage', () => {
  it('leser GIF og størrelsen', () => {
    expect(sniffImage(gif(480, 270))).toEqual({ contentType: 'image/gif', width: 480, height: 270 })
    expect(sniffImage(bytes('GIF87a', le16(1), le16(1), [0]))).toEqual({ contentType: 'image/gif', width: 1, height: 1 })
  })

  it('leser PNG — også en ekte fil fra repoet', () => {
    expect(sniffImage(png(1170, 2532))).toEqual({ contentType: 'image/png', width: 1170, height: 2532 })
    const icon = readFileSync(fileURLToPath(new URL('../../public/icons/icon-192.png', import.meta.url)))
    expect(sniffImage(new Uint8Array(icon))).toEqual({ contentType: 'image/png', width: 192, height: 192 })
  })

  it('leser JPEG fra SOF, forbi andre segmenter', () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...'JFIF\0'.split('').map((c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0]
    expect(sniffImage(jpeg(app0, sof0(4032, 3024)))).toEqual({ contentType: 'image/jpeg', width: 4032, height: 3024 })
    // Progressiv JPEG (SOF2) teller også.
    const sof2 = sof0(800, 600)
    sof2[1] = 0xc2
    expect(sniffImage(jpeg(sof2))).toMatchObject({ width: 800, height: 600 })
  })

  it('bytter bredde og høyde når EXIF sier at telefonbildet skal roteres', () => {
    expect(sniffImage(jpeg(exif(6, true), sof0(4032, 3024)))).toMatchObject({ width: 3024, height: 4032 })
    expect(sniffImage(jpeg(exif(8, false), sof0(4032, 3024)))).toMatchObject({ width: 3024, height: 4032 })
    expect(sniffImage(jpeg(exif(1, true), sof0(4032, 3024)))).toMatchObject({ width: 4032, height: 3024 })
    expect(sniffImage(jpeg(exif(3, false), sof0(4032, 3024)))).toMatchObject({ width: 4032, height: 3024 })
  })

  it('hopper over løse bytes mellom segmentene, som dekoderne gjør', () => {
    const app0 = [0xff, 0xe0, ...be16(4), 0, 0]
    expect(sniffImage(jpeg(app0, [0x00, 0x7f], sof0(9000, 12000)))).toMatchObject({ width: 9000, height: 12000 })
  })

  it('tar en JPEG uten SOF som JPEG, men uten størrelse', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ contentType: 'image/jpeg', width: null, height: null })
    // En avkuttet fil skal ikke lese forbi slutten.
    expect(sniffImage(jpeg(sof0(10, 10)).slice(0, 8))).toEqual({ contentType: 'image/jpeg', width: null, height: null })
  })

  it('leser alle tre WebP-variantene', () => {
    const riff = (chunk: string, payload: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], payload)
    // VP8X: lerret 24-bit minus én.
    expect(sniffImage(riff('VP8X', [0x10, 0, 0, 0, ...[0xdf, 0x01, 0x00], ...[0x0d, 0x01, 0x00]]))).toEqual({ contentType: 'image/webp', width: 480, height: 270 })
    // VP8L: 14 + 14 bit minus én, etter signaturen 0x2f.
    const w = 640 - 1
    const h = 360 - 1
    const bits = w | (h << 14)
    expect(sniffImage(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]))).toEqual({ contentType: 'image/webp', width: 640, height: 360 })
    // VP8 (tapsbasert): startkode 9d 01 2a, så 14-bit bredde og høyde.
    expect(sniffImage(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(320), ...le16(240)]))).toEqual({ contentType: 'image/webp', width: 320, height: 240 })
  })

  it('avviser alt annet, uansett hva filen kalles', () => {
    expect(sniffImage(bytes('<!doctype html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(bytes('%PDF-1.7'))).toBeNull()
    expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
    expect(sniffImage(bytes('GIF89a'))).toBeNull()
  })
})

describe('avvisninger', () => {
  it('nettleseren stopper feil type og for store filer før opplasting', () => {
    expect(mediaRejectionReason({ type: 'image/gif', size: 1000 })).toBeNull()
    expect(mediaRejectionReason({ type: 'IMAGE/JPEG', size: 1000 })).toBeNull()
    expect(mediaRejectionReason({ type: 'image/heic', size: 1000 })).toMatch(/Bare bilder/)
    expect(mediaRejectionReason({ type: 'image/svg+xml', size: 1000 })).toMatch(/Bare bilder/)
    expect(mediaRejectionReason({ type: 'image/gif', size: MAX_MESSAGE_MEDIA_BYTES + 1 })).toMatch(/10 MB/)
    expect(mediaRejectionReason({ type: 'image/gif', size: 0 })).toBe('Tom fil')
  })

  it('serveren avgjør ut fra bytene', () => {
    expect(sniffedRejectionReason(sniffImage(gif(10, 10)), 13)).toBeNull()
    expect(sniffedRejectionReason(null, 100)).toMatch(/Bare bilder/)
    expect(sniffedRejectionReason(sniffImage(gif(10, 10)), 0)).toBe('Tom fil')
    expect(sniffedRejectionReason(sniffImage(gif(10, 10)), MAX_MESSAGE_MEDIA_BYTES + 1)).toMatch(/10 MB/)
    // En liten fil som pakker seg ut til et enormt bilde.
    expect(sniffedRejectionReason(sniffImage(png(20000, 20000)), 100)).toMatch(/piksler/)
    // Uten størrelse kan pikseltaket ikke håndheves.
    expect(sniffedRejectionReason(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 4)).toBe('Kunne ikke lese bildet')
  })
})

describe('merkelapper', () => {
  const g = { contentType: 'image/gif' }
  const p = { contentType: 'image/png' }

  it('sier hva som ble sendt der bildet ikke kan vises', () => {
    expect(mediaLabel([])).toBe('')
    expect(mediaLabel([g])).toBe('GIF')
    expect(mediaLabel([p])).toBe('Bilde')
    expect(mediaLabel([g, g])).toBe('2 GIF-er')
    expect(mediaLabel([g, p, p])).toBe('3 bilder')
  })

  it('bruker teksten når den finnes, ellers merkelappen', () => {
    expect(textOrMediaLabel('Haha', [g])).toBe('Haha')
    expect(textOrMediaLabel('  ', [g])).toBe('GIF')
    expect(textOrMediaLabel('', [])).toBe('')
  })

  it('en melding trenger tekst eller et bilde', () => {
    expect(hasMessageContent('', [])).toBe(false)
    expect(hasMessageContent('  \n', [])).toBe(false)
    expect(hasMessageContent('', ['a'])).toBe(true)
    expect(hasMessageContent('hei', [])).toBe(true)
  })

  it('id-ene fra klienten blir unike, i samme rekkefølge', () => {
    expect(uniqueMediaIds(['b', 'a', 'b'])).toEqual(['b', 'a'])
  })

  it('adressen går alltid gjennom gaten, og nøkkelen bygges av typen', () => {
    expect(messageMediaUrl('abc')).toBe('/api/message-media/abc')
    expect(messageMediaExtension('image/jpeg')).toBe('jpg')
    expect(messageMediaExtension('image/gif')).toBe('gif')
    expect(messageMediaExtension('image/webp')).toBe('webp')
  })
})

describe('mobilappen', () => {
  const gif = (id: string) => ({ id, contentType: 'image/gif', width: 1, height: 1 })

  it('viser det første bildet i raden og sier fra om resten', () => {
    expect(mobileMediaRow('Hei', [])).toEqual({ body: 'Hei' })
    expect(mobileMediaRow('', [gif('a')])).toEqual({ body: 'GIF', imagePath: '/api/message-media/a' })
    expect(mobileMediaRow('Se her', [gif('a'), gif('b')])).toEqual({ body: 'Se her\n\n(+ GIF)', imagePath: '/api/message-media/a' })
    expect(mobileMediaRow('', [gif('a'), gif('b'), gif('c')])).toEqual({ body: 'GIF\n\n(+ 2 GIF-er)', imagePath: '/api/message-media/a' })
  })

  it('viser aldri et KLIPY-valg som bilde — appen følger ikke omdirigeringen dit', () => {
    const klipy = (id: string) => ({ id, contentType: 'image/webp', width: 1, height: 1, externalUrl: 'https://static.klipy.com/ii/x/a.webp', externalKind: 'gif' as const })
    expect(mobileMediaRow('', [klipy('k')])).toEqual({ body: 'GIF' })
    expect(mobileMediaRow('Haha', [klipy('k')])).toEqual({ body: 'Haha\n\n(+ GIF)' })
    expect(mobileMediaRow('', [klipy('k'), gif('a')])).toEqual({ body: 'GIF\n\n(+ GIF)', imagePath: '/api/message-media/a' })
  })
})
