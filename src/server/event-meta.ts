import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import {
  eventAttendance,
  eventMeta,
  eventSetlist,
  memberProfiles,
  parts,
  projects,
  user,
  userParts,
  works,
} from '../db/schema'
import {
  ATTENDANCE_COMMENT_MAX,
  ATTENDANCE_STATUSES,
  CALENDAR_PERMISSION,
  type AttendanceStatus,
  attendanceScope,
  attendanceSourceFor,
  canSeeMemberAttendance,
  canSetAttendanceFor,
  countAttendance,
  groupBySection,
  normalizeAttendanceComment,
} from '../lib/attendance'
import { newId } from '../lib/id'
import { isOccurrenceKey } from '../lib/occurrence'
import { SETLIST_NOTE_MAX, SETLIST_TITLE_MAX, parseSetlistInput } from '../lib/setlist'
import { type Me, hasFullArchiveAccess, hasPermission, requireMe, requirePermission } from './access'
import { loadCalendar } from './calendar-feed'

/**
 * Øvingsplan, prosjektkobling og oppmøte på ÉN kalenderforekomst (#82 + #24).
 *
 * **Hvorfor egen modul og ikke `calendar.ts`:** `calendar.ts` er to tynne
 * lesefunksjoner over feeden og har ingen database. Dette er det motsatte —
 * hele skrivesiden av kalenderområdet, med to rettigheter, en innsynsregel og
 * fem tabeller. Delingen følger samme linje som `posts.ts`/`post-images.ts`:
 * `calendar-feed.ts` eier hentingen (og importeres av begge), `calendar.ts`
 * eier de rene lesefunksjonene, denne filen eier de lokale dataene.
 *
 * **Serverfunksjoner kaller aldri andre serverfunksjoner.** Vi deler
 * `loadCalendar` med `getCalendar`/`getHub`, og treffer dermed samme
 * ti-minutters cache.
 *
 * **Foreldreløse data slettes aldri.** En hendelse kan forsvinne fra feeden
 * fordi den ble slettet i Google, eller bare fordi den falt ut av
 * fire-måneders-vinduet. De to er ikke til å skille fra utsiden, og et
 * automatisk opprydningssteg ville derfor kunnet slette en øvingsplan for en
 * øvelse som fortsatt skal skje. Detaljruta viser i stedet snapshotet i
 * `event_meta` og sier rolig fra at hendelsen ikke finnes i kalenderen lenger.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra.** Rutene importerer
 * modulen, og en levende eksport ville dratt `cloudflare:workers` (via `db`)
 * inn i klientbygget — samme felle som `post-images.ts` og guarden i
 * `gruppeledere.ts`. Rettighetsnøklene og de rene reglene bor i
 * `src/lib/attendance.ts`, som begge sider kan importere.
 */

const occurrenceKeySchema = z.string().refine(isOccurrenceKey, 'Ugyldig hendelsesnøkkel')

// ---------- Felles oppslag ----------

type RosterMember = {
  id: string
  name: string
  partIds: string[]
  /** Primærstemmen — den oversikten grupperer og sorterer på. */
  partName: string | null
  section: string | null
  sortOrder: number
}

/**
 * Alle AKTIVE medlemmer med stemmene sine. Deaktiverte medlemmer er ikke med:
 * de skal verken telles i «18 kommer» eller kunne få registrert fravær.
 */
async function activeRoster(d: Db): Promise<RosterMember[]> {
  const rows = await d
    .select({
      id: user.id,
      name: user.name,
      partId: parts.id,
      partName: parts.nameNo,
      partSection: parts.section,
      partSort: parts.sortOrder,
      isPrimary: userParts.isPrimary,
    })
    .from(memberProfiles)
    .innerJoin(user, eq(memberProfiles.authUserId, user.id))
    .leftJoin(userParts, eq(userParts.userId, user.id))
    .leftJoin(parts, eq(userParts.partId, parts.id))
    .where(eq(memberProfiles.isActive, true))

  const byId = new Map<string, RosterMember & { primarySort: number }>()
  for (const row of rows) {
    const entry = byId.get(row.id) ?? {
      id: row.id,
      name: row.name,
      partIds: [],
      partName: null,
      section: null,
      sortOrder: 999,
      primarySort: Number.POSITIVE_INFINITY,
    }
    if (row.partId) {
      entry.partIds.push(row.partId)
      // Primærstemmen først, ellers laveste sortOrder — samme regel som
      // medlemslista, så et medlem ikke havner i to ulike grupper to steder.
      const rank = (row.isPrimary ? 0 : 1) * 10_000 + (row.partSort ?? 999)
      if (rank < entry.primarySort) {
        entry.primarySort = rank
        entry.partName = row.partName
        entry.section = row.partSection
        entry.sortOrder = row.partSort ?? 999
      }
    }
    byId.set(row.id, entry)
  }
  return [...byId.values()].map(({ primarySort: _drop, ...member }) => member)
}

