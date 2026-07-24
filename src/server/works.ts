import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { parts, projectWorks, projects, workFiles, workLinks, works } from '../db/schema'
import { newId } from '../lib/id'
import { guessPartFromFilename } from '../lib/taxonomy'
import { normalizeWorkMetadata, workMetadataInput } from '../lib/work-metadata'
import { hasFullArchiveAccess, hasPermission, requireMe, requirePermission } from './access'

export const listWorks = createServerFn()
  .validator(z.object({ q: z.string().optional() }).optional())
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (!hasFullArchiveAccess(me)) throw new Error('Du har ikke tilgang til hele arkivet')
    const d = db()
    const q = data?.q?.trim()

    const where = q
      ? or(
          like(works.title, `%${q}%`),
          like(works.subtitle, `%${q}%`),
          like(works.archiveNumber, `%${q}%`),
          like(works.composer, `%${q}%`),
          like(works.arranger, `%${q}%`),
        )
      : undefined

    const workRows = await d
      .select()
      .from(works)
      .where(where)
      .orderBy(asc(works.title))

    const counts = await d
      .select({
        workId: workFiles.workId,
        kind: workFiles.kind,
        n: sql<number>`count(*)`,
      })
      .from(workFiles)
      .groupBy(workFiles.workId, workFiles.kind)

    const countMap = new Map<string, { parts: number; score: number; audio: number }>()
    for (const c of counts) {
      const entry = countMap.get(c.workId) ?? { parts: 0, score: 0, audio: 0 }
      if (c.kind === 'part') entry.parts = c.n
      else if (c.kind === 'score') entry.score = c.n
      else if (c.kind === 'audio') entry.audio = c.n
      countMap.set(c.workId, entry)
    }

    return {
      works: workRows.map((wr) => ({
        ...wr,
        counts: countMap.get(wr.id) ?? { parts: 0, score: 0, audio: 0 },
      })),
      canManage: hasPermission(me, 'works.manage'),
    }
  })

export const getWork = createServerFn()
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (!hasFullArchiveAccess(me)) throw new Error('Du har ikke tilgang til hele arkivet')
    const d = db()

    const workRow = (await d.select().from(works).where(eq(works.id, data.id)).limit(1))[0]
    if (!workRow) throw new Error('Fant ikke verket')

    const [files, links, allParts, usedIn] = await Promise.all([
      d
        .select({
          id: workFiles.id,
          kind: workFiles.kind,
          partId: workFiles.partId,
          label: workFiles.label,
          fileName: workFiles.fileName,
          fileSize: workFiles.fileSize,
          pageCount: workFiles.pageCount,
          uploadedAt: workFiles.uploadedAt,
          partName: parts.nameNo,
          partSort: parts.sortOrder,
          partSection: parts.section,
        })
        .from(workFiles)
        .leftJoin(parts, eq(workFiles.partId, parts.id))
        .where(eq(workFiles.workId, data.id)),
      d.select().from(workLinks).where(eq(workLinks.workId, data.id)),
      d.select().from(parts).orderBy(asc(parts.sortOrder)),
      d
        .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
        .from(projectWorks)
        .innerJoin(projects, eq(projectWorks.projectId, projects.id))
        .where(eq(projectWorks.workId, data.id))
        .orderBy(desc(projects.eventDate)),
    ])

    files.sort((a, b) => (a.partSort ?? 900) - (b.partSort ?? 900))

    return {
      work: workRow,
      files,
      links,
      allParts,
      usedIn,
      canManage: hasPermission(me, 'works.manage'),
      canViewScore: hasPermission(me, 'scores.view'),
      effectivePartIds: me.effectivePartIds,
    }
  })

const workInput = workMetadataInput.extend({
  title: z.string().min(1, 'Tittel er påkrevd'),
  composer: z.string().optional(),
  arranger: z.string().optional(),
  publisher: z.string().optional(),
  genre: z.string().optional(),
  grade: z.number().int().min(1).max(5).nullable().optional(),
  durationSec: z.number().int().positive().nullable().optional(),
  physicalLocation: z.string().optional(),
  acquiredYear: z.number().int().nullable().optional(),
  notes: z.string().optional(),
})

