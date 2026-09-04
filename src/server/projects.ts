import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, inArray, like, lt, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { db, type Db } from '../db'
import {
  eventMeta,
  eventProjects,
  memberProfiles,
  partShares,
  parts,
  projectComments,
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
import { formatDate } from '../lib/format'
import { newId } from '../lib/id'
import { type PartShareRow, sortPartShares } from '../lib/part-shares'
import { canManageRigList } from '../lib/rigg'
import { PERCUSSION_MAX_LENGTH, parsePercussionSetup, showPercussionFor } from '../lib/percussion'
import {
  PRACTICAL_LABEL_MAX,
  PRACTICAL_LOCATION_MAX,
  PRACTICAL_NAME_MAX,
  PRACTICAL_NOTE_MAX,
  PRACTICAL_PHONE_MAX,
  PROJECT_TIME_AUDIENCES,
  PROJECT_TIME_KINDS,
  parseProjectTimeInput,
  projectTimeTitle,
  sortProjectTimes,
} from '../lib/practical'
import {
  PROJECT_COMMENT_MAX,
  type ProjectCommentRow,
  type ProjectCommentThread,
  canDeleteProjectComment,
  threadsFrom,
} from '../lib/project-comments'
import type { ProjectNotifyResult } from '../lib/project-notify'
import {
  hasFullArchiveAccess,
  hasPermission,
  memberFileAccessContext,
  requireMe,
  requirePermission,
} from './access'
import { loadCalendar } from './calendar-feed'
import { type AccessCtx, memberCanAccessFile, memberCanSeeFile, sharedFileFrom } from './file-access'
import { loadProjectPractice } from './practice'
import { loadProjectSoloists } from './soloists'
import { loadProjectPercussionNeeds } from './work-percussion'
import {
  type ProjectNotifyState,
  notifyProjectPublished,
  notifyProjectUpdate,
  projectNotifyState,
  recordProjectChange,
} from './project-notify'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_KINDS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
  groupBySeason,
  seasonForDate,
  sortProjects,
} from './project-list'
import { loadVisibleProject } from './project-access'
import { loadRigItems } from './rig-store'
import { loadStagePlotSummary } from './scene-store'

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
  /**
   * Stemmefiler et annet medlem har delt med meg (#16). Egen liste, ikke slått
   * sammen med `myFiles`: en lånt stemme skal vises som lånt, med navnet på den
   * som lånte den bort. Alltid tom i vikarvisningen — den løypa har ingen konto
   * og dermed ingen delinger.
   */
  sharedFiles: Array<{
    id: string
    partName: string | null
    fileName: string
    pageCount: number | null
    fromName: string
  }>
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
      // Lånte stemmer (#16). `sharedFileFrom` er den samme kilden som gaten
      // bruker, så lista kan ikke vise en fil nedlastings-API-et ville avvist —
      // og den kan heller ikke skrive feil navn på den som delte.
      sharedFiles: wf.flatMap((f) => {
        const fromName = sharedFileFrom(f, access)
        if (!fromName || !memberCanSeeFile(f, access)) return []
        return [{ id: f.id, partName: f.partName, fileName: f.fileName, pageCount: f.pageCount, fromName }]
      }),
      scoreFileId: score && memberCanAccessFile(score, access) ? score.id : null,
      audioFiles: wf
        .filter((f) => f.kind === 'audio' && memberCanSeeFile(f, access))
        .map((f) => ({ id: f.id, label: f.label, fileName: f.fileName })),
    }
  })
}

/**
 * Delingene DU har gitt bort (#16) — motstykket til mottakersiden, som
 * `currentUser()` allerede har slått opp. Mottakerens navn slås alltid opp
 * ferskt mot `user`, som ellers i basen.
 *
 * En deaktivert mottaker mister tilgangen uansett (`requireMe()` avviser hen),
 * men raden skal fortsatt vises for deleren — ellers ville en deling forsvunnet
 * fra oversikten uten at noen fjernet den, og da kunne den ikke fjernes heller.
 *
 * Ligger her, ikke i `part-shares.ts`: den modulen importeres av en
 * rutekomponent, og en levende eksport der ville dratt `cloudflare:workers` inn
 * i klientbygget.
 */
