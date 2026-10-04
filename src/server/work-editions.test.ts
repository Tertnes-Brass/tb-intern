import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../db'
import { workFiles } from '../db/schema'

const state = vi.hoisted(() => ({ db: undefined as unknown, permission: vi.fn(), r2Delete: vi.fn(), r2Get: vi.fn(), createMultipart: vi.fn(), resumeMultipart: vi.fn(), completeMultipart: vi.fn(), fullArchive: true, user: { id: 'member' } as { id: string } | null }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({ env: { FILES: { delete: state.r2Delete, get: state.r2Get, createMultipartUpload: state.createMultipart, resumeMultipartUpload: state.resumeMultipart }, BETTER_AUTH_SECRET: 'test-secret-not-for-production' } }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (fn: () => unknown) => fn,
  validator: (schema: { parse: (data: unknown) => unknown }) => ({ handler: (fn: (args: { data: unknown }) => unknown) =>
    async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }) }),
}) }))
vi.mock('./access', () => ({
  requirePermission: state.permission,
  requireMe: async () => ({ effectivePartIds: ['cornet'] }),
  hasFullArchiveAccess: () => state.fullArchive,
  currentUser: async () => state.user,
  hasPermission: () => true,
  memberFileAccessContext: (_me: unknown, inAccessibleProject: boolean) => ({ effectivePartIds: ['cornet'], sectionLeaderPartIds: [], canManageSection: false, canViewScore: true, canViewAll: state.fullArchive, inAccessibleProject }),
}))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }))
vi.mock('./file-access-log', () => ({ accessTypeForRequestUrl: () => 'view', logFileAccess: vi.fn() }))
import { Route as startRoute } from '../routes/api/upload/start'
import { Route as completeRoute } from '../routes/api/upload/complete'
import { Route as fileRoute } from '../routes/api/files/$fileId'
import { resolveEdition } from './work-editions-store'
import { createWorkEdition, deleteWork, getWork, listWorks, setCurrentWorkEdition, updateWorkEditionNotes } from './works'
import { addWorkToProject, assembleRepertoire, setProjectWorkEdition } from './projects'
import { getShareView } from './shares'
import { signUploadTicket, verifyUploadTicket } from './upload-token'

let sqlite: DatabaseSync
let d: Db
const access = { effectivePartIds: ['cornet'], sectionLeaderPartIds: [], canManageSection: false, canViewScore: true, canViewAll: true, inAccessibleProject: true }

beforeEach(() => {
  vi.resetAllMocks()
  state.fullArchive = true
  state.user = { id: 'member' }
  state.r2Get.mockResolvedValue({ body: 'PDF', size: 3 })
  state.createMultipart.mockResolvedValue({ uploadId: 'multipart' })
  state.completeMultipart.mockResolvedValue({ size: 123 })
  state.resumeMultipart.mockReturnValue({ complete: state.completeMultipart })
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const migration of migrations.filter((f) => !f.startsWith('0018_'))) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'))
  // Filer og prosjektkoblinger finnes FØR migrasjonen.
  sqlite.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('member', 'Testmedlem', 'test@example.invalid', 1, 1);
    INSERT INTO works (id, title, created_at, updated_at) VALUES ('work-a', 'Testverk', 1, 1), ('work-b', 'Annet verk', 1, 1);
    INSERT INTO parts (id, name_no, name_en, section, sort_order) VALUES ('cornet', 'Kornett', 'Cornet', 'cornet', 1);
    INSERT INTO projects (id, name, created_at, is_published, event_date) VALUES ('old-project', 'Gammelt prosjekt', 1, 1, '2099-01-01'), ('new-project', 'Nytt prosjekt', 1, 1, '2099-01-01');
    INSERT INTO project_works (project_id, work_id, position) VALUES ('old-project', 'work-a', 1);
    INSERT INTO work_files (id, work_id, kind, part_id, r2_key, file_name, uploaded_at) VALUES ('old-file', 'work-a', 'part', 'cornet', 'old.pdf', 'Old.pdf', 1);`)
  sqlite.exec(readFileSync('migrations/0018_verk-utgaver.sql', 'utf8'))
  state.db = drizzle(async (sql, params, method) => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') { stmt.run(...params as SQLInputValue[]); return { rows: [] } }
    return { rows: stmt.all(...params as SQLInputValue[]).map((row) => Object.values(row)) }
  })
  d = state.db as Db
})
afterEach(() => sqlite.close())

async function newEdition() {
  const result = await createWorkEdition({ data: { workId: 'work-a', name: 'Revidert 2026', notes: 'Nye stemmer' } })
  await d.insert(workFiles).values({ id: 'new-file', workId: 'work-a', editionId: result.id, kind: 'part', partId: 'cornet', r2Key: 'new.pdf', fileName: 'New.pdf', uploadedAt: new Date() })
  return result.id
}

async function readFile(fileId: string, token?: string) {
  const handler = (fileRoute.options as unknown as { server: { handlers: { GET: (args: { request: Request; params: { fileId: string } }) => Promise<Response> } } }).server.handlers.GET
  return handler({ request: new Request(`http://localhost/api/files/${fileId}${token ? `?t=${token}` : ''}`), params: { fileId } })
}

