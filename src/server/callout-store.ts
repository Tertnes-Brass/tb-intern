import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import {
  calloutResponses,
  memberProfiles,
  parts,
  postCallouts,
  posts,
  projectCrew,
  projects,
  user,
  userParts,
} from '../db/schema'
import {
  CALLOUT_KIND_LOCKED,
  type CalloutDraft,
  type CalloutKind,
  type CalloutState,
  type CalloutStatus,
  type CalloutValues,
  calloutState,
  canCreateCallout,
  canManageCallout,
  sanitizeCalloutInput,
} from '../lib/callouts'
import { type AgendaEvent, dugnadCalendarEvent } from '../lib/gig-calendar'
import { newId } from '../lib/id'
import { GIG_KIND, isGig } from '../lib/project-access'
import { findOrCreateSeason } from './season-store'

/**
 * Databasehjelpere for «Kan du?». Tar `d` som parameter og rører aldri
 * `cloudflare:workers`, så de kan brukes fra serverfunksjonene på veggen.
 *
 * Innsynet avgjøres HER: en vanlig leser får bare navnene på dem som kan, og
 * sitt eget svar. Usikre, nei, ubesvarte og merknader kommer aldri i svaret til
 * andre enn den ansvarlige.
 */

export type CalloutViewer = { id: string; permissions: string[] }

export type CalloutSummary = {
  kind: CalloutKind
  eventDate: string | null
  startTime: string | null
  location: string | null
  respondBy: string | null
  needed: number | null
  state: CalloutState
  yesCount: number
  /** De første navnene, til kortet på veggen. */
  yesPreview: string[]
  mine: { status: CalloutStatus; note: string | null } | null
  canManage: boolean
  /** Står i besetningen på oppdraget. */
  isCrew: boolean
  /** Bare til den som faktisk kan åpne prosjektet. */
  projectId: string | null
}

export type CalloutPerson = { userId: string; name: string }
export type CalloutManagedPerson = CalloutPerson & { note: string | null; parts: string[]; isCrew: boolean }
export type CalloutPartRow = {
  id: string
  name: string
  people: Array<CalloutPerson & { status: 'yes' | 'maybe'; isCrew: boolean }>
}

export type CalloutDetail = CalloutSummary & {
  yes: CalloutPerson[]
  canPickCrew: boolean
  /** Bare for den ansvarlige. */
  manage: {
    yes: CalloutManagedPerson[]
    maybe: CalloutManagedPerson[]
    no: CalloutManagedPerson[]
    unanswered: CalloutManagedPerson[]
    byPart: CalloutPartRow[]
  } | null
}

const YES_PREVIEW = 5
const IN_CHUNK = 90

function has(viewer: CalloutViewer, permission: string): boolean {
  return viewer.permissions.includes('*') || viewer.permissions.includes(permission)
}

function calloutRows(d: Db) {
  return d
    .select({
      postId: postCallouts.postId,
      kind: postCallouts.kind,
      projectId: postCallouts.projectId,
      eventDate: postCallouts.eventDate,
      startTime: postCallouts.startTime,
      location: postCallouts.location,
      respondBy: postCallouts.respondBy,
      needed: postCallouts.needed,
      closedAt: postCallouts.closedAt,
      projectKind: projects.kind,
      projectDate: projects.eventDate,
      projectTime: projects.startTime,
      projectVenue: projects.venue,
    })
    .from(postCallouts)
    .leftJoin(projects, eq(postCallouts.projectId, projects.id))
}

type CalloutRow = Awaited<ReturnType<typeof calloutRows>>[number]

/** Et oppdrag henter dato, tid og sted fra prosjektet. Da finnes de bare ett sted. */
function effective(row: CalloutRow) {
  const linked = row.projectId !== null
  return {
    eventDate: linked ? row.projectDate : row.eventDate,
    startTime: linked ? row.projectTime : row.startTime,
    location: linked ? row.projectVenue : row.location,
    respondBy: row.respondBy,
    closedAt: row.closedAt?.getTime() ?? null,
  }
}

