import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Me } from './access'

/**
 * Bilder og GIF-er i samtalene, mot ekte SQLite med ALLE migrasjoner (også
 * 0030) og Drizzles D1-driver. Det som skal bevises, er det som er vanskelig å
 * se ved lesing: at gaten følger regelen til det bildet står i, at et utkast
 * bare er eierens, at et bilde aldri kan sendes to ganger, og at slettede
 * meldinger og aldri sendte utkast faktisk forsvinner fra R2.
 */

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  me: null as Me | null,
  r2: new Map<string, { bytes: Uint8Array; contentType?: string }>(),
}))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({
  env: {
    BETTER_AUTH_URL: 'https://intern.example.invalid',
    BETTER_AUTH_SECRET: 'test-hemmelighet',
    FILES: {
      put: async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        state.r2.set(key, { bytes, contentType: opts?.httpMetadata?.contentType })
      },
      // R2 tar én nøkkel eller en liste.
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
vi.mock('./email', () => ({ sendEmail: vi.fn(async () => ({ ok: true })), postEmail: vi.fn(), mentionEmail: vi.fn(), postMentionEmail: vi.fn() }))
vi.mock('./push-send', () => ({ sendPushToUsers: async () => ({ sent: 0, failed: 0, removed: 0 }), unreadCountsFor: async () => new Map() }))

import { env } from 'cloudflare:workers'
import * as board from './board'
import * as leaders from './gruppeledere'
import { addKlipyMedia, getKlipyConfig } from './klipy'
import { MEDIA_CLAIM_FAILED, discardPendingMedia, messageMediaAccess, storeMessageMedia, sweepMessageMedia } from './message-media'
import { addComment, deleteComment, deletePost, getPost, listPosts, toggleReaction } from './posts'
import { sweepReactions } from './reaction-store'
import { listReactionPeople, toggleEmojiReaction } from './reactions'

let sqlite: DatabaseSync
const people = {
  silje: { name: 'Silje', permissions: [] as string[], leadsPartIds: [] as string[] },
  styret: { name: 'Styret', permissions: ['board.manage', 'posts.publish'], leadsPartIds: [] },
  leder: { name: 'Ingrid', permissions: ['members.manage.section'], leadsPartIds: ['cornet-solo'] },
} as const
type Person = keyof typeof people
const as = (id: Person | null) => {
  state.me = id ? ({ id, ...people[id] } as unknown as Me) : null
}
const meOf = (id: Person) => ({ id, ...people[id] }) as unknown as Me

const GIF = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0xe0, 0x01, 0x0e, 0x01, 0, 0, 0]))
let tick = 0

/** Et opplastet utkast, laget gjennom samme vei som opplastingsruta. */
const upload = async (owner: Person) => (await storeMessageMedia(GIF, meOf(owner))).id
const row = (id: string) =>
  sqlite.prepare('SELECT target_kind AS kind, target_id AS target, r2_key AS r2Key FROM message_media WHERE id = ?').get(id) as
    | { kind: string | null; target: string | null; r2Key: string }
    | undefined
const canSee = async (mediaId: string, who: Person) => !!(await messageMediaAccess(mediaId, meOf(who)))

beforeEach(() => {
  state.r2.clear()
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  sqlite.exec(`INSERT OR IGNORE INTO roles (id, name) VALUES ('member', 'Musiker'), ('board', 'Styremedlem');
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('silje', 'Silje', 'silje@example.invalid', 1, 1), ('styret', 'Styret', 'styret@example.invalid', 1, 1),
      ('leder', 'Ingrid', 'leder@example.invalid', 1, 1);
    INSERT INTO member_profiles (auth_user_id, role_id, is_active, created_at) VALUES
      ('silje', 'member', 1, 1), ('styret', 'board', 1, 1), ('leder', 'member', 1, 1);
    INSERT INTO posts (id, title, body, author_id, audience, published_at, created_at, updated_at) VALUES
      ('open', 'Til alle', 'Tekst', 'styret', 'all', 1, 1, 1),
      ('board-only', 'Bare styret', 'Tekst', 'styret', 'board', 1, 1, 1);`)
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
  // Klokka starter på ekte tid: serverkoden bruker både `Date.now()` og `new Date()`.
  tick = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => ++tick)
  as('silje')
})
afterEach(() => {
  sqlite.close()
  vi.restoreAllMocks()
})

