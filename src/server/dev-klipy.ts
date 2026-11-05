/**
 * KUN for `pnpm dev` uten `KLIPY_API_KEY`: en etterligning av KLIPYs API, så
 * GIF-velgeren kan prøves lokalt. Svarene har KLIPYs form og KLIPYs egne
 * eksempelfiler fra dokumentasjonen (ekte adresser på static.klipy.com, så
 * vertskontrollen `isKlipyMediaUrl` er like streng som i drift). Lastes bare
 * dynamisk fra `src/routes/api/dev-klipy/$.ts` bak `import.meta.env.DEV`.
 */

import type { ExternalMediaKind } from '../lib/message-media'

const ii = 'https://static.klipy.com/ii'
const SAMPLES: Record<ExternalMediaKind, { slug: string; title: string; file: Record<string, Record<string, { url: string; width: number; height: number }>> }> = {
  gif: {
    slug: 'hello-hi-662',
    title: 'Hello',
    file: {
      sm: { webp: { url: `${ii}/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp`, width: 220, height: 220 }, jpg: { url: `${ii}/935d7ab9d8c6202580a668421940ec81/14/af/uvntdY4w.jpg`, width: 220, height: 220 } },
      md: { webp: { url: `${ii}/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp`, width: 498, height: 498 } },
    },
  },
  sticker: {
    slug: 'grrr-rawr-sticker',
    title: 'Grrr Rawr Sticker',
    file: {
      sm: { webp: { url: `${ii}/ffd4ac143e6335ac68951b787d3c1902/e8/3a/wGlFlJ2s.webp`, width: 189, height: 200 }, png: { url: `${ii}/ffd4ac143e6335ac68951b787d3c1902/e8/3a/KX4PsBURNDPcgZSp.png`, width: 189, height: 200 } },
      md: { webp: { url: `${ii}/ffd4ac143e6335ac68951b787d3c1902/e8/3a/wGlFlJ2s.webp`, width: 189, height: 200 } },
    },
  },
  meme: {
    slug: '3-am-video-game-meme',
    title: '3 Am Video Game Meme',
    file: {
      sm: { webp: { url: `${ii}/b34001f2c30672cdcb3d906c28815404/ec/a9/bThosuyc.webp`, width: 220, height: 206 }, png: { url: `${ii}/b34001f2c30672cdcb3d906c28815404/ec/a9/Zsnxnc3o.png`, width: 220, height: 206 } },
      md: { webp: { url: `${ii}/b34001f2c30672cdcb3d906c28815404/ec/a9/8U1BjcqG.webp`, width: 498, height: 467 } },
    },
  },
}

const SEGMENT_KIND: Record<string, ExternalMediaKind> = { gifs: 'gif', stickers: 'sticker', 'static-memes': 'meme' }
const CATEGORIES = ['smil', 'hei', 'lol', 'kjærlighet', 'gratulerer', 'trist', 'jubel', 'dans']
const PREVIEW = `${ii}/e293a233a303a98e471f78d04e13a1b0/a5/fd/NnGoLmO8.gif`

/** KLIPYs svar for en sti under `/api/dev-klipy`, eller null for ukjent sti. */
export function devKlipyResponse(path: string, query: URLSearchParams, method: string): unknown | null {
  // /api/v1/<nøkkel>/<segment>/<operasjon>[/<id>]
  const parts = path.split('/').filter(Boolean)
  const [api, v1, , segment, op] = parts
  const kind = segment ? SEGMENT_KIND[segment] : undefined
  if (api !== 'api' || v1 !== 'v1' || !kind || !op) return null
  if (method === 'POST' && op === 'share') return { result: true }
  if (op === 'categories') {
    return { result: true, data: { locale: 'nb_NO', categories: CATEGORIES.map((c) => ({ category: c, query: c, preview_url: PREVIEW })) } }
  }
  if (op !== 'search' && op !== 'trending' && op !== 'recent') return null
  const sample = SAMPLES[kind]
  const file = sample.file
  const page = Math.max(1, Number(query.get('page')) || 1)
  const q = query.get('q') ?? ''
  const count = op === 'recent' ? 3 : 24
  const data = Array.from({ length: count }, (_, i) => ({
    id: page * 1000 + i,
    slug: `${sample.slug}-${op}-${page}-${i}`,
    title: q ? `${q} ${page}.${i + 1}` : `${sample.title} ${page}.${i + 1}`,
    file,
    tags: [],
    type: kind === 'meme' ? 'static-meme' : kind,
  }))
  return { result: true, data: { data, current_page: page, per_page: count, has_next: op !== 'recent' && page < 3 } }
}
