import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestMe = { id: string; permissions: string[]; effectivePartIds: string[]; parts: Array<{ id: string; nameNo: string; nameEn: string; section: string }>; leadsPartIds: string[]; leadsLeafPartIds: string[]; name: string; roleName: string }
const state = vi.hoisted(() => ({ db: undefined as unknown, me: null as unknown, r2Get: vi.fn() }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({ env: { FILES: { get: state.r2Get } } }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (fn: () => unknown) => fn,
  validator: (schema: { parse: (data: unknown) => unknown }) => ({ handler: (fn: (args: { data: unknown }) => unknown) =>
    async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }) }),
}) }))
vi.mock('./access', () => {
  const has = (me: TestMe | null, permission: string) => !!me && (me.permissions.includes('*') || me.permissions.includes(permission))
  const fullArchive = (me: TestMe | null) => has(me, 'archive.viewAll') || has(me, 'works.manage')
  return {
    requireMe: async () => state.me,
    currentUser: async () => state.me,
    requirePermission: async (permission: string) => {
      if (!has(state.me as TestMe, permission)) throw new Error('Ingen tilgang')
      return state.me
    },
    hasPermission: has,
    hasFullArchiveAccess: fullArchive,
    memberFileAccessContext: (me: TestMe, inAccessibleProject: boolean, effectivePartIds = me.effectivePartIds) => ({
      effectivePartIds, sectionLeaderPartIds: [], canManageSection: false, isGroupLeader: false,
      canViewScore: has(me, 'scores.view'), canViewAll: fullArchive(me), inAccessibleProject,
    }),
  }
})
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }))
vi.mock('./file-access-log', () => ({ accessTypeForRequestUrl: () => 'view', logFileAccess: vi.fn() }))

import { Route as fileRoute } from '../routes/api/files/$fileId'
import { getCrewOptions, setProjectCrew } from './project-crew'
import { getHome, getProject, listProjects } from './projects'

const me = (id: string, permissions: string[] = [], partIds = ['cornet']): TestMe => ({
  id, name: id, roleName: 'Musiker', permissions, effectivePartIds: partIds,
  parts: partIds.map((p) => ({ id: p, nameNo: p, nameEn: p, section: p })), leadsPartIds: [], leadsLeafPartIds: [],
})

let sqlite: DatabaseSync

beforeEach(() => {
  state.r2Get.mockReset()
  state.r2Get.mockResolvedValue({ body: 'PDF', size: 3 })
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
  sqlite.exec(`
    INSERT OR IGNORE INTO roles (id, name) VALUES ('member', 'Musiker');
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('ola', 'Ola', 'ola@example.invalid', 1, 1), ('kari', 'Kari', 'kari@example.invalid', 1, 1),
      ('borte', 'Borte', 'borte@example.invalid', 1, 1), ('stab', 'Stab', 'stab@example.invalid', 1, 1);
    INSERT INTO member_profiles (auth_user_id, role_id, is_active, created_at) VALUES
      ('ola', 'member', 1, 1), ('kari', 'member', 1, 1), ('borte', 'member', 0, 1), ('stab', 'member', 1, 1);
    INSERT OR IGNORE INTO parts (id, name_no, name_en, section, sort_order) VALUES
      ('cornet', 'Kornett', 'Cornet', 'cornet', 1), ('bass', 'Bass', 'Bass', 'bass', 2);
    INSERT INTO works (id, title, created_at, updated_at) VALUES ('gig-work', 'Oppdragsverk', 1, 1), ('both-work', 'Felles verk', 1, 1);
    INSERT INTO work_files (id, work_id, kind, part_id, r2_key, file_name, uploaded_at) VALUES
      ('gig-cornet', 'gig-work', 'part', 'cornet', 'a.pdf', 'a.pdf', 1),
      ('gig-bass', 'gig-work', 'part', 'bass', 'b.pdf', 'b.pdf', 1),
      ('both-cornet', 'both-work', 'part', 'cornet', 'c.pdf', 'c.pdf', 1);
    INSERT INTO projects (id, name, kind, created_at, is_published, event_date) VALUES
      ('gig', 'Julebord', 'spilleoppdrag', 1, 1, '2099-12-12'),
      ('draft-gig', 'Utkast', 'spilleoppdrag', 1, 0, '2099-12-13'),
      ('concert', 'Julekonsert', 'konsert', 1, 1, '2099-12-20');
    INSERT INTO project_works (project_id, work_id, position) VALUES
      ('gig', 'gig-work', 1), ('gig', 'both-work', 2), ('draft-gig', 'gig-work', 1), ('concert', 'both-work', 1);
  `)
  state.db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql)
      if (method === 'run') { stmt.run(...params as SQLInputValue[]); return { rows: [] } }
      // Arrays, ikke objekter: projects.name og seasons.name ville ellers kollidert.
      ;(stmt as unknown as { setReturnArrays: (on: boolean) => void }).setReturnArrays(true)
      return { rows: stmt.all(...params as SQLInputValue[]) as unknown as unknown[][] }
    },
    async (queries) => {
      sqlite.exec('BEGIN')
      try {
        for (const q of queries) sqlite.prepare(q.sql).run(...q.params as SQLInputValue[])
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
      return queries.map(() => ({ rows: [] }))
    },
  )
})
afterEach(() => sqlite.close())

