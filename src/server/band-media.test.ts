import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from './access'

/**
 * Tertnes-fanen i GIF-velgeren, mot ekte SQLite med ALLE migrasjoner og Drizzles
 * D1-driver. Det som skal bevises: at alle kan fjerne sine egne, men bare
 * `gifs.manage` andres, at et valg blir en egen KOPI i meldingen (så den
 * overlever at GIF-en fjernes fra samlingen), og at bytene faktisk forsvinner
 * fra R2. At alle innloggede kan legge til (med samtykke), er opplastingsruten.
 */

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  me: null as Me | null,
  r2: new Map<string, { bytes: Uint8Array; contentType?: string }>(),
}))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({
  env: {
    FILES: {
      put: async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        state.r2.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType })
      },
      get: async (key: string) => {
        const obj = state.r2.get(key)
        return obj ? { arrayBuffer: async () => obj.bytes.slice().buffer } : null
      },
      delete: async (keys: string | string[]) => {
        for (const key of [keys].flat()) state.r2.delete(key)
      },
    },
  },
}))
vi.mock('./access', () => {
  const hasPermission = (me: Me | null, permission: string) => !!me && (me.permissions.includes('*') || me.permissions.includes(permission))
  return {
    currentUser: async () => state.me,
    requireMe: async () => {
      if (!state.me) throw new Error('Krever innlogging')
      return state.me
    },
    requirePermission: async (permission: string) => {
      if (!hasPermission(state.me, permission)) throw new Error('Ingen tilgang')
      return state.me
    },
    hasPermission,
  }
})
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
    validator: (schema: { parse: (data: unknown) => unknown }) => ({
      handler: (fn: (args: { data: unknown }) => unknown) => async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }),
    }),
  }),
}))

import { BAND_MEDIA_GONE, BAND_MEDIA_NOT_YOURS, MAX_BAND_MEDIA } from '../lib/band-media'
import { listBandMedia, pickBandMedia, removeBandMedia } from './band-media'
import { bandMediaSource, storeBandMedia } from './band-media-store'
import { MediaUploadError, messageMediaAccess } from './message-media'

let sqlite: DatabaseSync
const people = {
  silje: { name: 'Silje', permissions: [] as string[], leadsPartIds: [] as string[] },
  styret: { name: 'Styret', permissions: ['board.manage', 'gifs.manage'], leadsPartIds: [] },
} as const
type Person = keyof typeof people
const meOf = (id: Person) => ({ id, ...people[id] }) as unknown as Me
const as = (id: Person | null) => {
  state.me = id ? meOf(id) : null
}

/** En liten, gyldig GIF-header (480×270) — nok for `sniffImage`. */
const gif = (marker = 0) => new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0xe0, 0x01, 0x0e, 0x01, marker, 0, 0]))
let tick = 0

