import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import { parts, projectWorks, projects, seasons, workFiles, workLinks, workEditions, works } from '../db/schema'
import { resolveEdition } from './work-editions-store'
import { newId } from '../lib/id'
import { PERCUSSION_MAX_LENGTH, parsePercussionSetup, showPercussionFor } from '../lib/percussion'
import { START_TIME_PATTERN } from '../lib/gig-calendar'
import { crewPartsFor, isGig, parseCrewPartIds, projectReadError } from '../lib/project-access'
import { STAGE_PERMISSION } from '../lib/stage-scene'
import { calloutResponses, memberProfiles, postCallouts } from '../db/schema'
import { crewPartIdsFor, listCrew, visibleToMember } from './project-crew-store'
import { findOrCreateSeason } from './season-store'
import { listStageSetupsForProject } from './stage-setup-store'
import {
  hasFullArchiveAccess,
  hasPermission,
  memberFileAccessContext,
  requireMe,
  requirePermission,
} from './access'
import { type AccessCtx, memberCanAccessFile, memberCanSeeFile } from './file-access'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_KINDS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
  groupBySeason,
  sortProjects,
} from './project-list'

export type ProjectWorkDetail = {
  workId: string
  editionId?: string | null
  editionName?: string
  editions?: Array<{ id: string | null; name: string }>
  title: string
  composer: string | null
  arranger: string | null
  genre: string | null
  durationSec: number | null
  position: number
  note: string | null
  /** Slagverksoppsettet for dette stykket i dette prosjektet (fri tekst). */
  percussionSetup: string | null
  links: Array<{ id: string; kind: string; url: string; label: string | null }>
  partFiles: Array<{ id: string; partId: string | null; partName: string | null; partSort: number; pageCount: number | null }>
  // fileName er med for at ZIP-nedlastingen skal kunne beholde filendelsen.
  myFiles: Array<{ id: string; partName: string | null; fileName: string; pageCount: number | null }>
  scoreFileId: string | null
  audioFiles: Array<{ id: string; label: string | null; fileName: string }>
}

export async function assembleRepertoire(
  d: Db,
  projectId: string,
  access: AccessCtx,
): Promise<ProjectWorkDetail[]> {
  const rows = await d
    .select({
      workId: works.id,
      editionId: projectWorks.editionId,
      title: works.title,
      composer: works.composer,
      arranger: works.arranger,
      genre: works.genre,
      durationSec: works.durationSec,
      position: projectWorks.position,
      note: projectWorks.note,
      percussionSetup: projectWorks.percussionSetup,
    })
    .from(projectWorks)
    .innerJoin(works, eq(projectWorks.workId, works.id))
    .where(eq(projectWorks.projectId, projectId))
    .orderBy(asc(projectWorks.position))

  if (rows.length === 0) return []
  const workIds = rows.map((r) => r.workId)

  const [files, links, editions] = await Promise.all([
    d
      .select({
        id: workFiles.id,
        workId: workFiles.workId,
        editionId: workFiles.editionId,
        kind: workFiles.kind,
        partId: workFiles.partId,
        label: workFiles.label,
        fileName: workFiles.fileName,
        pageCount: workFiles.pageCount,
        partName: parts.nameNo,
        partSort: parts.sortOrder,
      })
      .from(workFiles)
      .leftJoin(parts, eq(workFiles.partId, parts.id))
      .where(inArray(workFiles.workId, workIds)),
    d.select().from(workLinks).where(inArray(workLinks.workId, workIds)),
    d.select({ id: workEditions.id, workId: workEditions.workId, name: workEditions.name }).from(workEditions).where(inArray(workEditions.workId, workIds)).orderBy(asc(workEditions.createdAt), asc(workEditions.id)),
  ])

  return rows.map((r) => {
    const wf = files.filter((f) => f.workId === r.workId && f.editionId === r.editionId)
    const availableEditions = [{ id: null as string | null, name: 'Utgave 1' }, ...editions.filter((e) => e.workId === r.workId).map(({ id, name }) => ({ id, name }))]
    // Samme policy som fil-gaten: metadata kan ikke røpe stemmer som
    // nedlastings-API-et ville avvist.
    const partFiles = wf
      .filter((f) => f.kind === 'part' && memberCanSeeFile(f, access))
      .map((f) => ({ id: f.id, partId: f.partId, partName: f.partName, partSort: f.partSort ?? 900, pageCount: f.pageCount }))
      .sort((a, b) => a.partSort - b.partSort)
    const score = wf.find((f) => f.kind === 'score')
    return {
      ...r,
      editionName: availableEditions.find((e) => e.id === r.editionId)?.name ?? 'Ukjent utgave',
      editions: availableEditions,
      links: links.filter((l) => l.workId === r.workId).map((l) => ({ id: l.id, kind: l.kind, url: l.url, label: l.label })),
      partFiles,
      myFiles: wf
        .filter(
          (f) =>
            f.kind === 'part' &&
            f.partId &&
            access.effectivePartIds.includes(f.partId) &&
            memberCanSeeFile(f, access),
        )
        .map((f) => ({ id: f.id, partName: f.partName, fileName: f.fileName, pageCount: f.pageCount })),
      scoreFileId: score && memberCanAccessFile(score, access) ? score.id : null,
      audioFiles: wf
        .filter((f) => f.kind === 'audio' && memberCanSeeFile(f, access))
        .map((f) => ({ id: f.id, label: f.label, fileName: f.fileName })),
    }
  })
}