describe('opplasting', () => {
  it('lagrer typen og størrelsen bytene sier, under en fersk nøkkel', async () => {
    const item = await storeMessageMedia(GIF, meOf('silje'))
    expect(item).toMatchObject({ contentType: 'image/gif', width: 480, height: 270 })
    const stored = row(item.id)!
    expect(stored).toMatchObject({ kind: null, target: null, r2Key: `message-media/${item.id}.gif` })
    expect(state.r2.get(stored.r2Key)?.contentType).toBe('image/gif')
  })

  it('avviser en fil som bare later som den er et bilde', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    await expect(storeMessageMedia(html, meOf('silje'))).rejects.toThrow('Bare bilder')
    expect(state.r2.size).toBe(0)
  })

  it('setter et tak på utkast som ikke er sendt', async () => {
    for (let i = 0; i < 12; i++) await upload('silje')
    await expect(upload('silje')).rejects.toThrow('for mange bilder')
    // Taket er per medlem.
    await expect(upload('styret')).resolves.toBeTruthy()
  })

  it('gir plass ved å fjerne egne forlatte utkast, så ingen låses ute i et døgn', async () => {
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push(await upload('silje'))
    // To av dem ble lagt igjen for over en time siden (siden ble lastet på nytt).
    sqlite.prepare('UPDATE message_media SET created_at = ? WHERE id IN (?, ?)').run(tick - 2 * 3600_000, ids[3]!, ids[7]!)
    const fresh = await upload('silje')
    expect(row(fresh)).toBeDefined()
    expect(row(ids[3]!)).toBeUndefined()
    expect(row(ids[7]!)).toBeUndefined()
    expect(row(ids[0]!)).toBeDefined()
  })
})

describe('gaten', () => {
  it('et bilde som er sendt, kan ikke fjernes som utkast (dobbelt «Avbryt», sen sletting)', async () => {
    const id = await upload('silje')
    await addComment({ data: { postId: 'open', body: '', mediaIds: [id] } })
    expect(await discardPendingMedia(id, 'silje')).toBe(false)
    expect(row(id)).toMatchObject({ kind: 'post_comment' })
    expect(state.r2.has(row(id)!.r2Key)).toBe(true)
  })

  it('et utkast er bare eierens, og bare eieren kan fjerne det', async () => {
    const id = await upload('silje')
    expect(await canSee(id, 'silje')).toBe(true)
    expect(await canSee(id, 'styret')).toBe(false)
    expect(await discardPendingMedia(id, 'styret')).toBe(false)
    expect(await discardPendingMedia(id, 'silje')).toBe(true)
    expect(row(id)).toBeUndefined()
    expect(state.r2.size).toBe(0)
  })

  it('et bilde i en kommentar følger innleggets målgruppe, og går med kommentaren', async () => {
    as('styret')
    const open = await upload('styret')
    const hidden = await upload('styret')
    const a = await addComment({ data: { postId: 'open', body: '', mediaIds: [open] } })
    await addComment({ data: { postId: 'board-only', body: 'Se', mediaIds: [hidden] } })
    expect(await canSee(open, 'silje')).toBe(true)
    expect(await canSee(hidden, 'silje')).toBe(false)
    expect(await canSee(hidden, 'styret')).toBe(true)

    // Avpublisert innlegg: bildene i kommentarene forsvinner med det.
    sqlite.exec(`UPDATE posts SET published_at = NULL WHERE id = 'open'`)
    expect(await canSee(open, 'silje')).toBe(false)
    sqlite.exec(`UPDATE posts SET published_at = 1 WHERE id = 'open'`)

    await deleteComment({ data: { id: a.id } })
    expect(row(open)).toBeUndefined()
    expect([...state.r2.keys()]).toEqual([row(hidden)!.r2Key])
  })

  it('et «slettet»-merke har ingen bilder, selv om noen har svart på kommentaren', async () => {
    const gif = await upload('silje')
    const root = await addComment({ data: { postId: 'open', body: 'Haha', mediaIds: [gif] } })
    as('styret')
    await addComment({ data: { postId: 'open', body: 'Svar', replyToId: root.id } })
    as('silje')
    await deleteComment({ data: { id: root.id } })
    expect(row(gif)).toBeUndefined()
    const comments = (await getPost({ data: { id: 'open' } })).comments
    expect(comments.find((c) => c.id === root.id)).toMatchObject({ deleted: true, media: [] })
  })

  it('styrechatten krever board.manage, lederchatten en leiarbinding', async () => {
    as('styret')
    const boardGif = await upload('styret')
    const sent = await board.postMessage({ data: { channel: 'general', body: '', mediaIds: [boardGif] } })
    expect(await canSee(boardGif, 'styret')).toBe(true)
    expect(await canSee(boardGif, 'silje')).toBe(false)
    expect(await canSee(boardGif, 'leder')).toBe(false)

    as('leder')
    const leaderGif = await upload('leder')
    await leaders.postMessage({ data: { channel: 'general', body: 'Fredag!', mediaIds: [leaderGif] } })
    expect(await canSee(leaderGif, 'leder')).toBe(true)
    // En admin uten leiarbinding kommer ikke inn i lederchatten — heller ikke til bildene.
    expect(await canSee(leaderGif, 'styret')).toBe(false)

    as('styret')
    await board.deleteMessage({ data: { id: sent.id } })
    expect(row(boardGif)).toBeUndefined()
    expect(await canSee(boardGif, 'styret')).toBe(false)
  })
})

