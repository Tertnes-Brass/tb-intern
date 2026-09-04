import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, inArray, like, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import {
  eventMeta,
  eventProjects,
  memberProfiles,
  parts,
  projectTimes,
  projectWorks,
  projects,
  seasons,
  user,
  userParts,
  workFiles,
  workLinks,
  works,
} from '../db/schema'
import { CALENDAR_PERMISSION } from '../lib/attendance'
import { newId } from '../lib/id'
import { PERCUSSION_MAX_LENGTH, parsePercussionSetup, showPercussionFor } from '../lib/percussion'
import {
  PROJECT_VISIBILITY_MESSAGES,
  isActiveProject,
  projectVisibility,
} from '../lib/project-access'
import {
  PRACTICAL_LABEL_MAX,
  PRACTICAL_LOCATION_MAX,
  PRACTICAL_NAME_MAX,
  PRACTICAL_NOTE_MAX,
  PRACTICAL_PHONE_MAX,
  PROJECT_TIME_AUDIENCES,
  PROJECT_TIME_KINDS,
  parseProjectTimeInput,
  sortProjectTimes,
} from '../lib/practical'
import {
  hasFullArchiveAccess,
  hasPermission,
  memberFileAccessContext,
  requireMe,
  requirePermission,
} from './access'
import { loadCalendar } from './calendar-feed'
import { type AccessCtx, memberCanAccessFile, memberCanSeeFile } from './file-access'
import { loadProjectPractice } from './practice'
import { loadProjectSoloists } from './soloists'
import { loadProjectPercussionNeeds } from './work-percussion'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_KINDS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
  groupBySeason,
  seasonForDate,
  sortProjects,
} from './project-list'