describe('utgaver med eksisterende data', () => {
  it('beholder gamle filer og prosjektkoblinger som Utgave 1', async () => {
    const work = await getWork({ data: { id: 'work-a' } })
    expect(work.editionId).toBeNull()
    expect(work.files.map((f) => f.id)).toEqual(['old-file'])
    expect(work.editions.map((e) => e.name)).toEqual(['Utgave 1'])
    expect((await assembleRepertoire(d, 'old-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['old-file'])
  })
  it('redigerer og fjerner kommentaren på en eksisterende utgave', async () => {
    const id = await newEdition()
    await updateWorkEditionNotes({ data: { workId: 'work-a', editionId: id, notes: '  Rettet kommentar  ' } })
    const work = await getWork({ data: { id: 'work-a', editionId: id } })
    expect(work.editions.find((e) => e.id === id)?.notes).toBe('Rettet kommentar')
    expect(work.files.map((f) => f.id)).toEqual(['new-file'])
    await updateWorkEditionNotes({ data: { workId: 'work-a', editionId: id, notes: '' } })
    expect((await getWork({ data: { id: 'work-a', editionId: id } })).editions.find((e) => e.id === id)?.notes).toBeNull()
  })
  it('avviser kommentarendring uten rettighet eller med utgave fra et annet verk', async () => {
    const id = await newEdition()
    await expect(updateWorkEditionNotes({ data: { workId: 'work-b', editionId: id, notes: 'Feil verk' } })).rejects.toThrow('tilhører ikke')
    state.permission.mockRejectedValueOnce(new Error('Ingen tilgang'))
    await expect(updateWorkEditionNotes({ data: { workId: 'work-a', editionId: id, notes: 'Avvist' } })).rejects.toThrow('Ingen tilgang')
    expect(state.permission).toHaveBeenLastCalledWith('works.manage')
    expect((await getWork({ data: { id: 'work-a', editionId: id } })).editions.find((e) => e.id === id)?.notes).toBe('Nye stemmer')
  })
  it('holder gamle og nye filer atskilt og lar arkivaren åpne begge', async () => {
    const id = await newEdition()
    expect((await getWork({ data: { id: 'work-a', editionId: id } })).files.map((f) => f.id)).toEqual(['new-file'])
    expect((await getWork({ data: { id: 'work-a', editionId: null } })).files.map((f) => f.id)).toEqual(['old-file'])
  })
  it('bruker gjeldende utgave i nye prosjekter uten å endre eksisterende', async () => {
    const id = await newEdition()
    await setCurrentWorkEdition({ data: { workId: 'work-a', editionId: id } })
    await addWorkToProject({ data: { workId: 'work-a', projectId: 'new-project' } })
    expect((await assembleRepertoire(d, 'old-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['old-file'])
    expect((await assembleRepertoire(d, 'new-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['new-file'])
    await setCurrentWorkEdition({ data: { workId: 'work-a', editionId: null } })
    expect((await assembleRepertoire(d, 'new-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['new-file'])
  })
  it('bytter prosjektets utgave bare ved eksplisitt valg og kan bytte tilbake', async () => {
    const id = await newEdition()
    await setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: id } })
    expect((await assembleRepertoire(d, 'old-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['new-file'])
    await setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: null } })
    expect((await assembleRepertoire(d, 'old-project', access))[0]?.myFiles.map((f) => f.id)).toEqual(['old-file'])
  })
  it('avviser utgave fra et annet verk og en tom gjeldende utgave', async () => {
    const { id } = await createWorkEdition({ data: { workId: 'work-a', name: 'Tom utgave' } })
    await expect(resolveEdition(d, 'work-b', id)).rejects.toThrow('tilhører ikke')
    await expect(setProjectWorkEdition({ data: { workId: 'work-b', projectId: 'old-project', editionId: id } })).rejects.toThrow('tilhører ikke')
    await expect(setCurrentWorkEdition({ data: { workId: 'work-a', editionId: id } })).rejects.toThrow('Last opp filer')
  })
  it('krever rettighet før utgave eller prosjektvalg endres', async () => {
    state.permission.mockRejectedValue(new Error('Ingen tilgang'))
    await expect(createWorkEdition({ data: { workId: 'work-a', name: 'Ny' } })).rejects.toThrow('Ingen tilgang')
    await expect(setCurrentWorkEdition({ data: { workId: 'work-a', editionId: null } })).rejects.toThrow('Ingen tilgang')
    await expect(setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: null } })).rejects.toThrow('Ingen tilgang')
    expect(state.permission.mock.calls.map(([permission]) => permission)).toEqual(['works.manage', 'works.manage', 'projects.manage'])
  })
  it('teller bare gjeldende utgaves stemmer i arkivet', async () => {
    const id = await newEdition()
    await setCurrentWorkEdition({ data: { workId: 'work-a', editionId: id } })
    expect((await listWorks({ data: {} })).works.find((w) => w.id === 'work-a')?.counts.parts).toBe(1)
  })
  it('sletter alle utgaver og R2-filer når hele verket slettes', async () => {
    await newEdition()
    await deleteWork({ data: { id: 'work-a' } })
    expect(state.r2Delete).toHaveBeenCalledWith(['old.pdf', 'new.pdf'])
    expect(sqlite.prepare('SELECT count(*) AS n FROM work_editions').get()?.n).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('binder opplasting til valgt utgave selv om gjeldende utgave endres', async () => {
    const id = await newEdition()
    const ticket = { workId: 'work-a', editionId: id, fileId: 'upload-file', key: 'fresh.pdf', uploadId: 'upload', fileName: 'Fresh.pdf', userId: 'archivist' }
    const token = await signUploadTicket(ticket)
    await setCurrentWorkEdition({ data: { workId: 'work-a', editionId: null } })
    expect((await verifyUploadTicket(token, 'archivist'))?.editionId).toBe(id)
    expect(await verifyUploadTicket(token, 'other-user')).toBeNull()
  })
  it('binder opplastingsstart til valgt utgave og avviser feil verk før R2', async () => {
    const id = await newEdition()
    await setCurrentWorkEdition({ data: { workId: 'work-a', editionId: id } })
    const handler = (startRoute.options as unknown as { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } }).server.handlers.POST
    const start = (workId: string, editionId?: string | null) => handler({ request: new Request('http://localhost/api/upload/start', { method: 'POST', body: JSON.stringify({ workId, editionId, fileName: 'Cornet.pdf', fileSize: 123 }) }) })
    const original = await (await start('work-a', null)).json() as { token: string }
    expect((await verifyUploadTicket(original.token, 'member'))?.editionId).toBeNull()
    const current = await (await start('work-a')).json() as { token: string }
    expect((await verifyUploadTicket(current.token, 'member'))?.editionId).toBe(id)
    state.createMultipart.mockClear()
    expect((await start('work-b', id)).status).toBe(400)
    expect(state.createMultipart).not.toHaveBeenCalled()
  })
  it('lagrer nye filer på billettens utgave og lar de gamle ligge', async () => {
    const id = await newEdition()
    const token = await signUploadTicket({ workId: 'work-a', editionId: id, fileId: 'uploaded-file', key: 'fresh.pdf', uploadId: 'upload', fileName: 'Old.pdf', userId: 'member' })
    // Gjeldende utgave er fortsatt originalen. Fullfør skal likevel skrive til den nye.
    const handler = (completeRoute.options as unknown as { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } }).server.handlers.POST
    const response = await handler({ request: new Request('http://localhost/api/upload/complete', { method: 'POST', body: JSON.stringify({ token, partId: 'cornet', pageCount: 2, parts: [{ partNumber: 1, etag: 'etag' }] }) }) })
    expect(response.status).toBe(200)
    expect((await getWork({ data: { id: 'work-a', editionId: id } })).files.map((f) => f.id)).toEqual(['new-file', 'uploaded-file'])
    expect((await getWork({ data: { id: 'work-a', editionId: null } })).files.map((f) => f.id)).toEqual(['old-file'])
  })
  it('nekter medlemmer å åpne feil utgave via en direkte fil-URL', async () => {
    const id = await newEdition()
    state.fullArchive = false
    expect((await readFile('old-file')).status).toBe(200)
    expect((await readFile('new-file')).status).toBe(403)
    await setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: id } })
    expect((await readFile('old-file')).status).toBe(403)
    expect((await readFile('new-file')).status).toBe(200)
  })
  it('gir arkivinnsyn til begge utgaver', async () => {
    await newEdition()
    expect((await readFile('old-file')).status).toBe(200)
    expect((await readFile('new-file')).status).toBe(200)
  })
  it('nekter vikarens direkte fil-URL til en annen utgave', async () => {
    const id = await newEdition()
    const { sha256Hex } = await import('../lib/id')
    const tokenHash = await sha256Hex('test-token')
    sqlite.prepare('INSERT INTO share_links (id, project_id, token_hash, recipient_name, part_ids, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('share', 'old-project', tokenHash, 'Vikar', '["cornet"]', Date.now() + 60000, 1)
    state.user = null
    expect((await readFile('old-file', 'test-token')).status).toBe(200)
    expect((await readFile('new-file', 'test-token')).status).toBe(403)
    await setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: id } })
    expect((await readFile('old-file', 'test-token')).status).toBe(403)
    expect((await readFile('new-file', 'test-token')).status).toBe(200)
  })
  it('viser bare prosjektets utgave i vikarvisningen', async () => {
    const id = await newEdition()
    const { sha256Hex } = await import('../lib/id')
    const tokenHash = await sha256Hex('test-token')
    sqlite.prepare('INSERT INTO share_links (id, project_id, token_hash, recipient_name, part_ids, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('share', 'old-project', tokenHash, 'Vikar', '["cornet"]', Date.now() + 60000, 1)
    const original = await getShareView({ data: { token: 'test-token' } })
    expect(original.status === 'ok' && original.repertoire[0]?.files.map((f) => f.id)).toEqual(['old-file'])
    await setProjectWorkEdition({ data: { workId: 'work-a', projectId: 'old-project', editionId: id } })
    const updated = await getShareView({ data: { token: 'test-token' } })
    expect(updated.status === 'ok' && updated.repertoire[0]?.files.map((f) => f.id)).toEqual(['new-file'])
  })
})