describe('sending', () => {
  it('en melding kan være bare en GIF, og et svar på den sier «GIF»', async () => {
    as('styret')
    const gif = await upload('styret')
    const original = await board.postMessage({ data: { channel: 'general', body: '', mediaIds: [gif] } })
    const reply = await board.postMessage({ data: { channel: 'general', body: 'Haha', replyToId: original.id } })
    const { messages } = await board.listMessages({ data: { channel: 'general' } })
    const byId = (id: string) => messages.find((m) => m.id === id)
    expect(byId(original.id)).toMatchObject({ body: '', media: [{ id: gif, contentType: 'image/gif', width: 480, height: 270 }] })
    expect(byId(reply.id)).toMatchObject({ body: 'Haha', media: [], replyTo: { deleted: false, excerpt: 'GIF' } })
  })

  it('verken tom melding, andres utkast eller samme utkast to ganger', async () => {
    as('styret')
    const theirs = await upload('silje')
    await expect(board.postMessage({ data: { channel: 'general', body: 'Se', mediaIds: [theirs] } })).rejects.toThrow(MEDIA_CLAIM_FAILED)
    expect(row(theirs)).toMatchObject({ kind: null, target: null })

    const mine = await upload('styret')
    const also = await upload('styret')
    await board.postMessage({ data: { channel: 'general', body: '', mediaIds: [mine] } })
    // Et nytt forsøk med ett allerede sendt bilde feiler helt, og slipper det andre igjen.
    await expect(board.postMessage({ data: { channel: 'general', body: '', mediaIds: [also, mine] } })).rejects.toThrow(MEDIA_CLAIM_FAILED)
    expect(row(also)).toMatchObject({ kind: null, target: null })
    expect((await board.listMessages({ data: { channel: 'general' } })).messages).toHaveLength(1)
  })

  it('bildene står i rekkefølgen de ble lagt til', async () => {
    const ids = [await upload('silje'), await upload('silje'), await upload('silje')]
    const c = await addComment({ data: { postId: 'open', body: 'Tre', mediaIds: [ids[2]!, ids[0]!, ids[1]!] } })
    const comment = (await getPost({ data: { id: 'open' } })).comments.find((x) => x.id === c.id)!
    expect(comment.media.map((m) => m.id)).toEqual([ids[2], ids[0], ids[1]])
  })

  it('en tom melding uten bilde er en valideringsfeil (400 i mobil-API-et), ikke en serverfeil', async () => {
    await expect(addComment({ data: { postId: 'open', body: ' ' } })).rejects.toBeInstanceOf(z.ZodError)
    await expect(addComment({ data: { postId: 'open', body: ' ' } })).rejects.toThrow('Skriv noe eller legg til et bilde')
    as('styret')
    await expect(board.postMessage({ data: { channel: 'general', body: '  ' } })).rejects.toBeInstanceOf(z.ZodError)
    as('leder')
    await expect(leaders.postMessage({ data: { channel: 'general', body: '' } })).rejects.toBeInstanceOf(z.ZodError)
  })
})