export type ProjectWorkDetail = {
  workId: string
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

  const [files, links] = await Promise.all([
    d
      .select({
        id: workFiles.id,
        workId: workFiles.workId,
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
  ])

  return rows.map((r) => {
    const wf = files.filter((f) => f.workId === r.workId)
    // Samme policy som fil-gaten: metadata kan ikke røpe stemmer som
    // nedlastings-API-et ville avvist.
    const partFiles = wf
      .filter((f) => f.kind === 'part' && memberCanSeeFile(f, access))
      .map((f) => ({ id: f.id, partId: f.partId, partName: f.partName, partSort: f.partSort ?? 900, pageCount: f.pageCount }))
      .sort((a, b) => a.partSort - b.partSort)
    const score = wf.find((f) => f.kind === 'score')
    return {
      ...r,
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
    .where(and(eq(projects.isPublished, true), gte(projects.eventDate, today)))
    .orderBy(asc(projects.eventDate))

  const next = upcoming[0] ?? null
  const repertoire = next
    ? await assembleRepertoire(d, next.id, memberFileAccessContext(me, true))
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
    me: { name: me.name, parts: me.parts, roleNames: me.roles.map((r) => r.name) },
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
    const visibility = canManage
      ? undefined
      : canBrowseArchive
        ? eq(projects.isPublished, true)
        : and(eq(projects.isPublished, true), gte(projects.eventDate, today))

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
    // Synlighetstrappen er én ren funksjon (`src/lib/project-access.ts`), delt
    // med skrivestien for øvingsstatus (#30) — to steder som gjentok den samme
    // rekken betingelser ville før eller siden gitt hvert sitt svar.
    const visibility = projectVisibility(project, { canManage, canBrowseArchive }, today)
    if (visibility !== 'ok') throw new Error(PROJECT_VISIBILITY_MESSAGES[visibility])

    const inAccessibleProject = isActiveProject(project, today)
    const [repertoire, times, rehearsals, soloists, percussionNeeds, practice] = await Promise.all([
      assembleRepertoire(d, project.id, memberFileAccessContext(me, inAccessibleProject)),
      loadProjectTimes(d, project.id),
      loadProjectRehearsals(d, project.id),
      loadProjectSoloists(d, project.id),
      loadProjectPercussionNeeds(d, project.id),
      loadProjectPractice(d, me, project.id),
    ])

    return {
      project,
      repertoire,
      times,
      rehearsals,
      // #50: solistene per verk, gruppert på workId. Lesing er åpen for alle som
      // ser prosjektet; redigering krever `projects.manage` (src/server/soloists.ts).
      soloists,
      // #34: det samlede slagverksbehovet for hele repertoaret — riggelista.
      percussionNeeds,
      // #30: min egen status, tallene, og navnene leseren faktisk får se.
      practice,
      canManage,
      canManageCalendar: hasPermission(me, CALENDAR_PERMISSION),
      canShare: hasPermission(me, 'shares.manage'),
      myParts: me.parts,
    }
  })

// ---------- Tidsplan (#9) ----------

export type ProjectTimeRow = {
  id: string
  kind: string
  label: string | null
  date: string
  time: string | null
  location: string | null
  audience: string
  note: string | null
  /** Medlemmet som er ansvarlig — for å kunne forhåndsvelge det i skjemaet. */
  responsibleUserId: string | null
  /** Navnet som skal vises: medlemmets NÅVÆRENDE navn, ellers fritekstnavnet. */
  responsibleName: string | null
  contactPhone: string | null
  createdAt: number
}

/**
 * Tidsplanen for ett prosjekt, kronologisk.
 *
 * Navnet på ansvarlig slås alltid opp ferskt mot `user` (som omtaler i #83):
 * har hen byttet navn, skal tidsplanen vise det nye. Fritekstnavnet brukes bare
 * når ingen medlemsrad er valgt.
 *
 * Rekkefølgen avgjøres i `sortProjectTimes` (enhetstestet), ikke i SQL: et
 * punkt uten klokkeslett skal sist på dagen, og `ORDER BY time` ville lagt
 * NULL først i SQLite.
 */
async function loadProjectTimes(d: Db, projectId: string): Promise<ProjectTimeRow[]> {
  const rows = await d
    .select({
      id: projectTimes.id,
      kind: projectTimes.kind,
      label: projectTimes.label,
      date: projectTimes.date,
      time: projectTimes.time,
      location: projectTimes.location,
      audience: projectTimes.audience,
      note: projectTimes.note,
      responsibleUserId: projectTimes.responsibleUserId,
      responsibleName: projectTimes.responsibleName,
      contactPhone: projectTimes.contactPhone,
      createdAt: projectTimes.createdAt,
      memberName: user.name,
    })
    .from(projectTimes)
    .leftJoin(user, eq(projectTimes.responsibleUserId, user.id))
    .where(eq(projectTimes.projectId, projectId))

  return sortProjectTimes(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      date: row.date,
      time: row.time,
      location: row.location,
      audience: row.audience,
      note: row.note,
      responsibleUserId: row.responsibleUserId,
      responsibleName: row.memberName ?? row.responsibleName,
      contactPhone: row.contactPhone,
      createdAt: row.createdAt.getTime(),
    })),
  )
}

// ---------- Oppkjøring: øvingene som hører til prosjektet (#10) ----------

export type ProjectRehearsal = {
  occurrenceKey: string
  title: string
  /** Epoch-ms. Fra feeden når hendelsen finnes der, ellers fra snapshotet. */
  start: number
  /** Hendelsen finnes fortsatt i kalenderfeeden. */
  inCalendar: boolean
  location: string | null
  meetupCrew: string | null
  meetupMusicians: string | null
  conductor: string | null
  setlistCount: number
}

/**
 * Øvingene som peker på prosjektet (#10), kronologisk.
 *
 * Kalenderen er sannheten om tittel og tidspunkt så lenge hendelsen finnes der;
 * `event_meta`-snapshotet er reserveløsningen. En øvelse som har falt ut av
 * firemånedersvinduet — eller er slettet i Google — forsvinner derfor ikke fra
 * oppkjøringsplanen, den vises med det vi visste sist og merkes `inCalendar:
 * false`. Det er samme regel som detaljruta: lokale data slettes aldri fordi
 * feeden endrer seg.
 *
 * Feeden hentes bare når prosjektet FAKTISK har koblede øvinger, og gjennom
 * `loadCalendar` — samme ti-minutters cache som `/kalender` og hub-en bruker.
 */
async function loadProjectRehearsals(d: Db, projectId: string): Promise<ProjectRehearsal[]> {
  const rows = await d
    .select({
      occurrenceKey: eventProjects.occurrenceKey,
      summary: eventMeta.summary,
      start: eventMeta.start,
      locationName: eventMeta.locationName,
      meetupCrew: eventMeta.meetupCrew,
      meetupMusicians: eventMeta.meetupMusicians,
      conductor: eventMeta.conductor,
      setlistCount: sql<number>`(select count(*) from event_setlist es where es.occurrence_key = ${eventProjects.occurrenceKey})`,
    })
    .from(eventProjects)
    .innerJoin(eventMeta, eq(eventProjects.occurrenceKey, eventMeta.occurrenceKey))
    .where(eq(eventProjects.projectId, projectId))

  if (rows.length === 0) return []

  const calendar = await loadCalendar(Date.now())
  const byKey = new Map(calendar.events.map((event) => [event.occurrenceKey, event]))

  return rows
    .map((row): ProjectRehearsal => {
      const live = byKey.get(row.occurrenceKey) ?? null
      return {
        occurrenceKey: row.occurrenceKey,
        title: live?.title ?? row.summary,
        start: live ? Date.parse(live.start) : row.start.getTime(),
        inCalendar: live !== null,
        // Stedet fra den praktiske infoen går foran kalenderens egen
        // lokasjon: den er skrevet av noen som vet hvor vi faktisk skal.
        location: row.locationName ?? live?.location ?? null,
        meetupCrew: row.meetupCrew,
        meetupMusicians: row.meetupMusicians,
        conductor: row.conductor,
        setlistCount: row.setlistCount,
      }
    })
    .sort((a, b) => a.start - b.start)
}

export const createProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1, 'Navn er påkrevd'),
      kind: z.enum(PROJECT_KINDS),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato'),
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
      venue: data.venue?.trim() || null,
      description: data.description?.trim() || null,
      seasonId: await findOrCreateSeason(d, data.eventDate),
      isPublished: false,
      createdAt: new Date(),
    })
    return { id }
  })

