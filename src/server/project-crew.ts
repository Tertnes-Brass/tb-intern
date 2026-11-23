import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  calloutResponses,
  memberProfiles,
  notificationPreferences,
  parts,
  postCallouts,
  projectCrew,
  projects,
  projectWorks,
  user,
  userParts,
  workFiles,
} from '../db/schema'
import { formatDate, toOsloDate } from '../lib/format'
import { isGig, parseCrewPartIds } from '../lib/project-access'
import { PUSH_TTL, crewAddedPushMessage } from '../lib/push'
import { requirePermission } from './access'
import { buildChildrenMap, expandPartIds } from './parts-tree'
import { sendPushToUsers } from './push-send'

/**
 * Hvem som er med på et spilleoppdrag, og hvilke stemmer de spiller. Bare
 * `projects.manage` kan se valgene og endre dem. Kun serverfunksjoner
 * eksporteres herfra; hjelperne bor i `project-crew-store.ts`.
 */

/** Et oppdrag er noen få musikere; taket holder lagringen under D1s grenser. */
const MAX_CREW = 60

async function requireGig(projectId: string) {
  const project = (
    await db()
      .select({
        id: projects.id,
        kind: projects.kind,
        name: projects.name,
        eventDate: projects.eventDate,
        startTime: projects.startTime,
        isPublished: projects.isPublished,
      })
      .from(projects).where(eq(projects.id, projectId)).limit(1)
  )[0]
  if (!project || !isGig(project)) throw new Error('Fant ikke spilleoppdraget')
  return project
}

export const getCrewOptions = createServerFn()
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePermission('projects.manage')
    await requireGig(data.projectId)
    const d = db()
    const [memberRows, ownRows, partRows, programRows, crewRows, responseRows] = await Promise.all([
      d
        .select({ id: user.id, name: user.name })
        .from(memberProfiles)
        .innerJoin(user, eq(memberProfiles.authUserId, user.id))
        .where(eq(memberProfiles.isActive, true))
        .orderBy(asc(user.name)),
      d.select({ userId: userParts.userId, partId: userParts.partId }).from(userParts),
      d.select({ id: parts.id, nameNo: parts.nameNo, parentId: parts.parentId, sortOrder: parts.sortOrder }).from(parts).orderBy(asc(parts.sortOrder)),
      // Stemmene som faktisk finnes i programmet, i utgaven prosjektet bruker.
      d
        .selectDistinct({ id: workFiles.partId })
        .from(projectWorks)
        .innerJoin(
          workFiles,
          and(eq(workFiles.workId, projectWorks.workId), sql`${workFiles.editionId} IS ${projectWorks.editionId}`),
        )
        .where(and(eq(projectWorks.projectId, data.projectId), eq(workFiles.kind, 'part'))),
      d
        .select({ userId: projectCrew.userId, partIds: projectCrew.partIds })
        .from(projectCrew)
        .where(eq(projectCrew.projectId, data.projectId)),
      // Svarene fra «Kan du?», så man velger blant dem som faktisk kan.
      d
        .select({ userId: calloutResponses.userId, status: calloutResponses.status, note: calloutResponses.note })
        .from(calloutResponses)
        .innerJoin(postCallouts, eq(calloutResponses.postId, postCallouts.postId))
        .where(eq(postCallouts.projectId, data.projectId)),
    ])

    const childrenMap = buildChildrenMap(partRows)
    const leaves = partRows.filter((p) => p.id !== 'score' && !childrenMap.has(p.id))
    const nameOf = new Map(partRows.map((p) => [p.id, p.nameNo]))
    const crew = crewRows.map((c) => ({ userId: c.userId, partIds: parseCrewPartIds(c.partIds) }))
    const inProgram = new Set(programRows.flatMap((r) => r.id ?? []))
    // Velgeren viser programmets stemmer, pluss det som alt er tildelt. Er
    // programmet tomt, kan man fortsatt velge blant hele besetningen.
    const shown = new Set([...inProgram, ...crew.flatMap((c) => c.partIds)])
    const partOptions = inProgram.size > 0 ? leaves.filter((p) => shown.has(p.id)) : leaves

    return {
      members: memberRows.map((m) => ({
        id: m.id,
        name: m.name,
        ownParts: ownRows.filter((o) => o.userId === m.id).flatMap((o) => nameOf.get(o.partId) ?? []),
      })),
      parts: partOptions.map(({ id, nameNo }) => ({ id, nameNo })),
      crew,
      responses: responseRows,
    }
  })