async function fileStatus(fileId: string): Promise<number> {
  const handler = (fileRoute.options as unknown as { server: { handlers: { GET: (args: { request: Request; params: { fileId: string } }) => Promise<Response> } } }).server.handlers.GET
  return (await handler({ request: new Request(`http://localhost/api/files/${fileId}`), params: { fileId } })).status
}

const manager = () => { state.me = me('stab', ['projects.manage']) }
const crew = (members: Array<{ userId: string; partIds: string[] }>, projectId = 'gig') => {
  manager()
  return setProjectCrew({ data: { projectId, members } })
}

describe('fil-gaten', () => {
  it('stenger stemmen for den som ikke er med, selv om det er stemmen hen spiller', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    state.me = me('kari')
    expect(await fileStatus('gig-cornet')).toBe(403)
  })
  it('gir den som er med sin vanlige stemme', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    state.me = me('ola')
    expect(await fileStatus('gig-cornet')).toBe(200)
    expect(await fileStatus('gig-bass')).toBe(403)
  })
  it('gir den tildelte stemmen i stedet for den vanlige', async () => {
    await crew([{ userId: 'ola', partIds: ['bass'] }])
    state.me = me('ola')
    expect(await fileStatus('gig-bass')).toBe(200)
    expect(await fileStatus('gig-cornet')).toBe(403)
  })
  it('lar et vanlig prosjekt med samme verk virke som før for alle', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    state.me = me('kari')
    expect(await fileStatus('both-cornet')).toBe(200)
  })
  it('åpner ingenting fra et upublisert oppdrag', async () => {
    await crew([{ userId: 'ola', partIds: [] }], 'draft-gig')
    state.me = me('ola')
    expect(await fileStatus('gig-cornet')).toBe(403)
  })
  it('stenger igjen når medlemmet tas av oppdraget', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    await crew([])
    state.me = me('ola')
    expect(await fileStatus('gig-cornet')).toBe(403)
  })
})

describe('synlighet', () => {
  const names = (data: Awaited<ReturnType<typeof listProjects>>) => data.seasons.flatMap((s) => s.projects.map((p) => p.name))

  it('viser oppdraget i prosjektlista bare for dem som er med og for stab', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    state.me = me('kari')
    expect(names(await listProjects({ data: undefined }))).toEqual(['Julekonsert'])
    state.me = me('kari', ['archive.viewAll'])
    expect(names(await listProjects({ data: undefined }))).toEqual(['Julekonsert'])
    state.me = me('ola')
    expect(names(await listProjects({ data: undefined })).sort()).toEqual(['Julebord', 'Julekonsert'])
    manager()
    expect(names(await listProjects({ data: undefined }))).toHaveLength(3)
  })
  it('svarer som om oppdraget ikke finnes for den som ikke er med', async () => {
    state.me = me('kari')
    await expect(getProject({ data: { id: 'gig' } })).rejects.toThrow('Fant ikke prosjektet')
  })
  it('viser besetningen og egne noter til den som er med', async () => {
    await crew([{ userId: 'ola', partIds: ['bass'] }, { userId: 'kari', partIds: [] }])
    state.me = me('ola')
    const data = await getProject({ data: { id: 'gig' } })
    expect(data.isCrew).toBe(true)
    expect(data.crew?.map((c) => c.name)).toEqual(['Kari', 'Ola'])
    expect(data.myParts.map((p) => p.id)).toEqual(['bass'])
    expect(data.repertoire[0]?.myFiles.map((f) => f.id)).toEqual(['gig-bass'])
  })
  it('legger oppdraget på «Mine noter» bare for dem som er med, også for stab', async () => {
    await crew([{ userId: 'ola', partIds: ['bass'] }])
    state.me = me('ola', [], [])
    const mine = await getHome()
    expect(mine.nextProject?.id).toBe('gig')
    expect(mine.nextHasParts).toBe(true)
    expect(mine.repertoire[0]?.myFiles.map((f) => f.id)).toEqual(['gig-bass'])
    manager()
    expect((await getHome()).nextProject?.id).toBe('concert')
  })
})

describe('setProjectCrew', () => {
  it('krever projects.manage', async () => {
    state.me = me('ola')
    await expect(setProjectCrew({ data: { projectId: 'gig', members: [] } })).rejects.toThrow('Ingen tilgang')
    await expect(getCrewOptions({ data: { projectId: 'gig' } })).rejects.toThrow('Ingen tilgang')
  })
  it('avviser deaktiverte medlemmer, ukjente stemmer og vanlige prosjekter', async () => {
    manager()
    await expect(setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'borte', partIds: [] }] } })).rejects.toThrow('deaktivert')
    await expect(setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: ['finnes-ikke'] }] } })).rejects.toThrow('Ukjent stemme')
    await expect(setProjectCrew({ data: { projectId: 'concert', members: [] } })).rejects.toThrow('Fant ikke spilleoppdraget')
  })
  it('erstatter besetningen og husker hvem som la til et medlem', async () => {
    await crew([{ userId: 'ola', partIds: [] }])
    state.me = me('kari', ['projects.manage'])
    await setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: ['bass'] }, { userId: 'kari', partIds: [] }] } })
    const rows = sqlite.prepare('SELECT user_id, part_ids, added_by FROM project_crew ORDER BY user_id').all() as Array<{ user_id: string; part_ids: string; added_by: string | null }>
    expect(rows.map((r) => r.user_id)).toEqual(['kari', 'ola'])
    expect(rows[1]).toMatchObject({ part_ids: '["bass"]', added_by: 'stab' })
  })
})
