import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), select: vi.fn(), remove: vi.fn(), r2Delete: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: (schema: { parse: (data: unknown) => unknown }) => ({
    handler: (handler: (args: { data: unknown }) => unknown) =>
      async ({ data }: { data: unknown }) => handler({ data: schema.parse(data) }),
  }) }),
}))
vi.mock('cloudflare:workers', () => ({ env: { FILES: { delete: mocks.r2Delete } } }))
vi.mock('./access', () => ({ requirePermission: mocks.permission, requireMe: vi.fn(), hasPermission: vi.fn(), hasFullArchiveAccess: vi.fn() }))
vi.mock('../db', () => ({ db: () => ({
  select: () => ({ from: () => ({ where: mocks.select }) }),
  delete: () => ({ where: mocks.remove }),
}) }))
import { deleteWorkFiles } from './works'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.r2Delete.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
})

describe('samlet sletting av stemmefiler', () => {
  it('krever works.manage før databasen eller filene røres', async () => {
    mocks.permission.mockRejectedValue(new Error('Ingen tilgang'))
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: ['a'] } })).rejects.toThrow('Ingen tilgang')
    expect(mocks.permission).toHaveBeenCalledWith('works.manage')
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.r2Delete).not.toHaveBeenCalled()
  })
  it('avviser tomme og for store utvalg', async () => {
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: [] } })).rejects.toThrow()
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: Array(101).fill('a') } })).rejects.toThrow()
    expect(mocks.permission).not.toHaveBeenCalled()
  })
  it('stopper hele slettingen dersom en valgt fil mangler eller tilhører et annet verk', async () => {
    mocks.select.mockResolvedValueOnce([{ id: 'a', r2Key: 'file-a' }])
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: ['a', 'b'] } })).rejects.toThrow('finnes ikke lenger')
    expect(mocks.r2Delete).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('dedupliserer utvalget og sletter filene før radene', async () => {
    mocks.select.mockResolvedValueOnce([{ id: 'a', r2Key: 'file-a' }, { id: 'b', r2Key: 'file-b' }])
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: ['a', 'b', 'a'] } })).resolves.toEqual({ deleted: 2 })
    expect(mocks.r2Delete).toHaveBeenCalledWith(['file-a', 'file-b'])
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.r2Delete.mock.invocationCallOrder[0]!)
  })
  it('avgrenser både oppslag og sletting til fil-id-er i det oppgitte verket', async () => {
    mocks.select.mockResolvedValueOnce([{ id: 'a', r2Key: 'file-a' }])
    await deleteWorkFiles({ data: { workId: 'work-a', fileIds: ['a'] } })
    const { SQLiteSyncDialect } = await import('drizzle-orm/sqlite-core')
    const dialect = new SQLiteSyncDialect()
    const lookup = dialect.sqlToQuery(mocks.select.mock.calls[0]![0])
    const removal = dialect.sqlToQuery(mocks.remove.mock.calls[0]![0])
    expect(lookup.sql).toContain('"work_files"."work_id" = ?')
    expect(lookup.sql).toContain('"work_files"."id" in (?)')
    expect(lookup.params).toEqual(['work-a', 'a'])
    expect(removal).toEqual(lookup)
  })
  it('beholder databaseradene ved feil i filsletting', async () => {
    mocks.select.mockResolvedValueOnce([{ id: 'a', r2Key: 'file-a' }])
    mocks.r2Delete.mockRejectedValueOnce(new Error('R2 utilgjengelig'))
    await expect(deleteWorkFiles({ data: { workId: 'work-a', fileIds: ['a'] } })).rejects.toThrow('R2 utilgjengelig')
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
