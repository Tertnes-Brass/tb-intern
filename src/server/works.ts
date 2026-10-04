import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { parts, projectWorks, projects, workFiles, workLinks, workEditions, works } from '../db/schema'
import { resolveEdition } from './work-editions-store'
import { newId } from '../lib/id'
import { guessPartFromFilename } from '../lib/taxonomy'
import {
  archiveSearchInput,
  buildFilterOptions,
  matchesMissing,
  resolveWorkFilter,
  sortWorks,
} from '../lib/work-filter'
import { normalizeWorkMetadata, workMetadataInput } from '../lib/work-metadata'
import { hasFullArchiveAccess, hasPermission, requireMe, requirePermission } from './access'

export const listWorks = createServerFn()
  .validator(archiveSearchInput.optional())
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (!hasFullArchiveAccess(me)) throw new Error('Du har ikke tilgang til hele arkivet')
    const d = db()
    const filter = resolveWorkFilter(data)

    // Arkiverte verk er skjult med mindre man ber om dem. Statusen avgrenser
    // også nedtrekksvalgene, så listen og valgene alltid ser samme arkiv.
    const statusWhere = filter.status === 'all' ? undefined : eq(works.status, filter.status)

    const conditions = [
      statusWhere,
      filter.q
        ? or(
            like(works.title, `%${filter.q}%`),
            like(works.subtitle, `%${filter.q}%`),
            like(works.archiveNumber, `%${filter.q}%`),
            like(works.composer, `%${filter.q}%`),
            like(works.arranger, `%${filter.q}%`),
          )
        : undefined,
      filter.composer ? eq(works.composer, filter.composer) : undefined,
      filter.arranger ? eq(works.arranger, filter.arranger) : undefined,
      filter.genre ? eq(works.genre, filter.genre) : undefined,
      filter.grade != null ? eq(works.grade, filter.grade) : undefined,
      filter.year != null ? eq(works.acquiredYear, filter.year) : undefined,
    ].filter((c) => c != null)

    const [workRows, facetRows, counts, linkCounts] = await Promise.all([
      d
        .select()
        .from(works)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(works.title)),
      // Nedtrekksvalgene bygges av hele arkivet (innenfor statusvalget), ikke av
      // treffene — ellers ville et valgt filter tømme sine egne alternativer.
      d
        .select({
          composer: works.composer,
          arranger: works.arranger,
          genre: works.genre,
          grade: works.grade,
          acquiredYear: works.acquiredYear,
        })
        .from(works)
        .where(statusWhere),
      d
        .select({
          workId: workFiles.workId,
          kind: workFiles.kind,
          n: sql<number>`count(*)`,
        })
        .from(workFiles)
        .innerJoin(works, eq(workFiles.workId, works.id))
        .where(sql`${workFiles.editionId} IS ${works.currentEditionId}`)
        .groupBy(workFiles.workId, workFiles.kind),
      d
        .select({ workId: workLinks.workId, n: sql<number>`count(*)` })
        .from(workLinks)
        .groupBy(workLinks.workId),
    ])

    const countMap = new Map<string, { parts: number; score: number; audio: number }>()
    for (const c of counts) {
      const entry = countMap.get(c.workId) ?? { parts: 0, score: 0, audio: 0 }
      if (c.kind === 'part') entry.parts = c.n
      else if (c.kind === 'score') entry.score = c.n
      else if (c.kind === 'audio') entry.audio = c.n
      countMap.set(c.workId, entry)
    }
    const linkMap = new Map(linkCounts.map((l) => [l.workId, l.n]))

    // «Mangler»-filtrene og sorteringen er avledet av aggregatene over og av
    // norsk kollasjon/tomme verdier — det bor i work-filter.ts, ikke i SQL.
    const rows = workRows
      .map((wr) => ({
        ...wr,
        counts: countMap.get(wr.id) ?? { parts: 0, score: 0, audio: 0 },
        linkCount: linkMap.get(wr.id) ?? 0,
      }))
      .filter((wr) => matchesMissing(wr, filter.missing))

    return {
      works: sortWorks(rows, filter.sort, filter.dir),
      // Antall verk i arkivet innenfor statusvalget — «12 av 84 verk».
      total: facetRows.length,
      options: buildFilterOptions(facetRows),
      canManage: hasPermission(me, 'works.manage'),
    }
  })