/** Stemmene til ETT medlem, lest ferskt fra databasen (aldri fra klienten). */
async function partIdsFor(d: Db, userId: string): Promise<string[] | null> {
  const profile = await d
    .select({ isActive: memberProfiles.isActive })
    .from(memberProfiles)
    .where(eq(memberProfiles.authUserId, userId))
    .limit(1)
  if (!profile[0] || !profile[0].isActive) return null
  const rows = await d.select({ partId: userParts.partId }).from(userParts).where(eq(userParts.userId, userId))
  return rows.map((r) => r.partId)
}

/** Forekomsten fra feeden, eller null når den ikke finnes i vinduet. */
async function feedOccurrence(occurrenceKey: string) {
  const calendar = await loadCalendar(Date.now())
  return {
    calendar,
    event: calendar.events.find((e) => e.occurrenceKey === occurrenceKey) ?? null,
  }
}

/**
 * Henter (eller oppretter lazily) `event_meta` for en forekomst. Raden lages
 * FØRSTE gang noen skriver noe lokalt — en hendelse ingen har rørt har ingen
 * rad, og kalenderen forblir en ren lesekopi.
 *
 * Snapshotet (`summary`, `start`, `uid`) tas alltid fra FEEDEN, aldri fra
 * klienten: et rått kall skal ikke kunne dikte opp en hendelse med valgfri
 * tittel. Finnes ikke forekomsten i feeden, kan man bare skrive videre på en
 * rad som allerede finnes (den foreldreløse hendelsen) — ikke lage en ny.
 */