async function loadSharesGivenBy(d: Db, userId: string): Promise<PartShareRow[]> {
  const rows = await d
    .select({
      memberId: partShares.toUserId,
      memberName: user.name,
      partId: partShares.partId,
      partName: parts.nameNo,
    })
    .from(partShares)
    .innerJoin(user, eq(user.id, partShares.toUserId))
    .innerJoin(parts, eq(parts.id, partShares.partId))
    .where(eq(partShares.fromUserId, userId))
  return sortPartShares(rows)
}

export const getHome = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()
  const today = new Date().toISOString().slice(0, 10)
  const canBrowseArchive = hasFullArchiveAccess(me)

  const [upcoming, sharesGiven] = await Promise.all([
    d
      .select()
      .from(projects)
      .where(and(eq(projects.isPublished, true), gte(projects.eventDate, today)))
      .orderBy(asc(projects.eventDate)),
    loadSharesGivenBy(d, me.id),
  ])

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
  //
  // En LÅNT slagverksstemme (#16) teller bevisst IKKE med. Det ble prøvd, fordi
  // en lånt slagverksstemme uten oppsettet er en halv leveranse — men
  // `showPercussion` er ikke avgrenset til den lånte stemmen: den åpner
  // `percussionNotes` for HELE konserten og `percussionSetup` på ALLE verk, også
  // dem låntakeren ikke har en eneste fil på. Da gir delingen mer enn
  // stemme-lesing, og det er den ene tingen den aldri skal gjøre. Trenger en
  // låntaker oppsettet, er riktig svar en stemmetildeling — ikke et lån.
  const showPercussion = showPercussionFor(me)

  return {
    me: { name: me.name, parts: me.parts, roleNames: me.roles.map((r) => r.name) },
    nextProject: next ? { ...next, percussionNotes: showPercussion ? next.percussionNotes : null } : null,
    repertoire: showPercussion ? repertoire : repertoire.map((r) => ({ ...r, percussionSetup: null })),
    showPercussion,
    upcoming: upcoming.slice(1),
    archive,
    /**
     * Stemmedeling (#16). `received` kommer fra `currentUser()`, som allerede
     * har slått opp delingene for fil-gaten — panelet og gaten ser dermed
     * nøyaktig de samme delingene, og en deling som har sluttet å virke fordi
     * deleren mistet stemmen, forsvinner begge steder samtidig.
     */
    partShares: {
      given: sharesGiven,
      received: sortPartShares(
        me.sharedParts.map((s) => ({
          memberId: s.fromUserId,
          memberName: s.fromName,
          partId: s.partId,
          partName: s.partNameNo,
        })),
      ),
    },
    meId: me.id,
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
    // Synlighetsregelen bor i `project-access.ts` — den deles nå med
    // sceneoppsettet (#11) og riggelista (#12), og skal finnes ett sted.
    const { project, canManage, inAccessibleProject } = await loadVisibleProject(d, data.id, me)

    const canManageRig = canManageRigList(me.permissions)
    const [repertoire, times, rehearsals, soloists, percussionNeeds, practice, comments, rigItemRows, stage, rigMembers] =
      await Promise.all([
      assembleRepertoire(d, project.id, memberFileAccessContext(me, inAccessibleProject)),
      loadProjectTimes(d, project.id),
      loadProjectRehearsals(d, project.id),
      loadProjectSoloists(d, project.id),
      loadProjectPercussionNeeds(d, project.id),
      loadProjectPractice(d, me, project.id),
      loadProjectComments(d, project.id),
      // Riggelista (#12) og sceneoppsettet (#11) hentes i SAMME runde som
      // resten av dashboardet. To ekstra serverkall ville kostet to rundturer
      // for to seksjoner som uansett alltid vises sammen med programmet.
      loadRigItems(d, { kind: 'project', projectId: project.id }),
      loadStagePlotSummary(d, project.id),
      // Velgerlista sendes kun til den som kan skrive — en medlemsliste er
      // data, ikke pynt (samme regel som i `utstyr.ts` og `rigg.ts`).
      canManageRig
        ? d
            .select({ id: user.id, name: user.name })
            .from(memberProfiles)
            .innerJoin(user, eq(memberProfiles.authUserId, user.id))
            .where(eq(memberProfiles.isActive, true))
            .orderBy(asc(user.name))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
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
      // #27: kommentartråden — spørsmål fra medlemmene, svar fra prosjektansvarlig.
      comments,
      rig: { items: rigItemRows, memberOptions: rigMembers },
      stage,
      canManage,
      canManageCalendar: hasPermission(me, CALENDAR_PERMISSION),
      canManageRig,
      canShare: hasPermission(me, 'shares.manage'),
      myParts: me.parts,
      meId: me.id,
      // Varslingsstatus er et skriveverktøy: hvem som har fått e-post og hva et
      // endringsvarsel ville sagt. Medlemmer skal ikke se mottakerlista, og
      // spørringene kjøres derfor ikke i det hele tatt for dem.
      notify: canManage && project.isPublished ? await projectNotifyState(project.id) : null,
    }
  })