export const getHome = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()
  const today = new Date().toISOString().slice(0, 10)
  const canBrowseArchive = hasFullArchiveAccess(me)

  const upcoming = await d
    .select()
    .from(projects)
    // «Mine noter» er personlig: et spilleoppdrag står her bare for dem som er
    // med, også når den som ser siden kan administrere prosjekter.
    .where(and(eq(projects.isPublished, true), gte(projects.eventDate, today), visibleToMember(d, me.id)))
    .orderBy(asc(projects.eventDate))

  const next = upcoming[0] ?? null
  const nextPartIds =
    next && isGig(next)
      ? crewPartsFor(await crewPartIdsFor(d, next.id, me.id), me.effectivePartIds)
      : me.effectivePartIds
  const repertoire = next
    ? await assembleRepertoire(d, next.id, memberFileAccessContext(me, true, nextPartIds))
    : []

  const archive = canBrowseArchive
    ? await Promise.all([
        d.select({ n: sql<number>`count(*)` }).from(works),
        d.select({ n: sql<number>`count(*)` }).from(workFiles),
        d.select().from(works).orderBy(desc(works.createdAt)).limit(3),
      ]).then(([workCount, fileCount, latestWorks]) => ({
        stats: { works: workCount[0]?.n ?? 0, files: fileCount[0]?.n ?? 0 },
        latestWorks,
      }))
    : null

  // «Mine noter» er musikerens egen side, og et slagverksoppsett er ren støy
  // for en kornettist. Feltene fjernes derfor server-side for alle andre enn
  // slagverkerne og staben — UI-et skal ikke måtte huske regelen.
  const showPercussion = showPercussionFor(me)

  return {
    me: { name: me.name, parts: me.parts, roleName: me.roleName },
    // På et spilleoppdrag kan man ha fått en stemme uten å ha en til vanlig.
    nextHasParts: nextPartIds.length > 0,
    nextProject: next ? { ...next, percussionNotes: showPercussion ? next.percussionNotes : null } : null,
    repertoire: showPercussion ? repertoire : repertoire.map((r) => ({ ...r, percussionSetup: null })),
    showPercussion,
    upcoming: upcoming.slice(1),
    archive,
  }
})

