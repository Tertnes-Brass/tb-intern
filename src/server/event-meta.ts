import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import {
  eventAttendance,
  eventMeta,
  eventProjects,
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
import {
  type EventPracticalValue,
  PRACTICAL_ADDRESS_MAX,
  PRACTICAL_LOCATION_MAX,
  PRACTICAL_NAME_MAX,
  PRACTICAL_NOTE_MAX,
  PRACTICAL_URL_MAX,
  parseEventPracticalInput,
} from '../lib/practical'
import { canManageRigList } from '../lib/rigg'
import { SETLIST_NOTE_MAX, SETLIST_TITLE_MAX, parseSetlistInput } from '../lib/setlist'
import { type Me, hasFullArchiveAccess, hasPermission, requireMe, requirePermission } from './access'
import { ensureEventMeta, feedOccurrence } from './event-meta-row'
import { type RigItemRow, loadRigItems } from './rig-store'

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

/**
 * `feedOccurrence` og `ensureMeta` bor i `event-meta-row.ts`: riggelista (#12)
 * skriver også på en forekomst og trenger nøyaktig den samme lazy-opprettelsen.
 * De kunne ikke bare eksporteres herfra — denne modulen importeres av
 * rutekomponenter, og en levende eksport ville dratt `cloudflare:workers` inn i
 * klientbygget (samme felle som `post-images.ts`).
 */
const ensureMeta = (d: Db, occurrenceKey: string, me: Me) => ensureEventMeta(d, occurrenceKey, me.id)

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

/** Praktisk info per øving (#10). Alle felt er valgfrie — se src/lib/practical.ts. */
export type EventPractical = EventPracticalValue

const EMPTY_PRACTICAL: EventPractical = {
  locationName: null,
  locationAddress: null,
  mapUrl: null,
  meetupCrew: null,
  meetupMusicians: null,
  conductor: null,
  keyholder: null,
  crew: null,
  substitutes: null,
  practicalNote: null,
}

/** Plukker ut de ti praktiske feltene fra en `event_meta`-rad. Ett sted, så en
 *  ny kolonne ikke kan bli glemt i den ene av to returgrener. */
function practicalOf(meta: typeof eventMeta.$inferSelect | null | undefined): EventPractical {
  if (!meta) return EMPTY_PRACTICAL
  return {
    locationName: meta.locationName,
    locationAddress: meta.locationAddress,
    mapUrl: meta.mapUrl,
    meetupCrew: meta.meetupCrew,
    meetupMusicians: meta.meetupMusicians,
    conductor: meta.conductor,
    keyholder: meta.keyholder,
    crew: meta.crew,
    substitutes: meta.substitutes,
    practicalNote: meta.practicalNote,
  }
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
        // Uten `showLocal` skal leseren ikke se noe lokalt — heller ikke den
        // praktiske infoen. Alle de andre lokale feltene i denne grenen er
        // tomme av samme grunn.
        practical: showLocal ? practicalOf(meta) : EMPTY_PRACTICAL,
        linkedProjects: [] as Array<{
          id: string
          name: string
          eventDate: string | null
          isPublished: boolean
        }>,
        rig: { items: [] as RigItemRow[], memberOptions: [] as Array<{ id: string; name: string }> },
        canManageRig: false,
        projectOptions: [] as Array<{ id: string; name: string; eventDate: string | null }>,
        myAttendance: null as { status: AttendanceStatus; comment: string | null } | null,
        counts: countAttendance([]),
        groups: null as Array<{ section: string; label: string; members: EventAttendanceRow[] }> | null,
      }
    }

    const canManageRig = canManageRigList(me.permissions)
    const [setlistRows, attendanceRows, roster, projectOptions, linkedProjects, rigItemRows] = await Promise.all([
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
      // Prosjektene øvingen hører til (#10). n:m — én øving kan peke på flere.
      // For hele korpset leses kun PUBLISERTE prosjekter ut: et prosjekt kan
      // avpubliseres etter at koblingen ble laget, og da skal navnet ikke bli
      // stående synlig på detaljruta. Den som har `calendar.manage` ser også de
      // avpubliserte (merket) — ellers fantes det ingen vei til å fjerne
      // koblingen, og den ville dukket opp igjen ved republisering.
      d
        .select({
          id: projects.id,
          name: projects.name,
          eventDate: projects.eventDate,
          isPublished: projects.isPublished,
        })
        .from(eventProjects)
        .innerJoin(projects, eq(eventProjects.projectId, projects.id))
        .where(
          canManagePlan
            ? eq(eventProjects.occurrenceKey, key)
            : and(eq(eventProjects.occurrenceKey, key), eq(projects.isPublished, true)),
        )
        .orderBy(asc(projects.eventDate)),
      // Riggelista for DENNE øvingen (#12). Hentes i samme runde som resten:
      // seksjonen står alltid på siden, og et eget kall ville vært en rundtur
      // til for noe som uansett alltid vises.
      loadRigItems(d, { kind: 'event', occurrenceKey: key }),
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
      practical: practicalOf(meta),
      linkedProjects,
      projectOptions,
      // Riggelista (#12). `memberOptions` gjenbruker rosteret vi allerede har
      // hentet — en ekstra medlemsspørring her ville vært den samme lista to
      // ganger — og sendes kun til den som faktisk kan redigere lista.
      rig: {
        items: rigItemRows,
        memberOptions: canManageRig ? roster.map((m) => ({ id: m.id, name: m.name })) : [],
      },
      canManageRig,
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

/**
 * Kobler øvingen til — eller fra — ETT prosjekt (#10). Koblingen er n:m: «det
 * kan være vi øver til meir enn eit prosjekt på samme øvinga, så det må ikkje
 * være låst fast». Én rad om gangen, ikke «sett hele lista»: to personer som
 * huker av hvert sitt prosjekt samtidig skal ikke kunne slette hverandres valg.
 *
 * Kun PUBLISERTE prosjekter kan kobles på — som før. Et utkast er ikke synlig
 * for medlemmene, og en kobling ville lekket navnet på detaljruta.
 */
export const setEventProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      projectId: z.string().max(64),
      linked: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(CALENDAR_PERMISSION)
    const d = db()

    if (!data.linked) {
      // Frakobling krever ingen prosjektsjekk: raden skal bort uansett hva
      // prosjektet har blitt til siden den ble laget.
      await d
        .delete(eventProjects)
        .where(
          and(
            eq(eventProjects.occurrenceKey, data.occurrenceKey),
            eq(eventProjects.projectId, data.projectId),
          ),
        )
      await touchMeta(d, data.occurrenceKey)
      return { ok: true }
    }

    const project = await d
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.isPublished, true)))
      .limit(1)
    if (!project[0]) throw new Error('Ukjent eller upublisert prosjekt')

    await ensureMeta(d, data.occurrenceKey, me)
    await d
      .insert(eventProjects)
      .values({
        occurrenceKey: data.occurrenceKey,
        projectId: data.projectId,
        createdBy: me.id,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
    await touchMeta(d, data.occurrenceKey)
    return { ok: true }
  })