/** Statusen prosjektsiden viser om varsling. `null` for alle uten `projects.manage`. */
export type { ProjectNotifyState }

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
    const me = await requirePermission('projects.manage')
    const d = db()
    const { id, ...patch } = data
    // Verdiene FØR endringen: uten dem kan ikke endringsloggen (#51) si hva som
    // faktisk ble annerledes, og et «lagre» uten endringer ville blitt en linje
    // i neste varsel-e-post.
    const before = (await d.select().from(projects).where(eq(projects.id, id)).limit(1))[0]
    if (!before) throw new Error('Fant ikke prosjektet')

    const next = {
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
    }
    await d.update(projects).set(next).where(eq(projects.id, id))

    // Endringsloggen skrives ETTER lagringen, og bare for det som faktisk er
    // annerledes. `recordProjectChange` hopper selv over upubliserte prosjekter.
    if (next.name !== undefined && next.name !== before.name) {
      await recordProjectChange({ projectId: id, kind: 'name_changed', detail: next.name, actorUserId: me.id })
    }
    if (next.eventDate !== undefined && next.eventDate !== before.eventDate) {
      await recordProjectChange({
        projectId: id,
        kind: 'date_changed',
        detail: formatDate(next.eventDate),
        actorUserId: me.id,
      })
    }
    if (next.venue !== undefined && next.venue !== before.venue) {
      await recordProjectChange({ projectId: id, kind: 'venue_changed', detail: next.venue, actorUserId: me.id })
    }
    if (next.description !== undefined && next.description !== before.description) {
      await recordProjectChange({ projectId: id, kind: 'info_changed', actorUserId: me.id })
    }
    if (next.percussionNotes !== undefined && next.percussionNotes !== before.percussionNotes) {
      await recordProjectChange({ projectId: id, kind: 'percussion_notes', actorUserId: me.id })
    }
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
    const me = await requirePermission('projects.manage')
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
    await recordProjectChange({
      projectId: data.projectId,
      kind: 'work_added',
      subject: await workTitle(d, data.workId),
      actorUserId: me.id,
    })
    return { ok: true }
  })

/** Tittelen på et verk, til endringsloggen. Null når verket er borte. */
async function workTitle(d: Db, workId: string): Promise<string | null> {
  const rows = await d.select({ title: works.title }).from(works).where(eq(works.id, workId)).limit(1)
  return rows[0]?.title ?? null
}

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
    const me = await requirePermission('projects.manage')
    const d = db()
    const setup = parsePercussionSetup(data.percussionSetup)
    const before = (
      await d
        .select({ percussionSetup: projectWorks.percussionSetup })
        .from(projectWorks)
        .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId)))
        .limit(1)
    )[0]
    await d
      .update(projectWorks)
      .set({ percussionSetup: setup })
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId)))
    if (before && before.percussionSetup !== setup) {
      await recordProjectChange({
        projectId: data.projectId,
        kind: 'work_percussion',
        subject: await workTitle(d, data.workId),
        actorUserId: me.id,
      })
    }
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
    await recordProjectChange({
      projectId: data.projectId,
      kind: 'time_added',
      subject: projectTimeTitle(value),
      detail: whenLabel(value),
      actorUserId: me.id,
    })
    return { ok: true }
  })

/** «15. november 2026 kl. 09:00», eller bare datoen når klokkeslettet mangler. */
function whenLabel(value: { date: string; time: string | null }): string {
  const date = formatDate(value.date)
  return value.time ? `${date} kl. ${value.time}` : date
}

/**
 * Hele raden skrives om — som `updateEventPractical`. Skjemaet er ett lite
 * skjema med åtte felt, og en delvis oppdatering ville krevd at «tomt felt» og
 * «ikke sendt» kunne skilles for hvert av dem.
 */
