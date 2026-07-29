import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db'
import { parts, workFiles, works } from '../../../db/schema'
import { guessPartFromFilename, isAudioFilename } from '../../../lib/taxonomy'
import { MAX_PARTS } from '../../../lib/upload'
import { currentUser, hasPermission } from '../../../server/access'
import { verifyUploadTicket } from '../../../server/upload-token'

const Body = z.object({
  token: z.string().min(1),
  // Talt i nettleseren; null når filen ikke er PDF eller ikke lot seg tolke.
  pageCount: z.number().int().positive().nullable(),
  // Eksplisitt stemme fra PDF-splitteren, som allerede vet svaret. Utelatt
  // eller null = gjett fra filnavnet.
  partId: z.string().min(1).nullish(),
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
    .min(1)
    .max(MAX_PARTS),
})

/**
 * Setter sammen delene til ett R2-objekt og registrerer filen på verket.
 * Stemmen gjettes fra filnavnet, med mindre klienten oppgir den eksplisitt.
 */
export const Route = createFileRoute('/api/upload/complete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const me = await currentUser()
        if (!me || !hasPermission(me, 'works.manage')) {
          return Response.json({ error: 'Krever arkivar-tilgang' }, { status: 403 })
        }

        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json({ error: 'Ugyldig forespørsel' }, { status: 400 })
        }

        const ticket = await verifyUploadTicket(parsed.data.token, me.id)
        if (!ticket) {
          return Response.json({ error: 'Opplastingen er utløpt — prøv på nytt' }, { status: 400 })
        }

        const upload = env.FILES.resumeMultipartUpload(ticket.key, ticket.uploadId)
        let object: R2Object
        try {
          object = await upload.complete(parsed.data.parts)
        } catch {
          return Response.json({ error: 'Klarte ikke sette sammen filen' }, { status: 400 })
        }

        const d = db()
        const partDefs = await d.select().from(parts).orderBy(asc(parts.sortOrder))
        const isAudio = isAudioFilename(ticket.fileName)
        // En eksplisitt stemme må finnes i besetningen. Faller vi tilbake til
        // gjetting her, ville en skrivefeil i klienten stille gitt feil stemme.
        const explicit = isAudio ? null : (parsed.data.partId ?? null)
        if (explicit && !partDefs.some((p) => p.id === explicit)) {
          return Response.json({ error: 'Ukjent stemme' }, { status: 400 })
        }
        const partId = explicit ?? (isAudio ? null : guessPartFromFilename(ticket.fileName, partDefs))
        const kind = isAudio ? 'audio' : partId === 'score' ? 'score' : partId ? 'part' : 'other'

        await d.insert(workFiles).values({
          id: ticket.fileId,
          workId: ticket.workId,
          kind,
          partId,
          label: null,
          r2Key: ticket.key,
          fileName: ticket.fileName,
          // R2 er fasit på størrelsen, ikke det klienten oppga.
          fileSize: object.size,
          pageCount: isAudio ? null : parsed.data.pageCount,
          uploadedBy: me.id,
          uploadedAt: new Date(),
        })
        await d.update(works).set({ updatedAt: new Date() }).where(eq(works.id, ticket.workId))

        return Response.json({
          file: {
            id: ticket.fileId,
            fileName: ticket.fileName,
            kind,
            partId,
            partName: partId ? (partDefs.find((p) => p.id === partId)?.nameNo ?? null) : null,
            pageCount: isAudio ? null : parsed.data.pageCount,
          },
        })
      },
    },
  },
})
