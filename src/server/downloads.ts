import { createServerFn } from '@tanstack/react-start'
import { type SQL, and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  downloadLog,
  memberProfiles,
  parts,
  projectWorks,
  projects,
  shareLinks,
  user,
  workFiles,
  works,
} from '../db/schema'
import { requirePermission } from './access'

const PAGE_SIZE = 50

type Filters = {
  page: number
  projectId?: string
  workId?: string
  userId?: string
  shareLinkId?: string
  from?: string
  to?: string
}

export const listDownloads = createServerFn()
  .validator(
    z
      .object({
        page: z.number().int().min(1).default(1),
        projectId: z.string().optional(),
        workId: z.string().optional(),
        userId: z.string().optional(),
        shareLinkId: z.string().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requirePermission('downloads.view')
    const d = db()
    const f: Filters = data ?? { page: 1 }

    const conds: Array<SQL | undefined> = []
    if (f.workId) conds.push(eq(workFiles.workId, f.workId))
    if (f.userId) conds.push(eq(downloadLog.userId, f.userId))
    if (f.shareLinkId) conds.push(eq(downloadLog.shareLinkId, f.shareLinkId))
    // «Prosjekt» = vikarlenker knyttet til prosjektet + filer på verk i
    // prosjektets NÅVÆRENDE repertoar (historiske treff følger repertoaret).
    if (f.projectId)
      conds.push(
        or(
          eq(shareLinks.projectId, f.projectId),
          inArray(
            workFiles.workId,
            d.select({ id: projectWorks.workId }).from(projectWorks).where(eq(projectWorks.projectId, f.projectId)),
          ),
        ),
      )
    if (f.from) conds.push(gte(downloadLog.at, new Date(`${f.from}T00:00:00`)))
    if (f.to) conds.push(lte(downloadLog.at, new Date(`${f.to}T23:59:59.999`)))
    const where = conds.length > 0 ? and(...conds) : undefined

    const rows = await d
      .select({
        id: downloadLog.id,
        at: downloadLog.at,
        accessType: downloadLog.accessType,
        userId: downloadLog.userId,
        userName: user.name,
        shareLinkId: downloadLog.shareLinkId,
        shareRecipient: shareLinks.recipientName,
        fileName: workFiles.fileName,
        kind: workFiles.kind,
        label: workFiles.label,
        partName: parts.nameNo,
        workId: works.id,
        workTitle: works.title,
      })
      .from(downloadLog)
      .innerJoin(workFiles, eq(downloadLog.workFileId, workFiles.id))
      .innerJoin(works, eq(workFiles.workId, works.id))
      .leftJoin(user, eq(downloadLog.userId, user.id))
      .leftJoin(shareLinks, eq(downloadLog.shareLinkId, shareLinks.id))
      .leftJoin(parts, eq(workFiles.partId, parts.id))
      .where(where)
      .orderBy(desc(downloadLog.at))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE)

    // Totalen trenger kun joinene filtrene refererer (workFiles + shareLinks).
    const totalRow = await d
      .select({ n: sql<number>`count(*)` })
      .from(downloadLog)
      .innerJoin(workFiles, eq(downloadLog.workFileId, workFiles.id))
      .leftJoin(shareLinks, eq(downloadLog.shareLinkId, shareLinks.id))
      .where(where)

    // Filtervalg til nedtrekkslistene — små datamengder på korps-skala.
    const [projectOpts, workOpts, memberOpts, shareOpts] = await Promise.all([
      d
        .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
        .from(projects)
        .orderBy(desc(projects.eventDate)),
      d.select({ id: works.id, title: works.title }).from(works).orderBy(asc(works.title)),
      d
        .select({ id: user.id, name: user.name })
        .from(memberProfiles)
        .innerJoin(user, eq(memberProfiles.authUserId, user.id))
        .orderBy(asc(user.name)),
      d
        .select({ id: shareLinks.id, recipientName: shareLinks.recipientName, projectId: shareLinks.projectId })
        .from(shareLinks)
        .orderBy(desc(shareLinks.createdAt)),
    ])

    return {
      // Epoch-ms-konvensjon som i shares.ts — unngår Date-serialisering i loaderen.
      rows: rows.map((r) => ({ ...r, at: r.at.getTime() })),
      total: totalRow[0]?.n ?? 0,
      page: f.page,
      pageSize: PAGE_SIZE,
      options: { projects: projectOpts, works: workOpts, members: memberOpts, shares: shareOpts },
    }
  })