export const listProjects = createServerFn()
  .validator(
    z
      .object({
        kind: z.enum(PROJECT_KINDS).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        sort: z.enum(PROJECT_SORTS).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const canManage = hasPermission(me, 'projects.manage')
    const canBrowseArchive = hasFullArchiveAccess(me)
    const today = new Date().toISOString().slice(0, 10)
    const sort = data?.sort ?? DEFAULT_PROJECT_SORT

    // Synligheten er uendret: ledelsen ser alt, arkivtilgang ser alt publisert,
    // øvrige kun publiserte prosjekter som ikke er avholdt.
    // Spilleoppdrag ses i tillegg bare av dem som er med.
    const visibility = canManage
      ? undefined
      : and(
          visibleToMember(d, me.id),
          canBrowseArchive
            ? eq(projects.isPublished, true)
            : and(eq(projects.isPublished, true), gte(projects.eventDate, today)),
        )

    const rows = await d
      .select({
        id: projects.id,
        name: projects.name,
        kind: projects.kind,
        eventDate: projects.eventDate,
        venue: projects.venue,
        isPublished: projects.isPublished,
        seasonName: seasons.name,
        seasonStartsOn: seasons.startsOn,
        workCount: sql<number>`(select count(*) from project_works pw where pw.project_id = ${projects.id})`,
      })
      .from(projects)
      .leftJoin(seasons, eq(projects.seasonId, seasons.id))
      // Brukerens filtre legges PÅ TOPPEN av synligheten, aldri i stedet for.
      .where(
        and(
          visibility,
          data?.kind ? eq(projects.kind, data.kind) : undefined,
          data?.status === 'kommende' ? gte(projects.eventDate, today) : undefined,
          data?.status === 'tidligere' ? lt(projects.eventDate, today) : undefined,
        ),
      )
      .orderBy(desc(projects.eventDate))

    // Rekkefølgen avgjøres i den rene modulen (enhetstestet), ikke i SQL:
    // sesongnavn sorterer ikke kronologisk, og «kommende først» er ikke
    // uttrykkbart som én ORDER BY uten å duplisere dagens dato-logikk.
    const sorted = sortProjects(rows, sort, today)
    return { seasons: groupBySeason(sorted, sort, today), count: sorted.length, canManage }
  })

export const getProject = createServerFn()
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const project = (await d.select().from(projects).where(eq(projects.id, data.id)).limit(1))[0]
    if (!project) throw new Error('Fant ikke prosjektet')

    const canManage = hasPermission(me, 'projects.manage')
    const canBrowseArchive = hasFullArchiveAccess(me)
    const today = new Date().toISOString().slice(0, 10)
    const gig = isGig(project)
    const crewPartIds = gig ? await crewPartIdsFor(d, project.id, me.id) : null
    const isCrew = crewPartIds !== null
    const readError = projectReadError(project, { canManage, canBrowseArchive, isCrew }, today)
    if (readError) throw new Error(readError)

    // Samme regel som fil-gaten: et oppdrag gir noter bare til dem som er med.
    const inAccessibleProject =
      project.isPublished && !!project.eventDate && project.eventDate >= today && (!gig || isCrew)
    const partIds = gig ? crewPartsFor(crewPartIds, me.effectivePartIds) : me.effectivePartIds
    const assignedIds = crewPartIds === null ? [] : parseCrewPartIds(crewPartIds)
    const [repertoire, stageSetups, crew, assignedParts, calloutRows] = await Promise.all([
      assembleRepertoire(d, project.id, memberFileAccessContext(me, inAccessibleProject, partIds)),
      listStageSetupsForProject(d, project.id),
      gig ? listCrew(d, project.id) : Promise.resolve(null),
      assignedIds.length > 0
        ? d
            .select({ id: parts.id, nameNo: parts.nameNo, nameEn: parts.nameEn, section: parts.section })
            .from(parts)
            .where(inArray(parts.id, assignedIds))
            .orderBy(asc(parts.sortOrder))
        : Promise.resolve(null),
      // Spørsmålet på veggen, bare for den som styrer oppdraget.
      gig && canManage
        ? d
            .select({ postId: postCallouts.postId, userId: calloutResponses.userId, status: calloutResponses.status, active: memberProfiles.isActive })
            .from(postCallouts)
            .leftJoin(calloutResponses, eq(calloutResponses.postId, postCallouts.postId))
            .leftJoin(memberProfiles, eq(memberProfiles.authUserId, calloutResponses.userId))
            .where(eq(postCallouts.projectId, project.id))
        : Promise.resolve([]),
    ])

    return {
      project,
      callout: calloutRows[0]
        ? { postId: calloutRows[0].postId, yes: calloutRows.filter((r) => r.status === 'yes' && r.active).length }
        : null,
      repertoire,
      canManage,
      canShare: hasPermission(me, 'shares.manage'),
      // Stemmene man spiller i DETTE prosjektet (stativet og vikardelingen).
      myParts: assignedParts ?? me.parts,
      // `null` for vanlige prosjekter. Hit kommer bare den som kan se oppdraget.
      crew,
      isCrew,
      // Den som ser prosjektet, ser oppsettene (samme regel, se `canReadStageSetups`).
      stageSetups,
      canEditStage: hasPermission(me, STAGE_PERMISSION),
    }
  })

export const createProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1, 'Navn er påkrevd'),
      kind: z.enum(PROJECT_KINDS),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato'),
      startTime: z.string().regex(START_TIME_PATTERN, 'Ugyldig klokkeslett').nullable().optional(),
      venue: z.string().optional(),
      description: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const id = newId()
    await d.insert(projects).values({
      id,
      name: data.name.trim(),
      kind: data.kind,
      eventDate: data.eventDate,
      startTime: data.startTime ?? null,
      venue: data.venue?.trim() || null,
      description: data.description?.trim() || null,
      seasonId: await findOrCreateSeason(d, data.eventDate),
      isPublished: false,
      createdAt: new Date(),
    })
    return { id }
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      kind: z.enum(PROJECT_KINDS).optional(),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      startTime: z.string().regex(START_TIME_PATTERN, 'Ugyldig klokkeslett').nullable().optional(),
      venue: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      percussionNotes: z.string().max(PERCUSSION_MAX_LENGTH * 4).nullable().optional(),
      isPublished: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const { id, ...patch } = data
    await d
      .update(projects)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        // Ny dato ⇒ ny sesong. Uten dette ble et prosjekt som flyttes over
        // vår/høst-grensen stående i den gamle sesongen for godt.
        ...(patch.eventDate !== undefined
          ? { eventDate: patch.eventDate, seasonId: await findOrCreateSeason(d, patch.eventDate) }
          : {}),
        ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
        ...(patch.venue !== undefined ? { venue: patch.venue?.trim() || null } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.percussionNotes !== undefined
          ? { percussionNotes: parsePercussionSetup(patch.percussionNotes) }
          : {}),
        ...(patch.isPublished !== undefined ? { isPublished: patch.isPublished } : {}),
      })
      .where(eq(projects.id, id))
    return { ok: true }
  })

