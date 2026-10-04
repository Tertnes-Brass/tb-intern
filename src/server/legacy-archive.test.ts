import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ me: vi.fn(), allowed: vi.fn(), from: vi.fn(), permission: vi.fn(), batch: vi.fn(), values: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => { const builder = { validator: () => builder, handler: (fn: () => unknown) => fn }; return builder } }))
vi.mock('../db', () => ({ db: () => ({ select: () => ({ from: state.from }), insert: () => ({ values: state.values }), batch: state.batch }) }))
vi.mock('./access', () => ({ requireMe: state.me, hasFullArchiveAccess: state.allowed, requirePermission: state.permission }))
import { listLegacyArchive, importLegacyArchive } from './legacy-archive'
beforeEach(() => { vi.resetAllMocks(); state.me.mockResolvedValue({}); state.allowed.mockReturnValue(true) })
it('avviser lesing uten fullt arkivinnsyn før data hentes', async () => {
  state.allowed.mockReturnValue(false)
  await expect(listLegacyArchive()).rejects.toThrow('ikke tilgang')
  expect(state.from).not.toHaveBeenCalled()
})
it('beholder arkivnummer og manglende nummer ved lesing', async () => {
  state.from.mockResolvedValue([{ id: 'a', title: 'Årstid', archiveNumber: '1000' }, { id: 'b', title: 'Aria', archiveNumber: null }])
  const result = await listLegacyArchive()
  expect(result.entries.map((e) => e.archiveNumber)).toEqual([null, '1000'])
})

const entry = { sourceRow: 2, archiveNumber: '0012', title: 'Stykke', composer: null, arranger: null, missingParts: null, lastChecked: null, categoryCode: null, notes: null, loanedTo: null, markedDigitized: false }
it('krever skriverettighet før import leser eller skriver data', async () => {
  state.permission.mockRejectedValue(new Error('Ingen tilgang'))
  await expect(importLegacyArchive({ data: { filename: 'a.xlsx', entries: [entry] } })).rejects.toThrow('Ingen tilgang')
  expect(state.permission).toHaveBeenCalledWith('works.manage')
  expect(state.from).not.toHaveBeenCalled()
  expect(state.batch).not.toHaveBeenCalled()
})
it('hopper over eksisterende nummer uten å overskrive', async () => {
  state.from.mockResolvedValue([{ id: 'old', archiveNumber: '0012' }])
  await expect(importLegacyArchive({ data: { filename: 'a.xlsx', entries: [entry] } })).resolves.toEqual({ imported: 0, skipped: 1 })
  expect(state.batch).not.toHaveBeenCalled()
})
it('bevarer nummerløse rader og hindrer gjentatt import av samme kilde', async () => {
  state.from.mockResolvedValue([])
  state.values.mockReturnValue({ onConflictDoNothing: () => ({ returning: () => ({}) }) })
  state.batch.mockResolvedValue([[{ id: 'new' }]])
  const data = { filename: 'a.xlsx', entries: [{ ...entry, archiveNumber: null }] }
  await expect(importLegacyArchive({ data })).resolves.toEqual({ imported: 1, skipped: 0 })
  const inserted = state.values.mock.calls[0][0][0]
  expect(inserted.archiveNumber).toBeNull()
  expect(JSON.parse(inserted.sourceData).filename).toBe('a.xlsx')
  state.from.mockResolvedValue([inserted])
  await expect(importLegacyArchive({ data })).resolves.toEqual({ imported: 0, skipped: 1 })
  expect(state.batch).toHaveBeenCalledTimes(1)
})