/**
 * Praktisk info på øvingen (#10): sted, kartlenke, oppmøtetider, dirigent,
 * nøkkelansvarlig, riggegruppe, vikarer.
 *
 * **Hele blokka skrives under ett.** Feltene fylles ut i ett skjema, og en
 * delvis oppdatering ville krevd at hvert felt kunne skilles fra «ikke sendt»
 * — mye maskineri for en dialog med ti felt. `parseEventPracticalInput`
 * normaliserer alt og kaster på en ugyldig kartlenke eller et klokkeslett som
 * ikke finnes, FØR noe skrives: en halvlagret blokk er verre enn en feilmelding.
 *
 * Gates på `calendar.manage` — samme rettighet som øvingsplanen og
 * prosjektkoblingen. Det er den samme personen som setter opp øvingen.
 */
export const updateEventPractical = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurrenceKey: occurrenceKeySchema,
      locationName: z.string().max(PRACTICAL_LOCATION_MAX * 4).nullable().optional(),
      locationAddress: z.string().max(PRACTICAL_ADDRESS_MAX * 4).nullable().optional(),
      mapUrl: z.string().max(PRACTICAL_URL_MAX * 2).nullable().optional(),
      meetupCrew: z.string().max(32).nullable().optional(),
      meetupMusicians: z.string().max(32).nullable().optional(),
      conductor: z.string().max(PRACTICAL_NAME_MAX * 4).nullable().optional(),
      keyholder: z.string().max(PRACTICAL_NAME_MAX * 4).nullable().optional(),
      crew: z.string().max(PRACTICAL_NOTE_MAX * 4).nullable().optional(),
      substitutes: z.string().max(PRACTICAL_NOTE_MAX * 4).nullable().optional(),
      practicalNote: z.string().max(PRACTICAL_NOTE_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(CALENDAR_PERMISSION)
    const { occurrenceKey, ...input } = data
    const value = parseEventPracticalInput(input)
    const d = db()
    await ensureMeta(d, occurrenceKey, me)
    await d
      .update(eventMeta)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(eventMeta.occurrenceKey, occurrenceKey))
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