describe('daglig rydding', () => {
  it('tar utkast eldre enn et døgn og bilder i rader som er borte, men ikke noe annet', async () => {
    const old = await upload('silje')
    const fresh = await upload('silje')
    const kept = await upload('silje')
    const orphan = await upload('silje')
    await addComment({ data: { postId: 'open', body: '', mediaIds: [kept] } })
    const gone = await addComment({ data: { postId: 'open', body: '', mediaIds: [orphan] } })
    // Kommentaren forsvinner uten å gå innom koden (cascade fra et slettet innlegg o.l.).
    sqlite.prepare('DELETE FROM post_comments WHERE id = ?').run(gone.id)
    const now = tick
    sqlite.prepare('UPDATE message_media SET created_at = ? WHERE id = ?').run(now - 25 * 3600_000, old)

    // Koblingen er fersk: ryddingen venter, i tilfelle raden bare ikke er skrevet ennå.
    expect(await sweepMessageMedia(now)).toBe(1)
    expect(row(old)).toBeUndefined()
    expect(row(orphan)).toBeDefined()

    expect(await sweepMessageMedia(now + 2 * 3600_000)).toBe(1)
    expect(row(orphan)).toBeUndefined()
    expect(row(fresh)).toBeDefined()
    expect(row(kept)).toBeDefined()
    expect(state.r2.size).toBe(2)
  })
})

const KLIPY_GIF = 'https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp'
const pick = (url = KLIPY_GIF) => addKlipyMedia({ data: { kind: 'gif', slug: 'hello-hi-662', title: 'Hello', url, width: 498, height: 498 } })

describe('GIF-velgeren (KLIPY)', () => {
  it('et valg blir et utkast med KLIPY-adressen, og gaten sender videre dit', async () => {
    const item = await pick()
    expect(item).toMatchObject({ contentType: 'image/webp', externalUrl: KLIPY_GIF, externalKind: 'gif', title: 'Hello', width: 498, height: 498 })
    expect(await messageMediaAccess(item.id, meOf('silje'))).toEqual({ source: 'klipy', externalUrl: KLIPY_GIF })
    expect(await messageMediaAccess(item.id, meOf('styret'))).toBeNull()
    const c = await addComment({ data: { postId: 'open', body: '', mediaIds: [item.id] } })
    const comment = (await getPost({ data: { id: 'open' } })).comments.find((x) => x.id === c.id)!
    expect(comment.media).toMatchObject([{ id: item.id, externalUrl: KLIPY_GIF, externalKind: 'gif' }])
    expect(await messageMediaAccess(item.id, meOf('styret'))).toEqual({ source: 'klipy', externalUrl: KLIPY_GIF })
    // Ingen bytes hos oss — sletting rører ikke R2.
    await deleteComment({ data: { id: c.id } })
    expect(row(item.id)).toBeUndefined()
  })

  it('godtar bare KLIPYs CDN — et rått kall kan ikke legge inn et sporingsbilde', async () => {
    for (const url of ['https://evil.example/pixel.gif', 'http://static.klipy.com/a.gif', 'https://static.klipy.com.evil.example/a.gif', 'https://static.klipy.com/a.mp4']) {
      await expect(pick(url), url).rejects.toBeInstanceOf(z.ZodError)
    }
    expect(sqlite.prepare('SELECT count(*) AS n FROM message_media').get()).toEqual({ n: 0 })
  })

  it('oppsettet: KLIPY-nøkkelen og et pseudonym som ikke er bruker-id-en', async () => {
    const devConfig = await getKlipyConfig()
    // Uten nøkkel i dev: den lokale etterligningen.
    expect(devConfig).toMatchObject({ appKey: 'dev', apiBase: '/api/dev-klipy' })
    ;(env as { KLIPY_API_KEY?: string }).KLIPY_API_KEY = 'nøkkel'
    try {
      const config = await getKlipyConfig()
      expect(config).toMatchObject({ appKey: 'nøkkel', apiBase: 'https://api.klipy.com' })
      expect(config!.customerId).toMatch(/^[0-9a-f]{32}$/)
      expect(config!.customerId).not.toContain('silje')
      expect((await getKlipyConfig())!.customerId).toBe(config!.customerId)
      as('styret')
      expect((await getKlipyConfig())!.customerId).not.toBe(config!.customerId)
    } finally {
      delete (env as { KLIPY_API_KEY?: string }).KLIPY_API_KEY
    }
  })
})

