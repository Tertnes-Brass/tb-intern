import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  FILE_ACCESS_DEDUP_WINDOW_MS,
  accessTypeForRequestUrl,
  buildFileAccessLogQuery,
  type FileAccessActor,
  type FileAccessType,
} from './file-access-log'

type SqliteValue = string | number | bigint | Uint8Array | null

function createTestDb(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE download_log (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      share_link_id TEXT,
      work_file_id TEXT NOT NULL,
      access_type TEXT DEFAULT 'download' NOT NULL,
      at INTEGER NOT NULL
    )
  `)
  return database
}

function insertAccess(
  database: DatabaseSync,
  input: {
    id: string
    actor: FileAccessActor
    workFileId?: string
    accessType?: FileAccessType
    at: number
  },
): void {
  const compiled = new SQLiteSyncDialect().sqlToQuery(
    buildFileAccessLogQuery({
      id: input.id,
      actor: input.actor,
      workFileId: input.workFileId ?? 'file-1',
      accessType: input.accessType ?? 'view',
      at: new Date(input.at),
    }),
  )
  database.prepare(compiled.sql).run(...(compiled.params as SqliteValue[]))
}

function rows(database: DatabaseSync) {
  return database
    .prepare(
      'SELECT id, user_id AS userId, share_link_id AS shareLinkId, work_file_id AS workFileId, access_type AS accessType, at FROM download_log ORDER BY at',
    )
    .all()
}

describe('accessTypeForRequestUrl', () => {
  it('skiller eksplisitt nedlasting fra inline-visning', () => {
    expect(accessTypeForRequestUrl(new URL('https://example.test/api/files/file-1?download=1'))).toBe('download')
    expect(accessTypeForRequestUrl(new URL('https://example.test/api/files/file-1'))).toBe('view')
    expect(accessTypeForRequestUrl(new URL('https://example.test/api/files/file-1?download=0'))).toBe('view')
  })
})

describe('buildFileAccessLogQuery', () => {
  it('dedupliserer samme bruker, fil og tilgangstype i et rullerende vindu', () => {
    const database = createTestDb()
    const actor = { kind: 'user', id: 'user-1' } as const
    const start = Date.UTC(2026, 6, 24, 12)

    insertAccess(database, { id: 'first', actor, at: start })
    insertAccess(database, { id: 'duplicate', actor, at: start + FILE_ACCESS_DEDUP_WINDOW_MS - 1 })
    insertAccess(database, { id: 'after-window', actor, at: start + FILE_ACCESS_DEDUP_WINDOW_MS + 1 })

    expect(rows(database).map((row) => row.id)).toEqual(['first', 'after-window'])
    database.close()
  })

  it('beholder eksplisitt nedlasting ved siden av visning', () => {
    const database = createTestDb()
    const actor = { kind: 'user', id: 'user-1' } as const
    const start = Date.UTC(2026, 6, 24, 12)

    insertAccess(database, { id: 'view', actor, accessType: 'view', at: start })
    insertAccess(database, { id: 'download', actor, accessType: 'download', at: start + 1 })

    expect(rows(database).map((row) => row.accessType)).toEqual(['view', 'download'])
    database.close()
  })

  it('dedupliserer per bruker eller delingslenke, ikke på tvers av aktører', () => {
    const database = createTestDb()
    const start = Date.UTC(2026, 6, 24, 12)

    insertAccess(database, { id: 'user-1', actor: { kind: 'user', id: 'user-1' }, at: start })
    insertAccess(database, { id: 'user-2', actor: { kind: 'user', id: 'user-2' }, at: start + 1 })
    insertAccess(database, { id: 'share-1', actor: { kind: 'share', id: 'share-1' }, at: start + 2 })
    insertAccess(database, { id: 'share-duplicate', actor: { kind: 'share', id: 'share-1' }, at: start + 3 })

    expect(rows(database)).toMatchObject([
      { id: 'user-1', userId: 'user-1', shareLinkId: null },
      { id: 'user-2', userId: 'user-2', shareLinkId: null },
      { id: 'share-1', userId: null, shareLinkId: 'share-1' },
    ])
    database.close()
  })

  it('dedupliserer ikke samme aktør på forskjellige filer', () => {
    const database = createTestDb()
    const actor = { kind: 'share', id: 'share-1' } as const
    const start = Date.UTC(2026, 6, 24, 12)

    insertAccess(database, { id: 'file-1', actor, workFileId: 'file-1', at: start })
    insertAccess(database, { id: 'file-2', actor, workFileId: 'file-2', at: start + 1 })

    expect(rows(database).map((row) => row.workFileId)).toEqual(['file-1', 'file-2'])
    database.close()
  })
})