export const updateProjectTime = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string(), ...projectTimeFields }))
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const d = db()
    const value = parseProjectTimeInput(data)
    await assertResponsibleMember(d, value.responsibleUserId)
    // `projectId` er med i WHERE, ikke bare i validatoren: id-en alene ville
    // latt et rått kall redigere et tidspunkt i et annet prosjekt.
    await d
      .update(projectTimes)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectTimes.id, data.id), eq(projectTimes.projectId, data.projectId)))
    await recordProjectChange({
      projectId: data.projectId,
      kind: 'time_changed',
      subject: projectTimeTitle(value),
      detail: whenLabel(value),
      actorUserId: me.id,
    })
    return { ok: true }
  })

export const removeProjectTime = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), projectId: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const d = db()
    // Navnet hentes før slettingen — etterpå finnes det ikke.
    const before = (
      await d
        .select({ kind: projectTimes.kind, label: projectTimes.label })
        .from(projectTimes)
        .where(and(eq(projectTimes.id, data.id), eq(projectTimes.projectId, data.projectId)))
        .limit(1)
    )[0]
    await d
      .delete(projectTimes)
      .where(and(eq(projectTimes.id, data.id), eq(projectTimes.projectId, data.projectId)))
    if (before) {
      await recordProjectChange({
        projectId: data.projectId,
        kind: 'time_removed',
        subject: projectTimeTitle(before),
        actorUserId: me.id,
      })
    }
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
    const me = await requirePermission('projects.manage')
    const d = db()
    // Tittelen hentes FØR slettingen — etterpå er koblingen borte, og
    // endringsloggen ville stått igjen med «Et verk er tatt ut av programmet».
    const title = await workTitle(d, data.workId)
    await d
      .delete(projectWorks)
      .where(and(eq(projectWorks.projectId, data.projectId), eq(projectWorks.workId, data.workId)))
    await recordProjectChange({
      projectId: data.projectId,
      kind: 'work_removed',
      subject: title,
      actorUserId: me.id,
    })
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
    const me = await requirePermission('projects.manage')
    const d = db()
    const rows = await d
      .select({ workId: projectWorks.workId, position: projectWorks.position })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, data.projectId))
      .orderBy(asc(projectWorks.position))

    const idx = rows.findIndex((r) => r.workId === data.workId)
    const swapWith = data.direction === 'up' ? idx - 1 : idx + 1
    // Ingen endring skjedde (allerede øverst/nederst) ⇒ ingen linje i loggen.
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
    // Uten emne: ti flyttinger blir én linje i varselet («Rekkefølgen i
    // programmet er endret»), fordi `summarizeProjectChanges` deduperer på
    // setningen. Ett varsel per klikk ville vært nøyaktig den spammingen #51
    // ber oss unngå.
    await recordProjectChange({ projectId: data.projectId, kind: 'work_order', actorUserId: me.id })
    return { ok: true }
  })

// ---------- Publisering og varsling (#18 + #51) ----------

/**
 * Publiserer prosjektet, og sender (valgfritt) e-post til medlemmene.
 *
 * Egen funksjon i stedet for `updateProject({ isPublished: true })`, av samme
 * grunn som `publishPost` er skilt fra `updatePost` på veggen: publisering er en
 * handling med en konsekvens utenfor databasen, og den skal ha sin egen dialog,
 * sitt eget svar og sin egen kvittering.
 *
 * Avkryssingen er AVSLÅTT som standard (`DEFAULT_PROJECT_NOTIFY`). Et prosjekt
 * publiseres ofte lenge før programmet er ferdig — da skal det ikke være nok å
 * overse en avkrysning for å sende e-post til hele korpset.
 *
 * Et prosjekt som allerede er publisert beholder sin status; kallet blir da en
 * ren varsling, og loggen sørger for at ingen får e-posten to ganger.
 */
export const publishProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), notify: z.boolean().default(false) }))
  .handler(async ({ data }): Promise<ProjectNotifyResult & { ok: true }> => {
    await requirePermission('projects.manage')
    const d = db()
    const project = (await d.select({ id: projects.id }).from(projects).where(eq(projects.id, data.id)).limit(1))[0]
    if (!project) throw new Error('Fant ikke prosjektet')

    await d.update(projects).set({ isPublished: true }).where(eq(projects.id, data.id))

    if (!data.notify) return { ok: true, sent: 0, logged: 0, failed: 0, skipped: 0 }
    try {
      return { ok: true, ...(await notifyProjectPublished(data.id)) }
    } catch (err) {
      // Prosjektet ER publisert — det er den viktige delen. En feilende
      // utsending skal aldri rulle det tilbake, og den skal ikke se ut som en
      // vellykket sending heller.
      console.error('[prosjektvarsling] kunne ikke sende publiseringsvarsel:', err)
      return { ok: true, sent: 0, logged: 0, failed: 0, skipped: 0 }
    }
  })