describe('reaksjoner', () => {
  const react = (kind: 'post' | 'post_comment' | 'forum_topic' | 'forum_reply', targetId: string, emoji: string) =>
    toggleEmojiReaction({ data: { kind, targetId, emoji } })

  it('på og av, flere emojier, og hvem som reagerte', async () => {
    expect((await react('post', 'open', '🎺')).reactions).toEqual([{ emoji: '🎺', count: 1, mine: true, names: ['Du'] }])
    as('styret')
    await react('post', 'open', '🎺')
    const both = (await react('post', 'open', '😂')).reactions
    expect(both).toEqual([
      { emoji: '🎺', count: 2, mine: true, names: ['Silje', 'Du'] },
      { emoji: '😂', count: 1, mine: true, names: ['Du'] },
    ])
    expect((await react('post', 'open', '🎺')).reactions[0]).toMatchObject({ emoji: '🎺', count: 1, mine: false })
    as('silje')
    const post = (await getPost({ data: { id: 'open' } })).post
    expect(post.reactions).toEqual([
      { emoji: '🎺', count: 1, mine: true, names: ['Du'] },
      { emoji: '😂', count: 1, mine: false, names: ['Styret'] },
    ])
  })

  it('bare emoji — aldri fritekst', async () => {
    for (const emoji of ['haha', '<img src=x>', '1', '👍 👍']) {
      await expect(react('post', 'open', emoji), emoji).rejects.toBeInstanceOf(z.ZodError)
    }
  })

  it('følger lesetilgangen: ikke på styreinnlegg for medlemmer, ikke på utkast eller slettede kommentarer', async () => {
    await expect(react('post', 'board-only', '👍')).rejects.toThrow('Fant ikke innholdet')
    await expect(react('post', 'finnes-ikke', '👍')).rejects.toThrow('Fant ikke innholdet')
    sqlite.exec(`INSERT INTO posts (id, title, body, author_id, audience, published_at, created_at, updated_at) VALUES ('draft', 'Utkast', 'x', 'styret', 'all', NULL, 1, 1)`)
    as('styret')
    await expect(react('post', 'draft', '👍')).rejects.toThrow('Fant ikke innholdet')
    expect((await react('post', 'board-only', '👍')).reactions).toHaveLength(1)
    as('silje')
    const c = await addComment({ data: { postId: 'open', body: 'Hei' } })
    as('styret')
    await addComment({ data: { postId: 'open', body: 'Svar', replyToId: c.id } })
    as('silje')
    await react('post_comment', c.id, '❤️')
    await deleteComment({ data: { id: c.id } })
    // Et «slettet»-merke har ingen reaksjoner, og får ingen nye.
    expect(sqlite.prepare("SELECT count(*) AS n FROM reactions WHERE target_kind = 'post_comment'").get()).toEqual({ n: 0 })
    await expect(react('post_comment', c.id, '❤️')).rejects.toThrow('Fant ikke innholdet')
  })

  it('«Hvem har reagert» viser alle, ikke bare de ti første — med samme tilgang som å reagere', async () => {
    const others = Array.from({ length: 11 }, (_, i) => `m${String(i).padStart(2, '0')}`)
    sqlite.exec(others.map((id, i) => `INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('${id}', 'Medlem ${i}', '${id}@example.invalid', 1, 1);
      INSERT INTO reactions (target_kind, target_id, user_id, emoji, created_at) VALUES ('post', 'open', '${id}', '👍', ${10 + i});`).join('\n'))
    await react('post', 'open', '👍')
    await react('post', 'open', '🎺')
    expect((await getPost({ data: { id: 'open' } })).post.reactions[0]).toMatchObject({ emoji: '👍', count: 12 })
    expect((await getPost({ data: { id: 'open' } })).post.reactions[0]!.names).toHaveLength(10)
    const { reactions } = await listReactionPeople({ data: { kind: 'post', targetId: 'open' } })
    expect(reactions.map((r) => [r.emoji, r.count, r.names.length])).toEqual([['👍', 12, 12], ['🎺', 1, 1]])
    expect(reactions[0]!.names.at(-1)).toBe('Du')
    await expect(listReactionPeople({ data: { kind: 'post', targetId: 'board-only' } })).rejects.toThrow('Fant ikke innholdet')
    as(null)
    await expect(listReactionPeople({ data: { kind: 'post', targetId: 'open' } })).rejects.toThrow()
  })

  it('i forumet for alle medlemmer', async () => {
    sqlite.exec(`INSERT INTO forum_topics (id, author_id, title, body, locked, created_at, updated_at, activity_at) VALUES ('t1', 'styret', 'Fest', 'Hvem kommer?', 0, 1, 1, 1);
      INSERT INTO forum_replies (id, topic_id, author_id, body, created_at, updated_at) VALUES ('r1', 't1', 'leder', 'Jeg!', 2, 2)`)
    expect((await react('forum_topic', 't1', '🎉')).reactions).toHaveLength(1)
    expect((await react('forum_reply', 'r1', '😂')).reactions).toHaveLength(1)
    await expect(react('forum_reply', 'r2', '😂')).rejects.toThrow('Fant ikke innholdet')
  })

  it('maks 20 ulike emojier, men man kan alltid bli med på en som finnes', async () => {
    const emojis = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x1f600 + i))
    for (const e of emojis) await react('post', 'open', e)
    await expect(react('post', 'open', '🎺')).rejects.toThrow('Maks 20')
    as('styret')
    expect((await react('post', 'open', emojis[5]!)).reactions.find((r) => r.emoji === emojis[5])).toMatchObject({ count: 2 })
  })

  it('mobilappens «like» (v1) er 👍, med samme svarform som før', async () => {
    expect(await toggleReaction({ data: { postId: 'open' } })).toEqual({ count: 1, mine: true })
    await react('post', 'open', '😂')
    const listed = (await listPosts()).posts.find((p) => p.id === 'open')!
    expect(listed).toMatchObject({ likeCount: 1, likedByMe: true })
    expect(listed.reactions.map((r) => r.emoji)).toEqual(['👍', '😂'])
    expect(await toggleReaction({ data: { postId: 'open' } })).toEqual({ count: 0, mine: false })
    // 👍 med et overflødig variantvalg er samme reaksjon — og samme like i appen.
    await react('post', 'open', '👍' + String.fromCodePoint(0xfe0f))
    expect((await listPosts()).posts.find((p) => p.id === 'open')).toMatchObject({ likeCount: 1, likedByMe: true })
  })

  it('likens vei i appen respekterer også taket på 20 ulike', async () => {
    for (let i = 0; i < 20; i++) await react('post', 'open', String.fromCodePoint(0x1f600 + i))
    await expect(toggleReaction({ data: { postId: 'open' } })).rejects.toThrow('Maks 20')
  })

  it('går med innlegget, og den daglige ryddingen tar det cascade lot ligge', async () => {
    const c = await addComment({ data: { postId: 'open', body: 'Hei' } })
    await react('post', 'open', '👍')
    await react('post_comment', c.id, '👍')
    as('styret')
    await deletePost({ data: { id: 'open' } })
    expect(sqlite.prepare('SELECT count(*) AS n FROM reactions').get()).toEqual({ n: 0 })
    // En reaksjon som ble stående (f.eks. fra en eldre kode-versjon) ryddes.
    sqlite.exec(`INSERT INTO reactions (target_kind, target_id, user_id, emoji, created_at) VALUES ('post', 'borte', 'silje', '👍', 1)`)
    await react('post', 'board-only', '👍')
    await sweepReactions()
    expect(sqlite.prepare('SELECT target_id AS id FROM reactions').all()).toEqual([{ id: 'board-only' }])
  })
})