async function ensureMeta(d: Db, occurrenceKey: string, me: Me): Promise<void> {
  const existing = await d
    .select({ occurrenceKey: eventMeta.occurrenceKey })
    .from(eventMeta)
    .where(eq(eventMeta.occurrenceKey, occurrenceKey))
    .limit(1)
  const now = new Date()
  if (existing[0]) {
    await d.update(eventMeta).set({ updatedAt: now }).where(eq(eventMeta.occurrenceKey, occurrenceKey))
    return
  }
  const { event } = await feedOccurrence(occurrenceKey)
  if (!event) throw new Error('Hendelsen finnes ikke i kalenderen')
  await d
    .insert(eventMeta)
    .values({
      occurrenceKey,
      uid: event.uid,
      summary: event.title,
      start: new Date(event.start),
      linkedProjectId: null,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
}

// ---------- Lesing ----------

export type EventSetlistItem = {
  id: string
  workId: string | null
  workTitle: string | null
  workComposer: string | null
  /** Verket finnes i arkivet OG leseren har arkivinnsyn — ellers ren tekst. */
  workLink: boolean
  customTitle: string | null
  note: string | null
}

export type EventAttendanceRow = {
  userId: string
  name: string
  partName: string | null
  status: AttendanceStatus | null
  comment: string | null
  source: 'self' | 'admin' | null
  registeredByName: string | null
  updatedAt: number | null
  /** Kan den som ser lista sette status for dette medlemmet? */
  canEdit: boolean
}

/**
 * Alt detaljruta trenger: forekomsten fra feeden + de lokale dataene, med
 * navneliste og kommentarer allerede nullet etter innsynsregelen.
 *
 * Innsynet håndheves HER, ikke i komponenten: `members` er `null` for den som
 * bare skal se tall, og en gruppeleder får kun sine egne seksjoner i lista.
 * Et rått kall gir nøyaktig det samme som skjermen viser.
 */
export const getEventDetail = createServerFn()
  .validator(z.object({ occurrenceKey: occurrenceKeySchema }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const key = data.occurrenceKey

    const [{ calendar, event }, metaRows] = await Promise.all([
      feedOccurrence(key),
      d.select().from(eventMeta).where(eq(eventMeta.occurrenceKey, key)).limit(1),
    ])
    const meta = metaRows[0] ?? null

    const canManagePlan = hasPermission(me, CALENDAR_PERMISSION)
    const scope = attendanceScope(me)
    const canSeeArchive = hasFullArchiveAccess(me)

    // Foreldreløs nøkkel: hendelsen er borte fra feeden. Den som har skriverett
    // (øvingsplan eller fravær, inkludert gruppeleder) skal fortsatt kunne lese
    // det som ble registrert; for alle andre er det bare en rolig beskjed.
    const showLocal = event !== null || canManagePlan || scope.kind !== 'self'
    if (!event && (!meta || !showLocal)) {
      return {
        occurrenceKey: key,
        found: false,
        configured: calendar.configured,
        error: calendar.error,
        event: null,
        snapshot: meta ? { summary: meta.summary, start: meta.start.getTime() } : null,
        canManagePlan,
        canManageAttendance: scope.kind === 'all',
        setlist: [] as EventSetlistItem[],
        linkedProject: null as { id: string; name: string } | null,
        projectOptions: [] as Array<{ id: string; name: string; eventDate: string | null }>,
        myAttendance: null as { status: AttendanceStatus; comment: string | null } | null,
        counts: countAttendance([]),
        groups: null as Array<{ section: string; label: string; members: EventAttendanceRow[] }> | null,
      }
    }

    const [setlistRows, attendanceRows, roster, projectOptions] = await Promise.all([
      d
        .select({
          id: eventSetlist.id,
          workId: eventSetlist.workId,
          customTitle: eventSetlist.customTitle,
          note: eventSetlist.note,
          sortOrder: eventSetlist.sortOrder,
          workTitle: works.title,
          workComposer: works.composer,
        })
        .from(eventSetlist)
        .leftJoin(works, eq(eventSetlist.workId, works.id))
        .where(eq(eventSetlist.occurrenceKey, key))
        .orderBy(asc(eventSetlist.sortOrder)),
      d
        .select({
          userId: eventAttendance.userId,
          status: eventAttendance.status,
          comment: eventAttendance.comment,
          source: eventAttendance.source,
          registeredBy: eventAttendance.registeredBy,
          updatedAt: eventAttendance.updatedAt,
        })
        .from(eventAttendance)
        .where(eq(eventAttendance.occurrenceKey, key)),
      activeRoster(d),
      canManagePlan
        ? d
            .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
            .from(projects)
            .where(eq(projects.isPublished, true))
            .orderBy(asc(projects.eventDate))
        : Promise.resolve([]),
    ])

    const nameById = new Map(roster.map((m) => [m.id, m.name]))
    const byUser = new Map(attendanceRows.map((r) => [r.userId, r]))
    const mine = byUser.get(me.id) ?? null

    // Tallene regnes over HELE det aktive korpset — også for den som ikke får
    // se navnene. «18 kommer» er informasjon om øvelsen, ikke om personer.
    const counts = countAttendance(roster.map((m) => ({ status: byUser.get(m.id)?.status ?? null })))

    const visible = roster.filter((member) => canSeeMemberAttendance(me, member, scope))
    const groups =
      scope.kind === 'self'
        ? null
        : groupBySection(
            visible.map((member) => {
              const row = byUser.get(member.id) ?? null
              const item: EventAttendanceRow & { section: string | null; sortOrder: number } = {
                userId: member.id,
                name: member.name,
                partName: member.partName,
                section: member.section,
                sortOrder: member.sortOrder,
                status: row?.status ?? null,
                comment: row?.comment ?? null,
                source: row?.source ?? null,
                registeredByName: row?.registeredBy ? (nameById.get(row.registeredBy) ?? null) : null,
                updatedAt: row?.updatedAt?.getTime() ?? null,
                canEdit: canSetAttendanceFor(me, member),
              }
              return item
            }),
          ).map((group) => ({
            section: group.section,
            label: group.label,
            members: group.members.map(({ section: _s, sortOrder: _o, ...row }) => row),
          }))

    const linkedProject = meta?.linkedProjectId
      ? ((
          await d
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(eq(projects.id, meta.linkedProjectId))
            .limit(1)
        )[0] ?? null)
      : null

    return {
      occurrenceKey: key,
      found: event !== null,
      configured: calendar.configured,
      error: calendar.error,
      event: event
        ? {
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            location: event.location,
            description: event.description,
          }
        : null,
      snapshot: meta ? { summary: meta.summary, start: meta.start.getTime() } : null,
      canManagePlan,
      canManageAttendance: scope.kind === 'all',
      setlist: setlistRows.map(
        (row): EventSetlistItem => ({
          id: row.id,
          workId: row.workId,
          workTitle: row.workTitle,
          workComposer: row.workComposer,
          workLink: row.workId !== null && canSeeArchive,
          customTitle: row.customTitle,
          note: row.note,
        }),
      ),
      linkedProject,
      projectOptions,
      myAttendance: mine ? { status: mine.status, comment: mine.comment } : null,
      counts,
      groups,
    }
  })

/**
 * Verkssøk for øvingsplanen. Egen funksjon, gated på `calendar.manage`:
 * `searchWorksForPicker` i `projects.ts` krever `projects.manage`, og en
 * dirigent som bare skal sette opp en øvelse skal ikke måtte ha den.
 */
export const searchWorksForEvent = createServerFn()
  .validator(z.object({ q: z.string().max(120).optional() }))
  .handler(async ({ data }) => {
    await requirePermission(CALENDAR_PERMISSION)
    const q = data.q?.trim()
    const rows = await db()
      .select({ id: works.id, title: works.title, composer: works.composer, durationSec: works.durationSec })
      .from(works)
      .where(q ? or(like(works.title, `%${q}%`), like(works.composer, `%${q}%`)) : undefined)
      .orderBy(asc(works.title))
      .limit(12)
    return { works: rows }
  })

// ---------- Øvingsplan (calendar.manage) ----------

export const addSetlistItem = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      workId: z.string().max(64).nullable().optional(),
      customTitle: z.string().max(SETLIST_TITLE_MAX * 2).nullable().optional(),
      note: z.string().max(SETLIST_NOTE_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(CALENDAR_PERMISSION)
    const value = parseSetlistInput(data)
    const d = db()
    if (value.workId) {
      const work = await d.select({ id: works.id }).from(works).where(eq(works.id, value.workId)).limit(1)
      if (!work[0]) throw new Error('Ukjent verk')
    }
    await ensureMeta(d, data.occurrenceKey, me)
    const max = await d
      .select({ m: sql<number>`coalesce(max(sort_order), 0)` })
      .from(eventSetlist)
      .where(eq(eventSetlist.occurrenceKey, data.occurrenceKey))
    await d.insert(eventSetlist).values({
      id: newId(),
      occurrenceKey: data.occurrenceKey,
      workId: value.workId,
      customTitle: value.customTitle,
      note: value.note,
      sortOrder: (max[0]?.m ?? 0) + 10,
    })
    return { ok: true }
  })

export const updateSetlistItem = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      id: z.string(),
      customTitle: z.string().max(SETLIST_TITLE_MAX * 2).nullable().optional(),
      note: z.string().max(SETLIST_NOTE_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission(CALENDAR_PERMISSION)
    const d = db()
    const existing = (
      await d
        .select({ id: eventSetlist.id, workId: eventSetlist.workId, customTitle: eventSetlist.customTitle })
        .from(eventSetlist)
        .where(and(eq(eventSetlist.id, data.id), eq(eventSetlist.occurrenceKey, data.occurrenceKey)))
        .limit(1)
    )[0]
    if (!existing) throw new Error('Punktet finnes ikke')
    // Et punkt kan ikke redigeres til å miste både verk og tittel.
    const value = parseSetlistInput({
      workId: existing.workId,
      customTitle: data.customTitle === undefined ? existing.customTitle : data.customTitle,
      note: data.note,
    })
    await d
      .update(eventSetlist)
      .set({ customTitle: value.customTitle, note: value.note })
      .where(eq(eventSetlist.id, data.id))
    await touchMeta(d, data.occurrenceKey)
    return { ok: true }
  })