export const deleteProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await db().delete(projects).where(eq(projects.id, data.id))
    return { ok: true }
  })

export const searchWorksForPicker = createServerFn()
  .validator(z.object({ q: z.string().optional(), excludeProjectId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const q = data.q?.trim()
    const inProject = d
      .select({ workId: projectWorks.workId })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.excludeProjectId))

    const rows = await d
      .select({ id: works.id, title: works.title, composer: works.composer, durationSec: works.durationSec })
      .from(works)
      .where(
        and(
          q ? or(like(works.title, `%${q}%`), like(works.composer, `%${q}%`)) : undefined,
          sql`${works.id} not in ${inProject}`,
        ),
      )
      .orderBy(asc(works.title))
      .limit(12)
    return { works: rows }
  })

export const addWorkToProject = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), workId: z.string(), note: z.string().optional() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const editionId = await resolveEdition(d, data.workId)
    const max = await d
      .select({ m: sql<number>`coalesce(max(position), 0)` })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
    await d.insert(projectWorks).values({
      projectId: data.projectId,
      workId: data.workId,
      editionId,
      position: (max[0]?.m ?? 0) + 1,
      note: data.note?.trim() || null,
    })
    return { ok: true }
  })

export const setProjectWorkEdition = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string().min(1), workId: z.string().min(1), editionId: z.string().min(1).nullable() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const editionId = await resolveEdition(d, data.workId, data.editionId)
    const selected = and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId))
    const row = (await d.select({ id: projectWorks.workId }).from(projectWorks).where(selected).limit(1))[0]
    if (!row) throw new Error('Verket finnes ikke i prosjektet')
    await d.update(projectWorks).set({ editionId }).where(selected)
    return { ok: true }
  })

/**
 * Slagverksoppsettet for ett stykke i ett prosjektet — «Timpani – Silje /
 * Trommesett – Karim». Skrivingen er gated på `projects.manage`; lesingen er
 * åpen for alle som ser prosjektet (`assembleRepertoire`).
 */
export const updateProjectWorkPercussion = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string(),
      workId: z.string(),
      percussionSetup: z.string().max(PERCUSSION_MAX_LENGTH * 4).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await db()
      .update(projectWorks)
      .set({ percussionSetup: parsePercussionSetup(data.percussionSetup) })
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId)))
    return { ok: true }
  })

export const removeWorkFromProject = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), workId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    await d
      .delete(projectWorks)
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId)))
    // Tetter hull i rekkefølgen
    const remaining = await d
      .select({ workId: projectWorks.workId })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
      .orderBy(asc(projectWorks.position))
    for (let i = 0; i < remaining.length; i++) {
      await d
        .update(projectWorks)
        .set({ position: i + 1 })
        .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, remaining[i]!.workId)))
    }
    return { ok: true }
  })

export const moveWorkInProject = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), workId: z.string(), direction: z.enum(['up', 'down']) }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const rows = await d
      .select({ workId: projectWorks.workId, position: projectWorks.position })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
      .orderBy(asc(projectWorks.position))

    const idx = rows.findIndex((r) => r.workId === data.workId)
    const swapWith = data.direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swapWith < 0 || swapWith >= rows.length) return { ok: true }

    const a = rows[idx]!
    const b = rows[swapWith]!
    await d
      .update(projectWorks)
      .set({ position: b.position })
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, a.workId)))
    await d
      .update(projectWorks)
      .set({ position: a.position })
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, b.workId)))
    return { ok: true }
  })

/** Save a complete program in one atomic D1 batch. Reject stale/invented lists. */
export const reorderProjectWorks = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), workIds: z.array(z.string()).min(1) }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const rows = await d.select({ workId: projectWorks.workId }).from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
    const ids = new Set(data.workIds)
    if (ids.size !== data.workIds.length || rows.length !== ids.size || rows.some(r => !ids.has(r.workId))) {
      throw new Error('Programmet er endret. Last siden på nytt og prøv igjen.')
    }
    const updates = data.workIds.map((workId, position) => d.update(projectWorks)
      .set({ position: position + 1 })
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, workId))))
    await d.batch([updates[0]!, ...updates.slice(1)])
    return { ok: true }
  })
