import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from './access'

/**
 * Svar på svar i kommentarene på veggen, mot ekte SQLite med ALLE migrasjoner
 * (også 0029). Det som skal bevises er vanskelig å se ved lesing: hvor et svar
 * havner, at et rått kall ikke kan henge et svar inn under et annet innlegg, at
 * sletting aldri tar med seg andres tekst, og hvem som får push.
 */

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  user: null as Me | null,
  pushes: [] as Array<{ to: string[]; title: string; url: string }>,
}))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({ env: { BETTER_AUTH_URL: 'https://intern.example.invalid' } }))
vi.mock('./access', () => ({
  currentUser: async () => state.user,
  requireMe: async () => { if (!state.user) throw new Error('Krever innlogging'); return state.user },
  hasPermission: (me: Me | null, permission: string) => !!me && (me.permissions.includes('*') || me.permissions.includes(permission)),
}))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (fn: () => unknown) => fn,
  validator: (schema: { parse: (data: unknown) => unknown }) => ({ handler: (fn: (args: { data: unknown }) => unknown) =>
    async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }) }),
}) }))
vi.mock('./email', () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
  postEmail: vi.fn(),
  mentionEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
  postMentionEmail: vi.fn(),
}))
vi.mock('./push-send', () => ({
  sendPushToUsers: async (to: string[], message: { title: string; url: string }) => {
    state.pushes.push({ to: [...to].sort(), title: message.title, url: message.url })
    return { sent: to.length, failed: 0, removed: 0 }
  },
  unreadCountsFor: async () => new Map(),
}))
import { addComment, deleteComment, getPost, listPosts } from './posts'

let sqlite: DatabaseSync
const people = { silje: 'Silje', jonas: 'Jonas', karim: 'Karim', styret: 'Styret' } as const
type Person = keyof typeof people
const as = (id: Person) => {
  state.user = { id, name: people[id], permissions: id === 'styret' ? ['posts.publish'] : [] } as unknown as Me
}

beforeEach(() => {
  state.pushes = []
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  sqlite.exec(`INSERT OR IGNORE INTO roles (id, name) VALUES ('member', 'Musiker'), ('board', 'Styremedlem');
    INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('board', 'posts.publish');
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('silje', 'Silje', 'silje@example.invalid', 1, 1), ('jonas', 'Jonas', 'jonas@example.invalid', 1, 1),
      ('karim', 'Karim', 'karim@example.invalid', 1, 1), ('styret', 'Styret', 'styret@example.invalid', 1, 1);
    INSERT INTO member_profiles (auth_user_id, role_id, is_active, created_at) VALUES
      ('silje', 'member', 1, 1), ('jonas', 'member', 1, 1), ('karim', 'member', 1, 1), ('styret', 'board', 1, 1);
    INSERT INTO posts (id, title, body, author_id, published_at, created_at, updated_at) VALUES
      ('post', 'Notestativet', 'Noen som har sett det?', 'styret', 1, 1, 1),
      ('other', 'Annet', 'Tekst', 'styret', 1, 1, 1);`)
  const proxy = drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query)
    if (method === 'run') { statement.run(...params as SQLInputValue[]); return { rows: [] } }
    return { rows: statement.all(...params as SQLInputValue[]).map((row) => Object.values(row)) }
  })
  state.db = Object.assign(proxy, { run: async (query: SQL) => {
    const compiled = new SQLiteSyncDialect().sqlToQuery(query)
    const result = sqlite.prepare(compiled.sql).run(...compiled.params as SQLInputValue[])
    return { meta: { changes: Number(result.changes) } }
  } })
  let tick = 1_800_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => ++tick)
  as('silje')
})
afterEach(() => { sqlite.close(); vi.restoreAllMocks() })

