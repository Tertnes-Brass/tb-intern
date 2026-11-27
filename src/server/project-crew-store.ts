import { and, asc, eq, gte, inArray, lte, ne, or } from 'drizzle-orm'
import type { Db } from '../db'
import { memberProfiles, parts, projectCrew, projects, user, userParts } from '../db/schema'
import { type AgendaEvent, gigCalendarEvent } from '../lib/gig-calendar'
import { GIG_KIND, parseCrewPartIds } from '../lib/project-access'

/**
 * Databasehjelpere for spilleoppdrag. Tar `d` som parameter og rører aldri
 * `cloudflare:workers`, så de kan brukes fra både serverfunksjoner og fil-gaten.
 */

/** Vanlige prosjekter, pluss de spilleoppdragene dette medlemmet er med på. */
export function visibleToMember(d: Db, userId: string) {
  return or(
    ne(projects.kind, GIG_KIND),
    inArray(
      projects.id,
      d.select({ id: projectCrew.projectId }).from(projectCrew).where(eq(projectCrew.userId, userId)),
    ),
  )
}

/** Rå `part_ids` for medlemmet på oppdraget, eller `null` når hen ikke er med. */
export async function crewPartIdsFor(d: Db, projectId: string, userId: string): Promise<string | null> {
  const row = (
    await d
      .select({ partIds: projectCrew.partIds })
      .from(projectCrew)
      .where(and(eq(projectCrew.projectId, projectId), eq(projectCrew.userId, userId)))
      .limit(1)
  )[0]
  return row?.partIds ?? null
}

export type CrewMember = {
  userId: string
  name: string
  /** Stemmene på oppdraget: de tildelte, ellers medlemmets vanlige. */
  parts: Array<{ id: string; nameNo: string }>
  /** Har fått egne stemmer for dette oppdraget. */
  assigned: boolean
}

/** Aktive medlemmer på oppdraget, med stemmene de spiller. */
export async function listCrew(d: Db, projectId: string): Promise<CrewMember[]> {
  const rows = await d
    .select({ userId: projectCrew.userId, name: user.name, partIds: projectCrew.partIds })
    .from(projectCrew)
    .innerJoin(user, eq(projectCrew.userId, user.id))
    .innerJoin(memberProfiles, eq(memberProfiles.authUserId, user.id))
    .where(and(eq(projectCrew.projectId, projectId), eq(memberProfiles.isActive, true)))
    .orderBy(asc(user.name))
  if (rows.length === 0) return []

  const [partRows, ownRows] = await Promise.all([
    d.select({ id: parts.id, nameNo: parts.nameNo, sortOrder: parts.sortOrder }).from(parts),
    d
      .select({ userId: userParts.userId, partId: userParts.partId })
      .from(userParts)
      .where(inArray(userParts.userId, rows.map((r) => r.userId))),
  ])
  const partById = new Map(partRows.map((p) => [p.id, p]))
  return rows.map((row) => {
    const assignedIds = parseCrewPartIds(row.partIds).filter((id) => partById.has(id))
    const ids = assignedIds.length > 0 ? assignedIds : ownRows.filter((o) => o.userId === row.userId).map((o) => o.partId)
    const memberParts = ids
      .flatMap((id) => partById.get(id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id, nameNo }) => ({ id, nameNo }))
    return { userId: row.userId, name: row.name, parts: memberParts, assigned: assignedIds.length > 0 }
  })
}

/** Publiserte oppdrag medlemmet er med på i datointervallet, som kalenderrader. */
export async function myGigEvents(d: Db, userId: string, fromDate: string, toDate: string): Promise<AgendaEvent[]> {
  const rows = await d
    .select({
      id: projects.id,
      name: projects.name,
      eventDate: projects.eventDate,
      startTime: projects.startTime,
      venue: projects.venue,
      description: projects.description,
    })
    .from(projectCrew)
    .innerJoin(projects, eq(projectCrew.projectId, projects.id))
    .where(
      and(
        eq(projectCrew.userId, userId),
        eq(projects.kind, GIG_KIND),
        eq(projects.isPublished, true),
        gte(projects.eventDate, fromDate),
        lte(projects.eventDate, toDate),
      ),
    )
    .orderBy(asc(projects.eventDate))
  return rows.flatMap((row) => (row.eventDate ? [gigCalendarEvent({ ...row, eventDate: row.eventDate })] : []))
}