describe('migrasjon 0031', () => {
  it('kopierer dagens «Liker» til 👍, så ingen mister et lik', () => {
    const db = new DatabaseSync(':memory:')
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
    for (const f of files.filter((f) => f < '0031')) db.exec(readFileSync(`migrations/${f}`, 'utf8'))
    db.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'A', 'a@x.invalid', 1, 1), ('b', 'B', 'b@x.invalid', 1, 1);
      INSERT INTO posts (id, title, body, author_id, published_at, created_at, updated_at) VALUES ('p', 'P', 'x', 'a', 1, 1, 1);
      INSERT INTO post_reactions (post_id, user_id, kind, created_at) VALUES ('p', 'a', 'like', 10), ('p', 'b', 'like', 20)`)
    for (const f of files.filter((f) => f >= '0031')) db.exec(readFileSync(`migrations/${f}`, 'utf8'))
    expect(db.prepare('SELECT target_kind, target_id, user_id, emoji, created_at FROM reactions ORDER BY created_at').all()).toEqual([
      { target_kind: 'post', target_id: 'p', user_id: 'a', emoji: '👍', created_at: 10 },
      { target_kind: 'post', target_id: 'p', user_id: 'b', emoji: '👍', created_at: 20 },
    ])
    db.close()
  })
})