// Hver kommentar får sitt eget millisekund: kommentarene sorteres på tid (og id
// ved likt tidspunkt), og tre kommentarer i samme millisekund ga tilfeldig rekkefølge.
const comment = async (body: string, replyToId?: string, postId = 'post') => {
  await new Promise((resolve) => setTimeout(resolve, 2))
  return addComment({ data: { postId, body, replyToId } })
}
const row = (id: string) => sqlite.prepare('SELECT parent_id, reply_to_id, author_id, body, deleted_at IS NOT NULL AS deleted FROM post_comments WHERE id = ?').get(id)
const ids = () => (sqlite.prepare('SELECT id FROM post_comments ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id)

describe('svar på kommentarer', () => {
  it('legger svar under kommentaren, og svar på svar under SAMME toppkommentar', async () => {
    const root = await comment('Jeg har det!')
    as('jonas'); const child = await comment('Takk!', root.id)
    as('karim'); const grandchild = await comment('Jeg òg takker', child.id)
    expect(row(root.id)).toMatchObject({ parent_id: null, reply_to_id: null })
    expect(row(child.id)).toMatchObject({ parent_id: root.id, reply_to_id: root.id })
    expect(row(grandchild.id)).toMatchObject({ parent_id: root.id, reply_to_id: child.id })
    const { comments } = await getPost({ data: { id: 'post' } })
    expect(comments.map((c) => [c.body, c.parentId, c.replyToId, c.deleted])).toEqual([
      ['Jeg har det!', null, null, false],
      ['Takk!', root.id, root.id, false],
      ['Jeg òg takker', root.id, child.id, false],
    ])
  })

  it('avviser et svar på en kommentar under et annet innlegg eller en som ikke finnes', async () => {
    const foreign = await comment('Der borte', undefined, 'other')
    await expect(comment('Hit', foreign.id)).rejects.toThrow('Kommentaren du svarer på er slettet')
    await expect(comment('Hit', 'missing')).rejects.toThrow('Kommentaren du svarer på er slettet')
    // Et rått `parentId` strippes av valideringen.
    const own = await addComment({ data: { postId: 'post', body: 'Rot', parentId: foreign.id } as never })
    expect(row(own.id)).toMatchObject({ parent_id: null, reply_to_id: null })
  })

  it('sletter en kommentar uten svar helt', async () => {
    const lone = await comment('Ensom')
    await deleteComment({ data: { id: lone.id } })
    expect(ids()).toEqual([])
  })

  it('gjør en kommentar med svar til et merke — teksten, forfatteren og omtalene går, svarene står', async () => {
    const root = await comment('Hemmelig @[u:karim]')
    as('jonas'); const child = await comment('Svar', root.id)
    as('silje'); await deleteComment({ data: { id: root.id } })
    expect(row(root.id)).toEqual({ parent_id: null, reply_to_id: null, author_id: null, body: '', deleted: 1 })
    expect(sqlite.prepare('SELECT count(*) AS n FROM post_comment_mentions WHERE comment_id = ?').get(root.id)).toEqual({ n: 0 })
    expect(row(child.id)).toMatchObject({ parent_id: root.id, body: 'Svar' })
    const detail = await getPost({ data: { id: 'post' } })
    expect(detail.comments.find((c) => c.id === root.id)).toMatchObject({ deleted: true, body: '', canDelete: false, mentions: [] })
    // Et merke er ikke en kommentar: tellerne og feeden teller bare svaret.
    expect(detail.post.commentCount).toBe(1)
    expect((await listPosts()).posts.find((p) => p.id === 'post')?.commentCount).toBe(1)
    // Et merke kan verken få nye svar eller slettes på nytt.
    await expect(comment('Til merket', root.id)).rejects.toThrow('slettet')
    as('styret'); await expect(deleteComment({ data: { id: root.id } })).rejects.toThrow('Fant ikke kommentaren')
  })

  it('beholder et svar som noen har svart på, og rydder merkene når det siste svaret går', async () => {
    const root = await comment('Rot')
    as('jonas'); const a = await comment('A', root.id)
    as('karim'); const b = await comment('Svar til A', a.id)
    // A har et svar (B) som peker på den, så A blir et merke selv om den ikke er en rot.
    as('jonas'); await deleteComment({ data: { id: a.id } })
    expect(row(a.id)).toMatchObject({ deleted: 1, body: '' })
    as('silje'); await deleteComment({ data: { id: root.id } })
    expect(row(root.id)).toMatchObject({ deleted: 1 })
    // Når B forsvinner, står merkene uten noe å holde sammen — begge ryddes.
    as('karim'); await deleteComment({ data: { id: b.id } })
    expect(ids()).toEqual([])
  })

  it('lar moderatoren slette, men bare eieren eller moderatoren', async () => {
    const root = await comment('Rot')
    as('jonas'); await expect(deleteComment({ data: { id: root.id } })).rejects.toThrow('egne kommentarer')
    as('styret'); await deleteComment({ data: { id: root.id } })
    expect(ids()).toEqual([])
  })
})

describe('push om svar', () => {
  it('varsler den man svarte på og lenker rett til svaret', async () => {
    const root = await comment('Jeg har det!')
    as('jonas'); const child = await comment('Takk!', root.id)
    expect(state.pushes).toEqual([{ to: ['silje'], title: 'Jonas svarte på kommentaren din', url: `/beskjeder/post#kommentar-${child.id}` }])
    // Svar på svaret varsler Jonas, ikke Silje (som bare følger med i tråden).
    state.pushes = []
    as('karim'); await comment('Enig', child.id)
    expect(state.pushes.map((p) => p.to)).toEqual([['jonas']])
  })

  it('aldri til deg selv, aldri i tillegg til en omtale, og ikke når omtaler er slått av', async () => {
    const root = await comment('Rot')
    await comment('Svarer meg selv', root.id)
    expect(state.pushes).toEqual([])
    as('jonas'); await comment('@[u:silje] takk', root.id)
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['silje'], title: 'Jonas nevnte deg i en kommentar' })])
    state.pushes = []
    sqlite.exec("INSERT INTO notification_preferences (user_id, mentions) VALUES ('silje', 'off')")
    await comment('Igjen', root.id)
    expect(state.pushes).toEqual([])
  })

  it('ikke til et deaktivert medlem', async () => {
    const root = await comment('Rot')
    sqlite.exec("UPDATE member_profiles SET is_active = 0 WHERE auth_user_id = 'silje'")
    as('jonas'); await comment('Svar', root.id)
    expect(state.pushes).toEqual([])
  })
})
