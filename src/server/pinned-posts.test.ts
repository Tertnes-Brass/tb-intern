import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from './access'
import { toOsloDate } from '../lib/format'
import { MAX_PINNED_POSTS, addDays, pinLimitMessage } from '../lib/pins'

/**
 * Festede innlegg mot ekte SQLite med ALLE migrasjoner (også 0032). Det som
 * skal bevises: bare `posts.publish` fester, taket sitter i selve UPDATE-en,
 * en utløpt festing teller ikke, og et utkast kan aldri stå øverst.
 */

const state = vi.hoisted(() => ({ db: undefined as unknown, user: null as Me | null }))
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
vi.mock('./email', () => ({ sendEmail: vi.fn(), postEmail: vi.fn(), mentionEmail: vi.fn(), postMentionEmail: vi.fn() }))
vi.mock('./push-send', () => ({ sendPushToUsers: vi.fn(), unreadCountsFor: async () => new Map() }))
import { listPosts, setPostPinned, unpublishPost } from './posts'

let sqlite: DatabaseSync
const as = (id: 'silje' | 'styret') => {
  state.user = { id, name: id, permissions: id === 'styret' ? ['posts.publish'] : [] } as unknown as Me
}
const today = () => toOsloDate(Date.now())
const pin = (id: string, until: string | null = null) => setPostPinned({ data: { id, pinned: true, until } })
const pinnedIds = async () => (await listPosts()).posts.filter((p) => p.pinned).map((p) => p.id).sort()
const pinRow = (id: string) => sqlite.prepare('SELECT pinned_at, pinned_until FROM posts WHERE id = ?').get(id) as { pinned_at: number | null; pinned_until: string | null }

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  const published = Array.from({ length: MAX_PINNED_POSTS + 2 }, (_, i) => `('p${i + 1}', 'Innlegg ${i + 1}', 'Tekst', 'styret', 1, 1, 1)`).join(', ')
  sqlite.exec(`INSERT OR IGNORE INTO roles (id, name) VALUES ('member', 'Musiker'), ('board', 'Styremedlem');
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('silje', 'Silje', 'silje@example.invalid', 1, 1), ('styret', 'Styret', 'styret@example.invalid', 1, 1);
    INSERT INTO member_profiles (auth_user_id, role_id, is_active, created_at) VALUES ('silje', 'member', 1, 1), ('styret', 'board', 1, 1);
    INSERT INTO posts (id, title, body, author_id, published_at, created_at, updated_at) VALUES ${published},
      ('draft', 'Utkast', 'Tekst', 'styret', NULL, 1, 1),
      ('mine', 'Siljes innlegg', 'Tekst', 'silje', 1, 1, 1);`)
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
  as('styret')
})
afterEach(() => { sqlite.close(); vi.restoreAllMocks() })

describe('festede innlegg', () => {
  it('bare posts.publish kan feste og løsne — heller ikke forfatteren selv', async () => {
    as('silje')
    await expect(pin('mine')).rejects.toThrow('Bare styret')
    as('styret'); await pin('mine')
    as('silje')
    await expect(setPostPinned({ data: { id: 'mine', pinned: false } })).rejects.toThrow('Bare styret')
    expect(await pinnedIds()).toEqual(['mine'])
    expect((await listPosts()).canPin).toBe(false)
  })

  it('festet til og med en dato, og løsnes', async () => {
    await pin('p1', addDays(today(), 3))
    const [post] = (await listPosts()).posts.filter((p) => p.pinned)
    expect(post).toMatchObject({ id: 'p1', pinnedUntil: addDays(today(), 3) })
    await setPostPinned({ data: { id: 'p1', pinned: false } })
    expect(pinRow('p1')).toEqual({ pinned_at: null, pinned_until: null })
    expect(await pinnedIds()).toEqual([])
  })

  it('taket sitter i serveren, men varigheten kan alltid endres', async () => {
    for (let i = 1; i <= MAX_PINNED_POSTS; i++) await pin(`p${i}`)
    await expect(pin(`p${MAX_PINNED_POSTS + 1}`)).rejects.toThrow(pinLimitMessage())
    const before = pinRow('p1').pinned_at
    await pin('p1', addDays(today(), 10))
    // Samme tidspunkt: å endre varigheten flytter det ikke til toppen av «Festet».
    expect(pinRow('p1')).toEqual({ pinned_at: before, pinned_until: addDays(today(), 10) })
    expect((await pinnedIds()).length).toBe(MAX_PINNED_POSTS)
  })

  it('en utløpt festing vises ikke og teller ikke mot taket', async () => {
    for (let i = 1; i <= MAX_PINNED_POSTS; i++) await pin(`p${i}`)
    sqlite.prepare("UPDATE posts SET pinned_until = ? WHERE id = 'p1'").run(addDays(today(), -1))
    expect(await pinnedIds()).not.toContain('p1')
    await pin(`p${MAX_PINNED_POSTS + 1}`)
    expect((await pinnedIds()).length).toBe(MAX_PINNED_POSTS)
  })

  it('avviser fortid og utkast, og avpublisering løsner', async () => {
    await expect(pin('p1', addDays(today(), -1))).rejects.toThrow('Datoen har allerede vært')
    await expect(pin('draft')).rejects.toThrow('Publiser innlegget')
    await pin('p2')
    await unpublishPost({ data: { id: 'p2' } })
    expect(pinRow('p2')).toEqual({ pinned_at: null, pinned_until: null })
  })
})