/**
 * Sesongen datoen hører til, opprettet ved behov. Slår opp på DATOINTERVALL og
 * ikke på navn: en sesong som er døpt om for hånd («Jubileumshøsten 2026») skal
 * gjenbrukes, ikke få en duplikat med standardnavnet ved siden av seg.
 */
async function findOrCreateSeason(d: Db, eventDate: string): Promise<string> {
  const existing = await d
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(lte(seasons.startsOn, eventDate), gte(seasons.endsOn, eventDate)))
    .orderBy(asc(seasons.startsOn))
    .limit(1)
  if (existing[0]) return existing[0].id
  const id = newId()
  await d.insert(seasons).values({ id, ...seasonForDate(eventDate) })
  return id
}

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      kind: z.enum(PROJECT_KINDS).optional(),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
    const max = await d
      .select({ m: sql<number>`coalesce(max(position), 0)` })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
    await d.insert(projectWorks).values({
      projectId: data.projectId,
      workId: data.workId,
      position: (max[0]?.m ?? 0) + 1,
      note: data.note?.trim() || null,
    })
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

// ---------- Tidsplan: skriving (#9) ----------

/**
 * Feltene i ett tidspunkt. `nullish` overalt fordi skjemaet sender tomme felt
 * som tom streng eller `null`; `parseProjectTimeInput` avgjør hva som er
 * gyldig, slik at serveren og skjemaet ikke kan ha hver sin mening om det.
 * Takene her er romslige (×4) — den EKTE kuttingen skjer i den rene modulen.
 */
const projectTimeFields = {
  kind: z.enum(PROJECT_TIME_KINDS).optional(),
  label: z.string().max(PRACTICAL_LABEL_MAX * 4).nullish(),
  date: z.string().max(32),
  time: z.string().max(32).nullish(),
  location: z.string().max(PRACTICAL_LOCATION_MAX * 4).nullish(),
  audience: z.enum(PROJECT_TIME_AUDIENCES).optional(),
  note: z.string().max(PRACTICAL_NOTE_MAX * 4).nullish(),
  responsibleUserId: z.string().max(64).nullish(),
  responsibleName: z.string().max(PRACTICAL_NAME_MAX * 4).nullish(),
  contactPhone: z.string().max(PRACTICAL_PHONE_MAX * 4).nullish(),
}

/**
 * Ansvarlig må være et AKTIVT medlem. Uten sjekken kunne et rått kall pekt på
 * en hvilken som helst bruker-id — også en deaktivert konto — og navnet ville
 * dukket opp på en side hele korpset leser.
 */