export const setProjectCrew = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string().min(1),
      members: z
        .array(z.object({ userId: z.string().min(1), partIds: z.array(z.string().min(1)).max(40) }))
        .max(MAX_CREW, `Et oppdrag kan ha maks ${MAX_CREW} musikere`),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission('projects.manage')
    const project = await requireGig(data.projectId)
    const d = db()

    const userIds = [...new Set(data.members.map((m) => m.userId))]
    if (userIds.length !== data.members.length) throw new Error('Samme medlem er valgt to ganger')
    const [active, partRows, existing] = await Promise.all([
      userIds.length
        ? d
            .select({ id: memberProfiles.authUserId })
            .from(memberProfiles)
            .where(and(inArray(memberProfiles.authUserId, userIds), eq(memberProfiles.isActive, true)))
        : Promise.resolve([]),
      d.select({ id: parts.id, parentId: parts.parentId }).from(parts),
      d.select().from(projectCrew).where(eq(projectCrew.projectId, data.projectId)),
    ])
    if (active.length !== userIds.length) throw new Error('Et av medlemmene finnes ikke eller er deaktivert')

    // Snapshot til konkrete løv-stemmer, som vikarlenkene: fil-gaten blir en ren
    // medlemskapssjekk, og en senere endring i treet utvider aldri et oppdrag.
    const known = new Set(partRows.map((p) => p.id))
    if (data.members.some((m) => m.partIds.some((id) => !known.has(id)))) throw new Error('Ukjent stemme')
    const childrenMap = buildChildrenMap(partRows)
    const before = new Map(existing.map((row) => [row.userId, row]))
    const now = new Date()

    const remove = d.delete(projectCrew).where(eq(projectCrew.projectId, data.projectId))
    const inserts = data.members.map((member) =>
      d.insert(projectCrew).values({
        projectId: data.projectId,
        userId: member.userId,
        partIds: JSON.stringify(expandPartIds(member.partIds, childrenMap).filter((id) => !childrenMap.has(id))),
        // Den som først satte medlemmet på oppdraget, står fortsatt som det.
        addedBy: before.get(member.userId)?.addedBy ?? me.id,
        addedAt: before.get(member.userId)?.addedAt ?? now,
      }),
    )
    // Én batch: et avbrutt kall kan aldri etterlate oppdraget uten musikere.
    await d.batch([remove, ...inserts])

    // Bare de som nettopp ble valgt. Å lagre listen på nytt varsler ingen to ganger.
    const added = userIds.filter((id) => !before.has(id) && id !== me.id)
    if (added.length > 0 && project.isPublished && project.eventDate && project.eventDate >= toOsloDate(Date.now())) {
      try {
        const off = await d
          .select({ userId: notificationPreferences.userId })
          .from(notificationPreferences)
          .where(and(inArray(notificationPreferences.userId, added), eq(notificationPreferences.mentions, 'off')))
        const muted = new Set(off.map((row) => row.userId))
        const when = `${formatDate(project.eventDate)}${project.startTime ? ` kl. ${project.startTime}` : ''}`
        await sendPushToUsers(
          added.filter((id) => !muted.has(id)),
          crewAddedPushMessage({ projectId: project.id, name: project.name, when }),
          { ttl: PUSH_TTL.mention, urgency: 'high' },
        )
      } catch (err) {
        // Besetningen er lagret; et varsel som feiler skal ikke velte det.
        console.error('[spilleoppdrag] kunne ikke varsle besetningen:', err)
      }
    }
    return { ok: true, count: inserts.length }
  })