async function activeResponses(d: Db, postIds: string[]) {
  const out: Array<{ postId: string; userId: string; status: CalloutStatus; note: string | null; name: string }> = []
  for (let i = 0; i < postIds.length; i += IN_CHUNK) {
    const rows = await d
      .select({
        postId: calloutResponses.postId,
        userId: calloutResponses.userId,
        status: calloutResponses.status,
        note: calloutResponses.note,
        name: user.name,
      })
      .from(calloutResponses)
      .innerJoin(user, eq(calloutResponses.userId, user.id))
      .innerJoin(memberProfiles, eq(memberProfiles.authUserId, user.id))
      .where(and(inArray(calloutResponses.postId, postIds.slice(i, i + IN_CHUNK)), eq(memberProfiles.isActive, true)))
      .orderBy(asc(user.name))
    out.push(...rows)
  }
  return out
}

/** Oppsummeringen til kortene på veggen. Tar bare innlegg leseren allerede får se. */
export async function calloutSummaries(
  d: Db,
  items: Array<{ id: string; authorId: string | null }>,
  viewer: CalloutViewer,
  now: number = Date.now(),
): Promise<Map<string, CalloutSummary>> {
  const out = new Map<string, CalloutSummary>()
  if (items.length === 0) return out
  // Spørsmålene er få, så alle hentes og filtreres. Da slipper en vegg med hele
  // historikken å treffe D1s tak på bundne parametere.
  const authors = new Map(items.map((item) => [item.id, item.authorId]))
  const rows = (await calloutRows(d)).filter((row) => authors.has(row.postId))
  if (rows.length === 0) return out

  const [responses, myCrew] = await Promise.all([
    activeResponses(d, rows.map((row) => row.postId)),
    d.select({ projectId: projectCrew.projectId }).from(projectCrew).where(eq(projectCrew.userId, viewer.id)),
  ])
  const crewProjects = new Set(myCrew.map((row) => row.projectId))

  for (const row of rows) {
    const facts = effective(row)
    const own = responses.filter((r) => r.postId === row.postId)
    const yes = own.filter((r) => r.status === 'yes')
    const mine = own.find((r) => r.userId === viewer.id)
    const isCrew = row.projectId !== null && crewProjects.has(row.projectId)
    out.set(row.postId, {
      kind: row.kind,
      eventDate: facts.eventDate,
      startTime: facts.startTime,
      location: facts.location,
      respondBy: facts.respondBy,
      needed: row.needed,
      state: calloutState(facts, now),
      yesCount: yes.length,
      yesPreview: yes.slice(0, YES_PREVIEW).map((r) => r.name),
      mine: mine ? { status: mine.status, note: mine.note } : null,
      canManage: canManageCallout(viewer, { authorId: authors.get(row.postId) ?? null, kind: row.kind }),
      isCrew,
      projectId: row.projectId && (isCrew || has(viewer, 'projects.manage')) ? row.projectId : null,
    })
  }
  return out
}