async function assertResponsibleMember(d: Db, userId: string | null): Promise<void> {
  if (!userId) return
  const rows = await d
    .select({ isActive: memberProfiles.isActive })
    .from(memberProfiles)
    .where(eq(memberProfiles.authUserId, userId))
    .limit(1)
  if (!rows[0] || !rows[0].isActive) throw new Error('Ukjent eller deaktivert medlem')
}

export const addProjectTime = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string(), ...projectTimeFields }))
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const d = db()
    const value = parseProjectTimeInput(data)
    const project = await d.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).limit(1)
    if (!project[0]) throw new Error('Fant ikke prosjektet')
    await assertResponsibleMember(d, value.responsibleUserId)
    const now = new Date()
    await d.insert(projectTimes).values({
      id: newId(),
      projectId: data.projectId,
      ...value,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    return { ok: true }
  })

/**
 * Hele raden skrives om — som `updateEventPractical`. Skjemaet er ett lite
 * skjema med åtte felt, og en delvis oppdatering ville krevd at «tomt felt» og
 * «ikke sendt» kunne skilles for hvert av dem.
 */
export const updateProjectTime = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string(), ...projectTimeFields }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    const d = db()
    const value = parseProjectTimeInput(data)
    await assertResponsibleMember(d, value.responsibleUserId)
    // `projectId` er med i WHERE, ikke bare i validatoren: id-en alene ville
    // latt et rått kall redigere et tidspunkt i et annet prosjekt.
    await d
      .update(projectTimes)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectTimes.id, data.id), eq(projectTimes.projectId, data.projectId)))
    return { ok: true }
  })

export const removeProjectTime = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await db()
      .delete(projectTimes)
      .where(and(eq(projectTimes.id, data.id), eq(projectTimes.projectId, data.projectId)))
    return { ok: true }
  })

/**
 * De aktive medlemmene, til «ansvarlig»-velgeren i tidsplanen. Gated på
 * `projects.manage` — det er den som setter opp tidsplanen som velger.
 *
 * Hele lista, ikke et søk: korpset er tretti personer, og en nedtrekksliste
 * uten søkefelt er raskere enn en debouncet spørring per tastetrykk.
 *
 * **Telefonnummeret følger medlemslista sin regel, ikke prosjektets.**
 * `listMembers` gir bare `phone` til `members.manage`, fordi telefonnummer er
 * administrasjonsdata og ikke katalogdata. Den regelen gjentas her: har du den
 * ikke, får du navnet og stemmen, og skriver et kontaktnummer selv. Nummeret
 * som til slutt står på tidspunktet er alltid et BEVISST publisert
 * kontaktpunkt for akkurat den oppgaven — aldri profilen speilet ut til hele
 * korpset av seg selv.
 */
export const listProjectMembers = createServerFn().handler(async () => {
  const me = await requirePermission('projects.manage')
  const d = db()
  const canSeePhone = hasPermission(me, 'members.manage')

  const rows = await d
    .select({
      id: user.id,
      name: user.name,
      phone: memberProfiles.phone,
      partName: parts.nameNo,
      partSort: parts.sortOrder,
      isPrimary: userParts.isPrimary,
    })
    .from(memberProfiles)
    .innerJoin(user, eq(memberProfiles.authUserId, user.id))
    .leftJoin(userParts, eq(userParts.userId, user.id))
    .leftJoin(parts, eq(userParts.partId, parts.id))
    .where(eq(memberProfiles.isActive, true))

  const byId = new Map<string, { id: string; name: string; phone: string | null; partName: string | null; rank: number }>()
  for (const row of rows) {
    // Primærstemmen først, ellers laveste sortOrder — samme regel som
    // medlemslista, så et navn ikke får to ulike stemmer to steder.
    const rank = (row.isPrimary ? 0 : 1) * 10_000 + (row.partSort ?? 999)
    const current = byId.get(row.id)
    if (!current) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        phone: canSeePhone ? row.phone : null,
        partName: row.partName,
        rank,
      })
    } else if (rank < current.rank) {
      current.partName = row.partName
      current.rank = rank
    }
  }

  return {
    members: [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
      .map(({ rank: _rank, ...member }) => member),
    canSeePhone,
  }
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