/**
 * Avpubliserer. `project_notifications` beholdes med vilje — publiseres
 * prosjektet igjen, skal ingen få det samme varselet to ganger.
 */
export const unpublishProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await db().update(projects).set({ isPublished: false }).where(eq(projects.id, data.id))
    return { ok: true }
  })

/** Idempotent «send på nytt»: går kun til dem som mangler en `published`-rad. */
export const resendProjectNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<ProjectNotifyResult & { ok: true }> => {
    await requirePermission('projects.manage')
    return { ok: true, ...(await notifyProjectPublished(data.id)) }
  })

/**
 * Endringsvarselet (#51): ÉN e-post med alt som er endret i repertoar, tidsplan
 * og prosjektopplysninger siden forrige varsel.
 *
 * En bevisst handling, ikke en automatikk. Alternativet — å sende ved hver
 * lagring — er nøyaktig det saken advarer mot: «dette må ikkje bli for mange
 * meldingar, slik at medlemmene blir irriterte eller begynner å ignorere
 * varsla». Stille lagring er standarden; dette er knappen for når det er verdt
 * det.
 */
export const sendProjectUpdate = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<ProjectNotifyResult & { ok: true; changes: number }> => {
    await requirePermission('projects.manage')
    return { ok: true, ...(await notifyProjectUpdate(data.id)) }
  })

// ---------- Kommentarer og spørsmål (#27) ----------

/**
 * Tråder med svar, klare til visning.
 *
 * Alle som ser prosjektet ser kommentarene — det er hele poenget med å legge
 * dem her og ikke i et forum bak enda en innlogging. Tilgangen er derfor
 * `getProject` sin: er du inne på siden, er tråden din også.
 */
async function loadProjectComments(d: Db, projectId: string): Promise<ProjectCommentThread[]> {
  const resolver = alias(user, 'resolver')
  const rows = await d
    .select({
      id: projectComments.id,
      parentId: projectComments.parentId,
      body: projectComments.body,
      authorId: projectComments.authorId,
      authorName: user.name,
      createdAt: projectComments.createdAt,
      resolvedAt: projectComments.resolvedAt,
      resolvedByName: resolver.name,
    })
    .from(projectComments)
    .leftJoin(user, eq(projectComments.authorId, user.id))
    .leftJoin(resolver, eq(projectComments.resolvedBy, resolver.id))
    .where(eq(projectComments.projectId, projectId))
    .orderBy(asc(projectComments.createdAt))

  return threadsFrom(
    rows.map(
      (r): ProjectCommentRow => ({
        id: r.id,
        parentId: r.parentId,
        body: r.body,
        // Navnet slås opp ferskt, som ellers i basen: bytter noen navn, følger
        // kommentaren med. En slettet konto blir «Ukjent», aldri et gammelt navn.
        author: { id: r.authorId, name: r.authorName ?? 'Ukjent' },
        createdAt: r.createdAt.getTime(),
        resolvedAt: r.resolvedAt?.getTime() ?? null,
        resolvedByName: r.resolvedByName,
      }),
    ),
  )
}

/**
 * Prosjektet slik en kommentarhandling må se det: finnes det, og har DENNE
 * brukeren lov til å se det?
 *
 * Gjentar synlighetsregelen fra `getProject` med vilje. Uten den ville en id i
 * et rått kall vært nok til å kommentere — og dermed bekrefte eksistensen av —
 * et upublisert prosjekt.
 */
async function readableProject(d: Db, projectId: string, canManage: boolean) {
  const project = (
    await d
      .select({ id: projects.id, name: projects.name, isPublished: projects.isPublished })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
  )[0]
  // Samme feilmelding for «finnes ikke» og «ikke for deg».
  if (!project || (!project.isPublished && !canManage)) throw new Error('Fant ikke prosjektet')
  return project
}