/** Alt på detaljsiden. `manage` er bare med for den ansvarlige. */
export async function calloutDetail(
  d: Db,
  post: { id: string; authorId: string | null },
  viewer: CalloutViewer,
  now: number = Date.now(),
): Promise<CalloutDetail | null> {
  const summary = (await calloutSummaries(d, [post], viewer, now)).get(post.id)
  if (!summary) return null
  const row = (await calloutRows(d).where(eq(postCallouts.postId, post.id)).limit(1))[0]
  const responses = await activeResponses(d, [post.id])
  const yes = responses.filter((r) => r.status === 'yes').map(({ userId, name }) => ({ userId, name }))
  const canPickCrew = has(viewer, 'projects.manage') && !!row?.projectId && row.projectKind === GIG_KIND

  if (!summary.canManage) return { ...summary, yes, canPickCrew: false, manage: null }

  const [members, ownParts, partRows, crewRows] = await Promise.all([
    d
      .select({ userId: user.id, name: user.name })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .where(eq(memberProfiles.isActive, true))
      .orderBy(asc(user.name)),
    d.select({ userId: userParts.userId, partId: userParts.partId }).from(userParts),
    d.select({ id: parts.id, nameNo: parts.nameNo, sortOrder: parts.sortOrder }).from(parts).orderBy(asc(parts.sortOrder)),
    row?.projectId
      ? d.select({ userId: projectCrew.userId }).from(projectCrew).where(eq(projectCrew.projectId, row.projectId))
      : Promise.resolve([] as Array<{ userId: string }>),
  ])
  const crew = new Set(crewRows.map((c) => c.userId))
  const partName = new Map(partRows.map((p) => [p.id, p.nameNo]))
  const partsOf = new Map<string, string[]>()
  for (const own of ownParts) partsOf.set(own.userId, [...(partsOf.get(own.userId) ?? []), own.partId])
  const byUser = new Map(responses.map((r) => [r.userId, r]))
  const person = (m: CalloutPerson): CalloutManagedPerson => ({
    ...m,
    note: byUser.get(m.userId)?.note ?? null,
    parts: (partsOf.get(m.userId) ?? []).flatMap((id) => partName.get(id) ?? []),
    isCrew: crew.has(m.userId),
  })
  const inStatus = (status: CalloutStatus) => members.filter((m) => byUser.get(m.userId)?.status === status).map(person)

  // Per stemme: hvem som kan eller kanskje kan. Stemmer ingen spiller, vises ikke.
  const byPart: CalloutPartRow[] = partRows.flatMap((part) => {
    const holders = members.filter((m) => partsOf.get(m.userId)?.includes(part.id))
    if (holders.length === 0) return []
    const people = holders.flatMap((m) => {
      const status = byUser.get(m.userId)?.status
      if (status !== 'yes' && status !== 'maybe') return []
      return [{ userId: m.userId, name: m.name, status, isCrew: crew.has(m.userId) }]
    })
    people.sort((a, b) => Number(b.status === 'yes') - Number(a.status === 'yes'))
    return [{ id: part.id, name: part.nameNo, people }]
  })

  return {
    ...summary,
    yes,
    canPickCrew,
    manage: {
      yes: inStatus('yes'),
      maybe: inStatus('maybe'),
      no: inStatus('no'),
      unanswered: members.filter((m) => !byUser.has(m.userId)).map(person),
      byPart,
    },
  }
}

export type PreparedCallout = {
  /** Et nytt oppdrag som skal lages sammen med spørsmålet. */
  project: typeof projects.$inferInsert | null
  values: CalloutValues
}

/**
 * Validerer et spørsmål før noe skrives. Rettigheten sjekkes her, slik at et
 * rått kall til `createPost`/`updatePost` ikke kan koble seg på et oppdrag.
 */
export async function prepareCallout(
  d: Db,
  viewer: CalloutViewer,
  input: CalloutDraft,
  postId: string | null,
  postTitle: string | null,
): Promise<PreparedCallout> {
  if (!canCreateCallout(viewer.permissions, input.kind)) throw new Error('Du har ikke tilgang til å spørre korpset om dette')
  if (!postTitle?.trim()) throw new Error('Et «Kan du?»-innlegg må ha en tittel')

  const existing = postId
    ? (await d.select().from(postCallouts).where(eq(postCallouts.postId, postId)).limit(1))[0]
    : undefined
  const answered = existing
    ? (await d.select({ userId: calloutResponses.userId }).from(calloutResponses).where(eq(calloutResponses.postId, existing.postId)).limit(1)).length > 0
    : false

  // Oppdraget et eksisterende spørsmål hører til, følger med når klienten ikke oppgir noe.
  const projectId = input.kind === 'spilleoppdrag' ? (input.projectId ?? existing?.projectId ?? null) : null
  if (answered && existing && (existing.kind !== input.kind || existing.projectId !== projectId)) {
    throw new Error(CALLOUT_KIND_LOCKED)
  }

  if (input.kind === 'spilleoppdrag' && projectId) {
    const project = (await d.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project || !isGig(project)) throw new Error('Fant ikke spilleoppdraget')
    const other = (await d.select({ postId: postCallouts.postId }).from(postCallouts).where(eq(postCallouts.projectId, projectId)).limit(1))[0]
    if (other && other.postId !== postId) throw new Error('Dette oppdraget er allerede spurt om på veggen')
    return { project: null, values: sanitizeCalloutInput({ ...input, projectId }, project.eventDate) }
  }

  const values = sanitizeCalloutInput({ ...input, projectId: null })
  if (input.kind !== 'spilleoppdrag') return { project: null, values }

  // Nytt oppdrag: prosjektet blir sannheten om dato, tid og sted. Det er
  // publisert, men usynlig for alle unntatt `projects.manage` til noen velges.
  const id = newId()
  const project: typeof projects.$inferInsert = {
    id,
    name: postTitle.trim(),
    kind: GIG_KIND,
    eventDate: values.eventDate,
    startTime: values.startTime,
    venue: values.location,
    seasonId: await findOrCreateSeason(d, values.eventDate!),
    isPublished: true,
    createdAt: new Date(),
  }
  return { project, values: { ...values, projectId: id, eventDate: null, startTime: null, location: null } }
}