export const removeSetlistItem = createServerFn({ method: 'POST' })
  .validator(z.object({ occurrenceKey: occurrenceKeySchema, id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(CALENDAR_PERMISSION)
    const d = db()
    await d
      .delete(eventSetlist)
      .where(and(eq(eventSetlist.id, data.id), eq(eventSetlist.occurrenceKey, data.occurrenceKey)))
    await touchMeta(d, data.occurrenceKey)
    return { ok: true }
  })

/** Ett hakk opp eller ned. Bytter `sort_order` med naboen — ingen renummerering. */
export const moveSetlistItem = createServerFn({ method: 'POST' })
  .validator(z.object({ occurrenceKey: occurrenceKeySchema, id: z.string(), direction: z.enum(['up', 'down']) }))
  .handler(async ({ data }) => {
    await requirePermission(CALENDAR_PERMISSION)
    const d = db()
    const rows = await d
      .select({ id: eventSetlist.id, sortOrder: eventSetlist.sortOrder })
      .from(eventSetlist)
      .where(eq(eventSetlist.occurrenceKey, data.occurrenceKey))
      .orderBy(asc(eventSetlist.sortOrder))
    const index = rows.findIndex((r) => r.id === data.id)
    const target = data.direction === 'up' ? index - 1 : index + 1
    if (index === -1 || target < 0 || target >= rows.length) return { ok: true }
    const a = rows[index]!
    const b = rows[target]!
    // To punkter med samme sort_order ville gjort byttet til en no-op; da
    // settes de til posisjonene sine i stedet.
    const [first, second] =
      a.sortOrder === b.sortOrder ? [(target + 1) * 10, (index + 1) * 10] : [b.sortOrder, a.sortOrder]
    await d.update(eventSetlist).set({ sortOrder: first }).where(eq(eventSetlist.id, a.id))
    await d.update(eventSetlist).set({ sortOrder: second }).where(eq(eventSetlist.id, b.id))
    await touchMeta(d, data.occurrenceKey)
    return { ok: true }
  })

export const setLinkedProject = createServerFn({ method: 'POST' })
  .validator(z.object({ occurrenceKey: occurrenceKeySchema, projectId: z.string().nullable() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(CALENDAR_PERMISSION)
    const d = db()
    if (data.projectId) {
      // Kun publiserte prosjekter: et utkast er ikke synlig for medlemmene, og
      // en kobling ville lekket navnet på detaljruta.
      const project = await d
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, data.projectId), eq(projects.isPublished, true)))
        .limit(1)
      if (!project[0]) throw new Error('Ukjent eller upublisert prosjekt')
    }
    await ensureMeta(d, data.occurrenceKey, me)
    await d
      .update(eventMeta)
      .set({ linkedProjectId: data.projectId, updatedAt: new Date() })
      .where(eq(eventMeta.occurrenceKey, data.occurrenceKey))
    return { ok: true }
  })

