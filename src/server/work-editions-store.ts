import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { workEditions, works } from '../db/schema'

/** Undefined velger gjeldende utgave; null velger originalen eksplisitt. */
export async function resolveEdition(d: Db, workId: string, editionId?: string | null) {
  const work = (await d.select({ currentEditionId: works.currentEditionId }).from(works).where(eq(works.id, workId)).limit(1))[0]
  if (!work) throw new Error('Fant ikke verket')
  const selected = editionId === undefined ? work.currentEditionId : editionId
  if (selected !== null) {
    const edition = (await d.select({ id: workEditions.id }).from(workEditions)
      .where(and(eq(workEditions.id, selected), eq(workEditions.workId, workId))).limit(1))[0]
    if (!edition) throw new Error('Utgaven tilhører ikke dette verket')
  }
  return selected
}