export const createWork = createServerFn({ method: 'POST' })
  .validator(workInput)
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const id = newId()
    const ts = new Date()
    await d.insert(works).values({
      id,
      title: data.title.trim(),
      ...normalizeWorkMetadata(data),
      composer: data.composer?.trim() || null,
      arranger: data.arranger?.trim() || null,
      publisher: data.publisher?.trim() || null,
      genre: data.genre?.trim() || null,
      grade: data.grade ?? null,
      durationSec: data.durationSec ?? null,
      physicalLocation: data.physicalLocation?.trim() || null,
      acquiredYear: data.acquiredYear ?? null,
      notes: data.notes?.trim() || null,
      createdAt: ts,
      updatedAt: ts,
    })
    return { id }
  })

export const updateWork = createServerFn({ method: 'POST' })
  .validator(workInput.extend({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    await d
      .update(works)
      .set({
        title: data.title.trim(),
        ...normalizeWorkMetadata(data),
        composer: data.composer?.trim() || null,
        arranger: data.arranger?.trim() || null,
        publisher: data.publisher?.trim() || null,
        genre: data.genre?.trim() || null,
        grade: data.grade ?? null,
        durationSec: data.durationSec ?? null,
        physicalLocation: data.physicalLocation?.trim() || null,
        acquiredYear: data.acquiredYear ?? null,
        notes: data.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(works.id, data.id))
    return { ok: true }
  })

export const deleteWork = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const files = await d.select({ r2Key: workFiles.r2Key }).from(workFiles).where(eq(workFiles.workId, data.id))
    if (files.length > 0) {
      await env.FILES.delete(files.map((f) => f.r2Key))
    }
    await d.delete(works).where(eq(works.id, data.id))
    return { ok: true }
  })

export const deleteWorkFile = createServerFn({ method: 'POST' })
  .validator(z.object({ fileId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const row = (await d.select().from(workFiles).where(eq(workFiles.id, data.fileId)).limit(1))[0]
    if (!row) return { ok: true }
    await env.FILES.delete(row.r2Key)
    await d.delete(workFiles).where(eq(workFiles.id, data.fileId))
    return { ok: true }
  })

export const setWorkFilePart = createServerFn({ method: 'POST' })
  .validator(z.object({ fileId: z.string(), partId: z.string().nullable() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const kind = data.partId == null ? 'other' : data.partId === 'score' ? 'score' : 'part'
    await d.update(workFiles).set({ partId: data.partId, kind }).where(eq(workFiles.id, data.fileId))
    return { ok: true }
  })

/**
 * Kjører navnegjenkjenningen på nytt over filene som ligger «uplassert»
 * (kind = 'other'). Nyttig når besetning/aliaser er endret etter opplasting.
 */
export const rematchWorkFiles = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const partDefs = await d.select().from(parts).orderBy(asc(parts.sortOrder))
    const unplaced = await d
      .select({ id: workFiles.id, fileName: workFiles.fileName })
      .from(workFiles)
      .where(and(eq(workFiles.workId, data.workId), eq(workFiles.kind, 'other')))

    let matched = 0
    for (const f of unplaced) {
      const guessed = guessPartFromFilename(f.fileName, partDefs)
      if (!guessed) continue
      const kind = guessed === 'score' ? 'score' : 'part'
      await d.update(workFiles).set({ partId: guessed, kind }).where(eq(workFiles.id, f.id))
      matched++
    }
    return { matched, total: unplaced.length }
  })

export const addWorkLink = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string(), url: z.string().url('Ugyldig URL'), label: z.string().optional() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const kind = /youtube\.com|youtu\.be/.test(data.url) ? 'youtube' : /spotify\.com/.test(data.url) ? 'spotify' : 'other'
    await d.insert(workLinks).values({
      id: newId(),
      workId: data.workId,
      kind,
      url: data.url,
      label: data.label?.trim() || null,
    })
    return { ok: true }
  })

export const deleteWorkLink = createServerFn({ method: 'POST' })
  .validator(z.object({ linkId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    await db().delete(workLinks).where(eq(workLinks.id, data.linkId))
    return { ok: true }
  })