async function touchMeta(d: Db, occurrenceKey: string): Promise<void> {
  await d.update(eventMeta).set({ updatedAt: new Date() }).where(eq(eventMeta.occurrenceKey, occurrenceKey))
}

// ---------- Oppmøte ----------

const statusSchema = z.enum(ATTENDANCE_STATUSES)

/**
 * Skriver ÉN rad — samme rad som fraværsansvarlig bruker. `source` og
 * `registeredBy` settes av serveren, aldri av klienten.
 */
async function writeAttendance(
  d: Db,
  occurrenceKey: string,
  me: Me,
  targetUserId: string,
  status: AttendanceStatus | null,
  comment: string | null | undefined,
): Promise<void> {
  if (status === null) {
    await d
      .delete(eventAttendance)
      .where(and(eq(eventAttendance.occurrenceKey, occurrenceKey), eq(eventAttendance.userId, targetUserId)))
    await touchMeta(d, occurrenceKey)
    return
  }
  await ensureMeta(d, occurrenceKey, me)
  const now = new Date()
  const source = attendanceSourceFor(me, targetUserId)
  const value = {
    occurrenceKey,
    userId: targetUserId,
    status,
    comment: normalizeAttendanceComment(comment),
    source,
    registeredBy: me.id,
    createdAt: now,
    updatedAt: now,
  }
  await d
    .insert(eventAttendance)
    .values(value)
    .onConflictDoUpdate({
      target: [eventAttendance.occurrenceKey, eventAttendance.userId],
      set: { status: value.status, comment: value.comment, source, registeredBy: me.id, updatedAt: now },
    })
}

/**
 * Medlemmets eget svar (#24). Kan settes, endres og nullstilles — aldri på
 * andres vegne: `userId` er ikke en parameter i det hele tatt.
 */
export const setMyAttendance = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      status: statusSchema.nullable(),
      comment: z.string().max(ATTENDANCE_COMMENT_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    // `requireMe()` gir bare AKTIVE medlemmer (currentUser avviser deaktiverte).
    const me = await requireMe()
    await writeAttendance(db(), data.occurrenceKey, me, me.id, data.status, data.comment)
    return { ok: true }
  })

/**
 * Registrert oppmøte/fravær for et annet medlem (#82). Gates på
 * `attendance.manage` ELLER en aktiv gruppelederbinding som dekker medlemmets
 * stemme — begge håndhevet mot stemmer LEST FRA DATABASEN, ikke fra kallet.
 */
export const setMemberAttendance = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      userId: z.string(),
      status: statusSchema.nullable(),
      comment: z.string().max(ATTENDANCE_COMMENT_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const partIds = await partIdsFor(d, data.userId)
    // «Finnes ikke» og «ikke aktiv» svarer likt: lista er uansett bare synlig
    // for den som allerede ser medlemmene.
    if (partIds === null) throw new Error('Ukjent eller deaktivert medlem')
    if (!canSetAttendanceFor(me, { id: data.userId, partIds })) {
      throw new Error('Du kan ikke registrere oppmøte for dette medlemmet')
    }
    await writeAttendance(d, data.occurrenceKey, me, data.userId, data.status, data.comment)
    return { ok: true }
  })
