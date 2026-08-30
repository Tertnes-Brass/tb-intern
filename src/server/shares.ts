import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { parts, projects, shareLinks, workFiles, workLinks, works, projectWorks } from '../db/schema'
import { newId, newShareToken, sha256Hex } from '../lib/id'
import { requirePermission } from './access'
import { shareAllows } from './file-access'
import { buildChildrenMap, expandPartIds } from './parts-tree'

export const listShares = createServerFn()
  .validator(z.object({ projectId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('shares.manage')
    const d = db()
    const rows = await d
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.projectId, data.projectId))
      .orderBy(desc(shareLinks.createdAt))
    const allParts = await d.select().from(parts).orderBy(asc(parts.sortOrder))
    const partName = new Map(allParts.map((p) => [p.id, p.nameNo]))
    return {
      shares: rows.map((r) => ({
        id: r.id,
        recipientName: r.recipientName,
        partNames: (JSON.parse(r.partIds) as string[]).map((id) => partName.get(id) ?? id),
        expiresAt: r.expiresAt.getTime(),
        createdAt: r.createdAt.getTime(),
        lastUsedAt: r.lastUsedAt?.getTime() ?? null,
        revokedAt: r.revokedAt?.getTime() ?? null,
      })),
    }
  })

export const createShare = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string(),
      recipientName: z.string().min(1, 'Navn er påkrevd'),
      partIds: z.array(z.string()).min(1, 'Velg minst én stemme'),
      days: z.number().int().min(1).max(180),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission('shares.manage')
    const d = db()

    // Snapshot-til-løv: valider stemmene, ekspander forelder → barn, og lagre
    // KUN konkrete løv-id-er. Da fryses vikarens omfang ved opprettelse — en
    // senere tre-endring kan ikke utvide en gammel lenke stille — og fil-gaten
    // blir en ren medlemskaps-sjekk (`shareAllows`).
    const allPartRows = await d.select({ id: parts.id, parentId: parts.parentId }).from(parts)
    const known = new Set(allPartRows.map((r) => r.id))
    if (data.partIds.some((id) => !known.has(id))) throw new Error('Ukjent stemme')
    const childrenMap = buildChildrenMap(allPartRows)
    const leafIds = expandPartIds(data.partIds, childrenMap).filter((id) => !childrenMap.has(id))
    if (leafIds.length === 0) throw new Error('Valgte stemmer har ingen konkrete understemmer å dele')

    const token = newShareToken()
    await d.insert(shareLinks).values({
      id: newId(),
      projectId: data.projectId,
      tokenHash: await sha256Hex(token),
      recipientName: data.recipientName.trim(),
      partIds: JSON.stringify(leafIds),
      expiresAt: new Date(Date.now() + data.days * 86_400_000),
      createdBy: me.id,
      createdAt: new Date(),
    })
    // Klartekst-token returneres KUN her — vi lagrer bare hash. Den delbare
    // URL-en bygges server-side fra BETTER_AUTH_URL, ikke fra nettleserens
    // origin: da peker lenken på det kanoniske domenet selv om den ble laget
    // fra workers.dev-adressen eller fra det gamle noter.-domenet.
    return { token, url: `${new URL(env.BETTER_AUTH_URL).origin}/v/${token}` }
  })

export const revokeShare = createServerFn({ method: 'POST' })
  .validator(z.object({ shareId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission('shares.manage')
    await db()
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(eq(shareLinks.id, data.shareId))
    return { ok: true }
  })

/** Offentlig visning for vikar — autentiseres av selve tokenet, ingen sesjon. */
export const getShareView = createServerFn()
  .validator(z.object({ token: z.string().min(8) }))
  .handler(async ({ data }) => {
    const d = db()
    const tokenHash = await sha256Hex(data.token)
    const share = (await d.select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash)).limit(1))[0]

    if (!share) return { status: 'invalid' as const }
    if (share.revokedAt) return { status: 'revoked' as const }
    if (share.expiresAt.getTime() < Date.now()) return { status: 'expired' as const }

    const project = (await d.select().from(projects).where(eq(projects.id, share.projectId)).limit(1))[0]
    if (!project) return { status: 'invalid' as const }

    const partIds = JSON.parse(share.partIds) as string[]

    const repertoire = await d
      .select({
        workId: works.id,
        title: works.title,
        composer: works.composer,
        arranger: works.arranger,
        durationSec: works.durationSec,
        position: projectWorks.position,
        note: projectWorks.note,
      })
      .from(projectWorks)
      .innerJoin(works, eq(projectWorks.workId, works.id))
      .where(eq(projectWorks.projectId, project.id))
      .orderBy(asc(projectWorks.position))

    const workIds = repertoire.map((r) => r.workId)
    const files =
      workIds.length > 0
        ? await d
            .select({
              id: workFiles.id,
              workId: workFiles.workId,
              kind: workFiles.kind,
              partId: workFiles.partId,
              fileName: workFiles.fileName,
              pageCount: workFiles.pageCount,
              partName: parts.nameNo,
            })
            .from(workFiles)
            .leftJoin(parts, eq(workFiles.partId, parts.id))
            .where(inArray(workFiles.workId, workIds))
        : []
    const links =
      workIds.length > 0 ? await d.select().from(workLinks).where(inArray(workLinks.workId, workIds)) : []

    const partNames = await d.select({ id: parts.id, nameNo: parts.nameNo }).from(parts).where(inArray(parts.id, partIds))

    // Oppdaterer sist brukt (best effort)
    await d.update(shareLinks).set({ lastUsedAt: new Date() }).where(eq(shareLinks.id, share.id))

    return {
      status: 'ok' as const,
      recipientName: share.recipientName,
      partNames: partNames.map((p) => p.nameNo),
      expiresAt: share.expiresAt.getTime(),
      project: {
        name: project.name,
        kind: project.kind,
        eventDate: project.eventDate,
        venue: project.venue,
        description: project.description,
      },
      repertoire: repertoire.map((r) => ({
        ...r,
        files: files
          .filter((f) => f.workId === r.workId && shareAllows({ kind: f.kind, partId: f.partId }, partIds))
          .map((f) => ({ id: f.id, kind: f.kind, partName: f.partName, fileName: f.fileName, pageCount: f.pageCount })),
        links: links
          .filter((l) => l.workId === r.workId)
          .map((l) => ({ id: l.id, kind: l.kind, url: l.url, label: l.label })),
      })),
    }
  })