beforeEach(() => {
  state.r2.clear()
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  sqlite.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('silje', 'Silje', 'silje@example.invalid', 1, 1), ('styret', 'Styret', 'styret@example.invalid', 1, 1);`)
  const prepare = (query: string) => {
    let values: unknown[] = []
    const statement = {
      bind(...args: unknown[]) {
        values = args
        return statement
      },
      async all() {
        return { results: sqlite.prepare(query).all(...(values as never[])) }
      },
      async raw() {
        const s = sqlite.prepare(query)
        s.setReturnArrays(true)
        return s.all(...(values as never[]))
      },
      async run() {
        return { meta: { changes: Number(sqlite.prepare(query).run(...(values as never[])).changes) } }
      },
    }
    return statement
  }
  state.db = drizzle({ prepare } as never)
  tick = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => ++tick)
  as('silje')
})
afterEach(() => {
  sqlite.close()
  vi.restoreAllMocks()
})

const draftRow = (id: string) =>
  sqlite.prepare('SELECT owner_id AS owner, target_id AS target, source, r2_key AS r2Key, title FROM message_media WHERE id = ?').get(id) as
    | { owner: string; target: string | null; source: string; r2Key: string; title: string | null }
    | undefined

describe('migrasjonen', () => {
  it('gir styret `gifs.manage` (systemrollen finnes fra 0008)', () => {
    const row = sqlite.prepare("SELECT 1 AS ok FROM role_permissions WHERE role_id = 'board' AND permission = 'gifs.manage'").get()
    expect(row).toEqual({ ok: 1 })
  })
})

describe('legge til i samlingen', () => {
  it('lagrer under en fersk nøkkel, med navnet ryddet', async () => {
    const item = await storeBandMedia(gif(), '  Galleri\t69 ', meOf('styret'))
    expect(item).toMatchObject({ title: 'Galleri 69', contentType: 'image/gif', width: 480, height: 270 })
    const source = await bandMediaSource(item.id)
    expect(source?.r2Key).toBe(`band-media/${item.id}.gif`)
    expect(state.r2.get(source!.r2Key)?.contentType).toBe('image/gif')
  })

  it('krever navn, og avviser det som ikke er et bilde — uten å skrive til R2', async () => {
    await expect(storeBandMedia(gif(), '   ', meOf('styret'))).rejects.toThrow(MediaUploadError)
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    await expect(storeBandMedia(html, 'Meme', meOf('styret'))).rejects.toThrow(/Bare bilder/)
    expect(state.r2.size).toBe(0)
  })

  it('har et tak', async () => {
    const insert = sqlite.prepare('INSERT INTO band_media (id, r2_key, title, content_type, size, width, height, created_at) VALUES (?, ?, ?, ?, 1, 1, 1, 1)')
    for (let i = 0; i < MAX_BAND_MEDIA; i++) insert.run(`x${i}`, `band-media/x${i}.gif`, `GIF ${i}`, 'image/gif')
    await expect(storeBandMedia(gif(), 'En til', meOf('styret'))).rejects.toThrow(/full/)
  })
})

describe('Tertnes-fanen', () => {
  it('viser samlingen nyeste først for alle, med hvem som la dem til', async () => {
    const first = await storeBandMedia(gif(1), 'Første', meOf('styret'))
    const second = await storeBandMedia(gif(2), 'Andre', meOf('silje'))
    as('silje')
    expect(await listBandMedia()).toEqual({
      items: [
        expect.objectContaining({ id: second.id, mine: true, addedByName: 'Silje' }),
        expect.objectContaining({ id: first.id, mine: false, addedByName: 'Styret' }),
      ],
      canModerate: false,
    })
    as('styret')
    const forBoard = await listBandMedia()
    expect(forBoard.canModerate).toBe(true)
    expect(forBoard.items.map((i) => i.mine)).toEqual([false, true])
    // R2-nøkkelen og bruker-id-en sendes aldri.
    expect(Object.keys(forBoard.items[0]).sort()).toEqual(['addedByName', 'contentType', 'height', 'id', 'mine', 'title', 'width'])
    as(null)
    await expect(listBandMedia()).rejects.toThrow(/innlogging/)
  })

  it('alle kan fjerne sine egne, men ikke andres', async () => {
    const mine = await storeBandMedia(gif(1), 'Min', meOf('silje'))
    const theirs = await storeBandMedia(gif(2), 'Styrets', meOf('styret'))
    as('silje')
    await expect(removeBandMedia({ data: { id: theirs.id } })).rejects.toThrow(BAND_MEDIA_NOT_YOURS)
    expect(await bandMediaSource(theirs.id)).not.toBeNull()
    expect(state.r2.has(`band-media/${theirs.id}.gif`)).toBe(true)
    expect(await removeBandMedia({ data: { id: mine.id } })).toEqual({ removed: true })
    expect(await bandMediaSource(mine.id)).toBeNull()
    expect(state.r2.has(`band-media/${mine.id}.gif`)).toBe(false)
  })

  it('en GIF uten eier (medlemmet er slettet) kan bare fjernes med gifs.manage', async () => {
    const orphan = await storeBandMedia(gif(3), 'Gammel', meOf('styret'))
    sqlite.prepare('UPDATE band_media SET added_by = NULL WHERE id = ?').run(orphan.id)
    as('silje')
    expect((await listBandMedia()).items[0]).toMatchObject({ mine: false, addedByName: null })
    await expect(removeBandMedia({ data: { id: orphan.id } })).rejects.toThrow(BAND_MEDIA_NOT_YOURS)
    as('styret')
    expect(await removeBandMedia({ data: { id: orphan.id } })).toEqual({ removed: true })
  })

  it('et valg blir en egen kopi som utkast hos den som valgte, med navnet som alt-tekst', async () => {
    const band = await storeBandMedia(gif(7), 'Galleri 69', meOf('styret'))
    as('silje')
    const picked = await pickBandMedia({ data: { id: band.id } })
    expect(picked).toMatchObject({ contentType: 'image/gif', width: 480, height: 270, title: 'Galleri 69' })
    const row = draftRow(picked.id)!
    expect(row).toMatchObject({ owner: 'silje', target: null, source: 'upload', title: 'Galleri 69' })
    expect(row.r2Key).toBe(`message-media/${picked.id}.gif`)
    expect(state.r2.get(row.r2Key)?.bytes).toEqual(gif(7))
    // Et utkast er bare eierens, som en vanlig opplasting.
    expect(await messageMediaAccess(picked.id, meOf('silje'))).toBeTruthy()
    expect(await messageMediaAccess(picked.id, meOf('styret'))).toBeNull()
  })

  it('gifs.manage kan fjerne andres; kopiene i meldingene blir stående', async () => {
    const band = await storeBandMedia(gif(), 'Galleri 69', meOf('silje'))
    const picked = await pickBandMedia({ data: { id: band.id } })

    as('styret')
    expect(await removeBandMedia({ data: { id: band.id } })).toEqual({ removed: true })
    expect(await bandMediaSource(band.id)).toBeNull()
    expect(state.r2.has(`band-media/${band.id}.gif`)).toBe(false)
    expect(state.r2.has(draftRow(picked.id)!.r2Key)).toBe(true)
    expect(await removeBandMedia({ data: { id: band.id } })).toEqual({ removed: false })

    as('silje')
    await expect(pickBandMedia({ data: { id: band.id } })).rejects.toThrow(BAND_MEDIA_GONE)
  })
})