export const getWork = createServerFn()
  .validator(z.object({ id: z.string(), editionId: z.string().min(1).nullable().optional() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (!hasFullArchiveAccess(me)) throw new Error('Du har ikke tilgang til hele arkivet')
    const d = db()

    const workRow = (await d.select().from(works).where(eq(works.id, data.id)).limit(1))[0]
    if (!workRow) throw new Error('Fant ikke verket')
    const editionId = await resolveEdition(d, data.id, data.editionId)
    const editions = await d.select().from(workEditions).where(eq(workEditions.workId, data.id)).orderBy(asc(workEditions.createdAt), asc(workEditions.id))

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
        .where(and(eq(workFiles.workId, data.id), editionId === null ? isNull(workFiles.editionId) : eq(workFiles.editionId, editionId))),
      d.select().from(workLinks).where(eq(workLinks.workId, data.id)),
      d.select().from(parts).orderBy(asc(parts.sortOrder)),
      d
        .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate, editionId: projectWorks.editionId })
        .from(projectWorks)
        .innerJoin(projects, eq(projectWorks.projectId, projects.id))
        .where(eq(projectWorks.workId, data.id))
        .orderBy(desc(projects.eventDate)),
    ])

    files.sort((a, b) => (a.partSort ?? 900) - (b.partSort ?? 900))

    return {
      work: workRow,
      editionId,
      editions: [{ id: null as string | null, name: 'Utgave 1', notes: null as string | null, createdAt: workRow.createdAt }, ...editions],
      files,
      links,
      allParts,
      usedIn,
      canManage: hasPermission(me, 'works.manage'),
      canViewScore: hasPermission(me, 'scores.view'),
      effectivePartIds: me.effectivePartIds,
    }
  })

export const createWorkEdition = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string().min(1), name: z.string().trim().min(1, 'Navn er påkrevd').max(100), notes: z.string().trim().max(2000).optional() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    await resolveEdition(d, data.workId, null)
    const id = newId()
    await d.insert(workEditions).values({ id, workId: data.workId, name: data.name, notes: data.notes || null, createdAt: new Date() })
    return { id }
  })

export const setCurrentWorkEdition = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string().min(1), editionId: z.string().min(1).nullable() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const editionId = await resolveEdition(d, data.workId, data.editionId)
    const file = (await d.select({ id: workFiles.id }).from(workFiles).where(and(eq(workFiles.workId, data.workId), editionId === null ? isNull(workFiles.editionId) : eq(workFiles.editionId, editionId))).limit(1))[0]
    if (!file) throw new Error('Last opp filer til utgaven før den settes som gjeldende')
    await d.update(works).set({ currentEditionId: editionId, updatedAt: new Date() }).where(eq(works.id, data.workId))
    return { ok: true }
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
  status: z.enum(['active', 'archived']).optional(),
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
      status: data.status ?? 'active',
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
        // Utelatt status betyr «rør den ikke» — et kall uten feltet skal ikke
        // kunne ta et verk ut av arkivert-tilstand.
        ...(data.status ? { status: data.status } : {}),
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

/** Alle filene må tilhøre det oppgitte verket før noe slettes. */
export const deleteWorkFiles = createServerFn({ method: 'POST' })
  .validator(z.object({ workId: z.string().min(1), fileIds: z.array(z.string().min(1)).min(1).max(100) }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const ids = [...new Set(data.fileIds)]
    const selected = and(eq(workFiles.workId, data.workId), inArray(workFiles.id, ids))
    const files = await d.select({ id: workFiles.id, r2Key: workFiles.r2Key }).from(workFiles).where(selected)
    if (files.length !== ids.length) {
      throw new Error('En valgt fil finnes ikke lenger i dette verket. Oppdater siden og velg på nytt.')
    }
    // Behold databaseradene til R2-slettingen er ferdig.
    await env.FILES.delete(files.map((f) => f.r2Key))
    await d.delete(workFiles).where(selected)
    return { deleted: files.length }
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
  .validator(z.object({ workId: z.string(), editionId: z.string().min(1).nullable().optional() }))
  .handler(async ({ data }) => {
    await requirePermission('works.manage')
    const d = db()
    const editionId = await resolveEdition(d, data.workId, data.editionId)
    const partDefs = await d.select().from(parts).orderBy(asc(parts.sortOrder))
    const unplaced = await d
      .select({ id: workFiles.id, fileName: workFiles.fileName })
      .from(workFiles)
      .where(and(eq(workFiles.workId, data.workId), eq(workFiles.kind, 'other'), editionId === null ? isNull(workFiles.editionId) : eq(workFiles.editionId, editionId)))

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