/**
 * Nytt spørsmål (`parentId` utelatt) eller et svar i en tråd.
 *
 * To regler håndheves her og ingen andre steder:
 *
 * 1. **Ett nivå.** Et svar kan ikke besvares — `parentId` må peke på en tråd.
 *    Uten regelen ville modellen tålt vilkårlig dybde, og #27 ber uttrykkelig om
 *    det lette alternativet til et forum.
 * 2. **Svar er stabens handling.** Alle kan spørre; `projects.manage` svarer.
 *    Den som spurte kan selvsagt skrive et nytt spørsmål, men ikke legge seg
 *    inn i tråden som om det var et svar fra prosjektledelsen.
 */
export const addProjectComment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string().min(1),
      parentId: z.string().min(1).nullish(),
      body: z.string().trim().min(1, 'Skriv noe først').max(PROJECT_COMMENT_MAX, 'Teksten er for lang'),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canManage = hasPermission(me, 'projects.manage')
    const d = db()
    await readableProject(d, data.projectId, canManage)

    if (data.parentId) {
      if (!canManage) throw new Error('Bare prosjektansvarlig kan svare i en tråd')
      const parent = (
        await d
          .select({ id: projectComments.id, parentId: projectComments.parentId, projectId: projectComments.projectId })
          .from(projectComments)
          .where(eq(projectComments.id, data.parentId))
          .limit(1)
      )[0]
      // `projectId` sjekkes også: id-en alene ville latt et rått kall henge et
      // svar på en tråd i et helt annet prosjekt.
      if (!parent || parent.projectId !== data.projectId) throw new Error('Fant ikke tråden')
      if (parent.parentId !== null) throw new Error('Du kan ikke svare på et svar')
    }

    const ts = new Date()
    const id = newId()
    await d.insert(projectComments).values({
      id,
      projectId: data.projectId,
      parentId: data.parentId ?? null,
      authorId: me.id,
      body: data.body,
      createdAt: ts,
      updatedAt: ts,
    })
    // Ingen e-post herfra: en kommentartråd som varsler hele korpset ville vært
    // nøyaktig den kanalen #51 ber oss holde stille. Se AGENTS.md.
    return { id }
  })

/**
 * Sletting og moderering. Egen kommentar, eller `projects.manage`.
 *
 * Sletter du en TRÅD, følger svarene med (cascade i skjemaet). Det er den
 * ønskede semantikken — en tråd modereres som en tråd — og UI-et sier fra om
 * det før man trykker.
 */
export const deleteProjectComment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canManage = hasPermission(me, 'projects.manage')
    const d = db()
    const comment = (
      await d
        .select({
          id: projectComments.id,
          projectId: projectComments.projectId,
          authorId: projectComments.authorId,
        })
        .from(projectComments)
        .where(eq(projectComments.id, data.id))
        .limit(1)
    )[0]
    if (!comment) throw new Error('Fant ikke kommentaren')
    await readableProject(d, comment.projectId, canManage)
    if (!canDeleteProjectComment(me, { author: { id: comment.authorId } }, canManage)) {
      throw new Error('Du kan bare slette dine egne kommentarer')
    }
    await d.delete(projectComments).where(eq(projectComments.id, data.id))
    return { ok: true }
  })

/**
 * «Avklart» / «Åpent» på en tråd — stabens markering av at spørsmålet er
 * besvart. Krever `projects.manage`: uten skillet kunne den som spurte lukket
 * sitt eget spørsmål før noen rakk å se det, og statusen ville sluttet å bety
 * noe. Kun tråder kan avklares; et enkelt svar har ingen status.
 */
export const setProjectThreadResolved = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), resolved: z.boolean() }))
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const d = db()
    const thread = (
      await d
        .select({
          id: projectComments.id,
          projectId: projectComments.projectId,
          parentId: projectComments.parentId,
        })
        .from(projectComments)
        .where(eq(projectComments.id, data.id))
        .limit(1)
    )[0]
    if (!thread) throw new Error('Fant ikke tråden')
    if (thread.parentId !== null) throw new Error('Bare selve spørsmålet kan markeres som avklart')
    await readableProject(d, thread.projectId, true)
    await d
      .update(projectComments)
      .set({
        resolvedAt: data.resolved ? new Date() : null,
        resolvedBy: data.resolved ? me.id : null,
        updatedAt: new Date(),
      })
      .where(eq(projectComments.id, data.id))
    return { ok: true }
  })
