import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Me } from './access'

const state = vi.hoisted(() => ({ db: undefined as unknown, user: null as Me | null, put: vi.fn(), get: vi.fn(), remove: vi.fn() }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({ env: { FILES: { put: state.put, get: state.get, delete: state.remove } } }))
vi.mock('./access', () => ({
  currentUser: async () => state.user,
  requireMe: async () => { if (!state.user) throw new Error('Krever innlogging'); return state.user },
  hasPermission: (me: Me | null, permission: string) => !!me && (me.permissions.includes('*') || me.permissions.includes(permission)),
}))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (fn: () => unknown) => fn,
  validator: (schema: { parse: (data: unknown) => unknown }) => ({ handler: (fn: (args: { data: unknown }) => unknown) =>
    async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }) }),
}) }))
vi.mock('./email', () => ({ sendEmail: vi.fn(), postEmail: vi.fn(), mentionEmail: vi.fn(), postMentionEmail: vi.fn() }))
import { Route as uploadRoute } from '../routes/api/post-attachments/upload'
import { Route as downloadRoute } from '../routes/api/post-attachments/$attachmentId'
import { deletePostAttachment } from './post-attachments'
import { deletePost, getPost } from './posts'
import { MAX_POST_ATTACHMENT_BYTES } from '../lib/post-attachments'

let sqlite: DatabaseSync
const member = { id: 'member', permissions: [] } as unknown as Me
const board = { id: 'board', permissions: ['posts.publish'] } as unknown as Me
const upload = (uploadRoute as unknown as { options: { server: { handlers: { PUT: (args: { request: Request }) => Promise<Response> } } } }).options.server.handlers.PUT
const download = (downloadRoute as unknown as { options: { server: { handlers: { GET: (args: { params: { attachmentId: string } }) => Promise<Response> } } } }).options.server.handlers.GET

