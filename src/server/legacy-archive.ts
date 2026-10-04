import { createServerFn } from '@tanstack/react-start'
import { db } from '../db'
import { legacyArchiveEntries } from '../db/schema'
import { hasFullArchiveAccess, requireMe, requirePermission } from './access'
import { archiveImportSchema } from '../lib/legacy-archive'

export const listLegacyArchive = createServerFn().handler(async () => {
  const me = await requireMe()
  if (!hasFullArchiveAccess(me)) throw new Error('Du har ikke tilgang til arkivlisten')
  const rows = await db().select().from(legacyArchiveEntries)
  return { entries: rows.map(({ sourceData, sourceRow, ...entry }) => entry).sort((a, b) => a.title.localeCompare(b.title, 'nb')) }
})

export const importLegacyArchive = createServerFn({ method: 'POST' }).validator(archiveImportSchema).handler(async ({ data }) => {
  await requirePermission('works.manage')
  const d = db()
  const existing = await d.select().from(legacyArchiveEntries)
  const numbers = new Set(existing.flatMap((e) => e.archiveNumber === null ? [] : [e.archiveNumber]))
  const ids = new Set(existing.map((e) => e.id))
  const rows = []
  for (const entry of data.entries) {
    const identity = entry.archiveNumber === null ? `${data.filename}:${entry.sourceRow}` : `number:${entry.archiveNumber}`
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
    const id = `legacy:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`
    if (ids.has(id) || (entry.archiveNumber !== null && numbers.has(entry.archiveNumber))) continue
    ids.add(id)
    if (entry.archiveNumber !== null) numbers.add(entry.archiveNumber)
    rows.push({ ...entry, id, sourceData: JSON.stringify({ filename: data.filename, row: entry.sourceRow, values: entry }) })
  }
  // Each statement stays below D1's bound-parameter limit; the batch is atomic.
  if (rows.length) {
    const statements = []
    for (let i = 0; i < rows.length; i += 6) statements.push(d.insert(legacyArchiveEntries).values(rows.slice(i, i + 6)).onConflictDoNothing().returning({ id: legacyArchiveEntries.id }))
    const result = await d.batch(statements as [typeof statements[number], ...typeof statements[number][]])
    const imported = result.reduce((n, r) => n + r.length, 0)
    return { imported, skipped: data.entries.length - imported }
  }
  return { imported: 0, skipped: data.entries.length }
})
