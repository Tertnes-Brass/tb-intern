import { describe, expect, it } from 'vitest'
import { contentTypeForKlipyUrl, isKlipyMediaUrl, klipyEndpoint, parseKlipyCategories, parseKlipyItems } from './klipy'

const config = { appKey: 'key/1', customerId: 'c0ffee', apiBase: 'https://api.klipy.com' }
const cdn = (name: string) => `https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/${name}`
const fmt = (name: string, width = 220, height = 220) => ({ url: cdn(name), width, height, size: 100 })

describe('klipyEndpoint', () => {
  it('bygger søk, trending, nylig, kategorier og deling for hver fane', () => {
    expect(klipyEndpoint(config, 'gif', { op: 'search', q: 'god helg', page: 2 })).toBe(
      'https://api.klipy.com/api/v1/key%2F1/gifs/search?q=god+helg&page=2&per_page=24&customer_id=c0ffee&locale=no&content_filter=medium',
    )
    expect(klipyEndpoint(config, 'sticker', { op: 'trending', page: 1 })).toMatch(/\/stickers\/trending\?page=1&/)
    expect(klipyEndpoint(config, 'meme', { op: 'categories' })).toBe(
      'https://api.klipy.com/api/v1/key%2F1/static-memes/categories?locale=nb_NO',
    )
    expect(klipyEndpoint(config, 'gif', { op: 'recent', page: 1 })).toBe(
      'https://api.klipy.com/api/v1/key%2F1/gifs/recent/c0ffee?page=1&per_page=24',
    )
    expect(klipyEndpoint(config, 'gif', { op: 'share', slug: 'hello hi' })).toBe('https://api.klipy.com/api/v1/key%2F1/gifs/share/hello%20hi')
  })
})

describe('isKlipyMediaUrl', () => {
  it('godtar bare bilder på KLIPYs CDN-er over https', () => {
    expect(isKlipyMediaUrl(cdn('a.webp'))).toBe(true)
    expect(isKlipyMediaUrl('https://static2.klipy.com/ii/x/a.gif')).toBe(true)
    expect(isKlipyMediaUrl('http://static.klipy.com/ii/x/a.gif')).toBe(false)
    expect(isKlipyMediaUrl('https://static.klipy.com.evil.example/a.gif')).toBe(false)
    expect(isKlipyMediaUrl('https://evil.example/static.klipy.com/a.gif')).toBe(false)
    expect(isKlipyMediaUrl('https://user:pw@static.klipy.com/a.gif')).toBe(false)
    expect(isKlipyMediaUrl('https://static.klipy.com:8443/a.gif')).toBe(false)
    expect(isKlipyMediaUrl('https://static.klipy.com/ii/x/a.mp4')).toBe(false)
    expect(isKlipyMediaUrl('javascript:alert(1)//static.klipy.com/a.gif')).toBe(false)
    expect(isKlipyMediaUrl(42)).toBe(false)
  })

  it('leser bildetypen fra filendelsen', () => {
    expect(contentTypeForKlipyUrl(cdn('a.WEBP'))).toBe('image/webp')
    expect(contentTypeForKlipyUrl(cdn('a.png?x=1'))).toBe('image/png')
    expect(contentTypeForKlipyUrl(cdn('a.webm'))).toBeNull()
  })
})

describe('parseKlipyItems', () => {
  it('foretrekker animert WebP, holder rekkefølgen og leser «has_next»', () => {
    const json = {
      result: true,
      data: {
        has_next: true,
        data: [
          { slug: 'hello', title: 'Hello', type: 'gif', file: { sm: { gif: fmt('s.gif'), webp: fmt('s.webp') }, md: { gif: fmt('m.gif', 498, 400), webp: fmt('m.webp', 498, 400) } } },
          { slug: 'sticker', title: 'Rawr', type: 'sticker', file: { sm: { png: fmt('s.png') }, md: { png: fmt('m.png') } } },
        ],
      },
    }
    const { items, hasNext } = parseKlipyItems('gif', json)
    expect(hasNext).toBe(true)
    expect(items.map((i) => i.slug)).toEqual(['hello', 'sticker'])
    expect(items[0]).toEqual({ kind: 'gif', slug: 'hello', title: 'Hello', preview: { url: cdn('s.webp'), width: 220, height: 220 }, full: { url: cdn('m.webp'), width: 498, height: 400 }, still: null })
    expect(items[1]!.full.url).toBe(cdn('m.png'))
    // Stillbildet til redusert bevegelse: JPG/PNG, aldri en animert fil.
    expect(items[1]!.still).toEqual({ url: cdn('s.png'), width: 220, height: 220 })
  })

  it('hopper over annonser, fremmede adresser og objekter uten formater', () => {
    const json = {
      data: {
        data: [
          { slug: 'ad', type: 'ad', content: '<iframe>' },
          { slug: 'evil', title: 'x', file: { sm: { gif: { url: 'https://evil.example/a.gif', width: 1, height: 1 } }, md: { gif: { url: 'https://evil.example/a.gif', width: 1, height: 1 } } } },
          { slug: 'video', file: { md: { mp4: fmt('a.mp4') } } },
          { title: 'uten slug', file: { md: { gif: fmt('a.gif') } } },
          null,
        ],
      },
    }
    expect(parseKlipyItems('gif', json).items).toEqual([])
    expect(parseKlipyItems('gif', { result: false })).toEqual({ items: [], hasNext: false })
  })
})

describe('parseKlipyCategories', () => {
  it('leser kategorier og dropper en forhåndsvisning fra feil vert', () => {
    expect(
      parseKlipyCategories({
        data: {
          categories: [
            { category: 'smile', query: 'smile', preview_url: cdn('c.gif') },
            { category: 'evil', query: 'evil', preview_url: 'https://evil.example/c.gif' },
            { category: 'tom' },
          ],
        },
      }),
    ).toEqual([
      { label: 'smile', query: 'smile', previewUrl: cdn('c.gif') },
      { label: 'evil', query: 'evil', previewUrl: null },
    ])
  })
})
