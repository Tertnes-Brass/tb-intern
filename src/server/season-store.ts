import { and, asc, gte, lte } from 'drizzle-orm'
import type { Db } from '../db'
import { seasons } from '../db/schema'
import { newId } from '../lib/id'
import { seasonForDate } from './project-list'

/**
 * Sesongen datoen hører til, opprettet ved behov. Slår opp på DATOINTERVALL og
 * ikke på navn: en sesong som er døpt om for hånd («Jubileumshøsten 2026») skal
 * gjenbrukes, ikke få en duplikat med standardnavnet ved siden av seg.
 */
export async function findOrCreateSeason(d: Db, eventDate: string): Promise<string> {
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