beforeEach(() => {
  vi.resetAllMocks()
  state.user = board
  state.get.mockResolvedValue({ body: 'document', size: 8 })
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  sqlite.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('member', 'Medlem', 'member@example.invalid', 1, 1), ('board', 'Styret', 'board@example.invalid', 1, 1);
    INSERT INTO posts (id, title, body, author_id, published_at, created_at, updated_at) VALUES ('post', 'Beskjed', 'Tekst', 'board', 1, 1, 1), ('own', 'Eget innlegg', 'Tekst', 'member', NULL, 1, 1);`)
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
})
afterEach(() => sqlite.close())

function request(postId = 'post', fileName = 'Budsjett.xlsx', body: BodyInit = 'document') {
  return new Request(`https://intern.example.invalid/api/post-attachments/upload?${new URLSearchParams({ postId, fileName })}`, { method: 'PUT', body })
}
async function attach(postId = 'post') {
  const response = await upload({ request: request(postId) })
  expect(response.status).toBe(200)
  return await response.json() as { id: string; fileName: string; size: number }
}
function count() { return Number(sqlite.prepare('SELECT count(*) AS n FROM post_attachments').get()!.n) }

it('krever innlogging og posts.publish, også på eget innlegg', async () => {
  state.user = null
  expect((await upload({ request: request() })).status).toBe(401)
  expect((await download({ params: { attachmentId: 'unknown' } })).status).toBe(401)
  state.user = member
  expect((await upload({ request: request('own') })).status).toBe(403)
  expect((await upload({ request: request() })).status).toBe(403)
  expect(state.put).not.toHaveBeenCalled()
  expect(count()).toBe(0)
})

it('medlemmer kan laste ned publiserte vedlegg; HTML tvinges til privat nedlasting', async () => {
  const response = await upload({ request: request('post', '../Møte\r\n.html', '<script>bad()</script>') })
  const file = await response.json() as { id: string; fileName: string }
  expect(file.fileName).toBe('Møte.html')
  const key = state.put.mock.calls[0][0] as string
  expect(key).toBe(`post-attachments/${file.id}`)
  expect(key).not.toContain('Møte')
  state.user = member
  const result = await download({ params: { attachmentId: file.id } })
  expect(result.status).toBe(200)
  expect(result.headers.get('content-type')).toBe('application/octet-stream')
  expect(result.headers.get('content-disposition')).toContain('attachment;')
  expect(result.headers.get('content-disposition')).toContain('M%C3%B8te.html')
  expect(result.headers.get('cache-control')).toBe('private, no-store')
  expect(result.headers.get('x-content-type-options')).toBe('nosniff')
})

it('nedlasting følger utkast, målgruppe og avpublisering også for direkte lenker', async () => {
  const file = await attach()
  state.user = member
  sqlite.exec("UPDATE posts SET audience = 'board' WHERE id = 'post'")
  expect((await download({ params: { attachmentId: file.id } })).status).toBe(404)
  await expect(getPost({ data: { id: 'post' } })).rejects.toThrow('Fant ikke beskjeden')
  sqlite.exec("UPDATE posts SET audience = 'all', published_at = NULL WHERE id = 'post'")
  expect((await download({ params: { attachmentId: file.id } })).status).toBe(404)
  expect(state.get).not.toHaveBeenCalled()
  state.user = board
  expect((await download({ params: { attachmentId: file.id } })).status).toBe(200)
  state.user = { ...member, id: 'board' }
  expect((await download({ params: { attachmentId: file.id } })).status).toBe(200)
})

it('detaljvisningen inneholder vedlegg uten å eksponere R2-nøkler', async () => {
  const file = await attach()
  state.user = member
  const result = await getPost({ data: { id: 'post' } })
  expect(result.attachments).toEqual([{ id: file.id, fileName: 'Budsjett.xlsx', size: 8 }])
})

it('avviser tomme og for store filer selv om Content-Length lyver', async () => {
  expect((await upload({ request: request('post', 'tom', '') })).status).toBe(400)
  const tooLarge = request('post', 'stor', new Uint8Array(MAX_POST_ATTACHMENT_BYTES + 1))
  tooLarge.headers.set('content-length', '1')
  expect((await upload({ request: tooLarge })).status).toBe(400)
  expect(state.put).not.toHaveBeenCalled()
})

it('håndhever antallsgrensen atomisk og rydder R2 ved avvist opplasting', async () => {
  for (let i = 0; i < 9; i++) await attach()
  const results = await Promise.all([upload({ request: request() }), upload({ request: request() })])
  expect(results.map((r) => r.status).sort()).toEqual([200, 400])
  expect(count()).toBe(10)
  expect(state.remove).toHaveBeenCalledTimes(1)
  expect(sqlite.prepare('SELECT id FROM post_attachments WHERE r2_key = ?').get(state.remove.mock.calls[0][0])).toBeUndefined()
})

it('rydder det opplastede objektet hvis beskjeden forsvinner før metadata lagres', async () => {
  state.put.mockImplementationOnce(() => { sqlite.exec("DELETE FROM posts WHERE id = 'post'") })
  await expect(upload({ request: request() })).rejects.toThrow()
  expect(state.remove).toHaveBeenCalledWith(state.put.mock.calls[0][0])
  expect(count()).toBe(0)
})

it('fjerning krever skriverett; R2-feil beholder raden', async () => {
  const file = await attach()
  state.user = member
  await expect(deletePostAttachment({ data: { id: file.id } })).rejects.toThrow('mangler tilgang')
  expect(count()).toBe(1)
  state.user = board
  state.remove.mockRejectedValueOnce(new Error('R2 utilgjengelig'))
  await expect(deletePostAttachment({ data: { id: file.id } })).rejects.toThrow('R2 utilgjengelig')
  expect(count()).toBe(1)
  await deletePostAttachment({ data: { id: file.id } })
  expect(count()).toBe(0)
})

it('sletting av hele beskjeden fjerner vedlegg og beholder metadata ved R2-feil', async () => {
  await attach()
  state.remove.mockRejectedValueOnce(new Error('R2 utilgjengelig'))
  await expect(deletePost({ data: { id: 'post' } })).rejects.toThrow('R2 utilgjengelig')
  expect(count()).toBe(1)
  expect(sqlite.prepare("SELECT id FROM posts WHERE id = 'post'").get()).toBeDefined()
  await deletePost({ data: { id: 'post' } })
  expect(count()).toBe(0)
  expect(sqlite.prepare("SELECT id FROM posts WHERE id = 'post'").get()).toBeUndefined()
})
