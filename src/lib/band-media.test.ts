import { describe, expect, it } from 'vitest'
import { MAX_BAND_MEDIA_TITLE, bandMediaTitleRejection, bandMediaUrl, canRemoveBandMedia, filterBandMedia, normalizeBandMediaTitle } from './band-media'

describe('navnet på en Tertnes-GIF', () => {
  it('samler mellomrom og fjerner kontrolltegn', () => {
    expect(normalizeBandMediaTitle('  Galleri\t69 \n')).toBe('Galleri 69')
    expect(normalizeBandMediaTitle('Galleri\u000069')).toBe('Galleri 69')
  })

  it('må ha et navn, og ikke for langt', () => {
    expect(bandMediaTitleRejection('   ')).toBe('Gi GIF-en et navn')
    expect(bandMediaTitleRejection('Galleri 69')).toBeNull()
    expect(bandMediaTitleRejection('x'.repeat(MAX_BAND_MEDIA_TITLE))).toBeNull()
    expect(bandMediaTitleRejection('x'.repeat(MAX_BAND_MEDIA_TITLE + 1))).toMatch(/maks/)
  })
})

describe('søket i Tertnes-fanen', () => {
  const items = [{ title: 'Galleri 69' }, { title: 'Øvelse på torsdag' }, { title: 'Café-pause' }, { title: 'Dirigenten jubler' }]

  it('tomt søk gir alt, i samme rekkefølge', () => {
    expect(filterBandMedia(items, '  ')).toEqual(items)
  })

  it('alle ord må stå i navnet, uten hensyn til store bokstaver', () => {
    expect(filterBandMedia(items, 'galleri')).toEqual([{ title: 'Galleri 69' }])
    expect(filterBandMedia(items, '69 GALLERI')).toEqual([{ title: 'Galleri 69' }])
    expect(filterBandMedia(items, 'galleri torsdag')).toEqual([])
  })

  it('æ/ø/å er egne bokstaver, andre aksenter foldes bort', () => {
    expect(filterBandMedia(items, 'øvelse')).toEqual([{ title: 'Øvelse på torsdag' }])
    expect(filterBandMedia(items, 'ovelse')).toEqual([])
    expect(filterBandMedia(items, 'cafe')).toEqual([{ title: 'Café-pause' }])
  })
})

it('adressen til bytene går via gaten', () => {
  expect(bandMediaUrl('abc/../x')).toBe('/api/band-media/abc%2F..%2Fx')
})

describe('hvem som kan fjerne en Tertnes-GIF', () => {
  it('egne alltid, andres og eierløse bare med moderering', () => {
    expect(canRemoveBandMedia({ addedBy: 'silje' }, { id: 'silje', canModerate: false })).toBe(true)
    expect(canRemoveBandMedia({ addedBy: 'styret' }, { id: 'silje', canModerate: false })).toBe(false)
    expect(canRemoveBandMedia({ addedBy: null }, { id: 'silje', canModerate: false })).toBe(false)
    expect(canRemoveBandMedia({ addedBy: null }, { id: 'styret', canModerate: true })).toBe(true)
    expect(canRemoveBandMedia({ addedBy: 'silje' }, { id: 'styret', canModerate: true })).toBe(true)
  })
})