/** Skrivesetningen for spørsmålet. Klar for `d.batch` sammen med innlegget. */
export function upsertCallout(d: Db, postId: string, values: CalloutValues, now: Date = new Date()) {
  return d
    .insert(postCallouts)
    .values({ postId, ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: postCallouts.postId, set: { ...values, updatedAt: now } })
}

/** Dugnadene i datointervallet, som kalenderrader. Oppdrag står bare hos besetningen. */
export async function dugnadEvents(d: Db, fromDate: string, toDate: string): Promise<AgendaEvent[]> {
  const rows = await d
    .select({
      postId: postCallouts.postId,
      title: posts.title,
      eventDate: postCallouts.eventDate,
      startTime: postCallouts.startTime,
      location: postCallouts.location,
    })
    .from(postCallouts)
    .innerJoin(posts, eq(postCallouts.postId, posts.id))
    .where(and(eq(postCallouts.kind, 'dugnad'), isNotNull(posts.publishedAt), eq(posts.audience, 'all')))
  return rows.flatMap((row) =>
    row.eventDate && row.eventDate >= fromDate && row.eventDate <= toDate
      ? [dugnadCalendarEvent({ ...row, title: row.title ?? 'Dugnad', eventDate: row.eventDate })]
      : [],
  )
}

export type OpenCallout = {
  postId: string
  title: string
  kind: CalloutKind
  eventDate: string
  startTime: string | null
  location: string | null
  respondBy: string | null
}

/** Åpne spørsmål jeg ikke har svart på, først det som haster mest. Til Hjem. */
export async function unansweredCallouts(d: Db, userId: string, limit: number, now: number = Date.now()): Promise<OpenCallout[]> {
  const rows = await d
    .select({
      postId: postCallouts.postId,
      title: posts.title,
      kind: postCallouts.kind,
      projectId: postCallouts.projectId,
      eventDate: postCallouts.eventDate,
      startTime: postCallouts.startTime,
      location: postCallouts.location,
      respondBy: postCallouts.respondBy,
      projectDate: projects.eventDate,
      projectTime: projects.startTime,
      projectVenue: projects.venue,
    })
    .from(postCallouts)
    .innerJoin(posts, eq(postCallouts.postId, posts.id))
    .leftJoin(projects, eq(postCallouts.projectId, projects.id))
    .leftJoin(calloutResponses, and(eq(calloutResponses.postId, postCallouts.postId), eq(calloutResponses.userId, userId)))
    .where(and(isNotNull(posts.publishedAt), eq(posts.audience, 'all'), isNull(postCallouts.closedAt), isNull(calloutResponses.userId)))

  const open = rows.flatMap((row) => {
    const linked = row.projectId !== null
    const eventDate = linked ? row.projectDate : row.eventDate
    const startTime = linked ? row.projectTime : row.startTime
    if (!eventDate) return []
    if (calloutState({ eventDate, startTime, respondBy: row.respondBy, closedAt: null }, now).phase !== 'open') return []
    return [{
      postId: row.postId,
      title: row.title ?? 'Kan du?',
      kind: row.kind,
      eventDate,
      startTime,
      location: linked ? row.projectVenue : row.location,
      respondBy: row.respondBy,
    }]
  })
  return open
    .sort((a, b) => (a.respondBy ?? a.eventDate).localeCompare(b.respondBy ?? b.eventDate))
    .slice(0, limit)
}
