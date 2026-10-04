import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db'
import { works } from '../../../db/schema'
import { newId } from '../../../lib/id'
import { PART_SIZE, uploadExtension, uploadRejectionReason } from '../../../lib/upload'
import { currentUser, hasPermission } from '../../../server/access'
import { resolveEdition } from '../../../server/work-editions-store'
import { signUploadTicket } from '../../../server/upload-token'

const Body = z.object({
  workId: z.string().min(1),
  editionId: z.string().min(1).nullable().optional(),
  fileName: z.string().min(1).max(300),
  // Grensene håndheves av uploadRejectionReason, som gir en begrunnelse
  // klienten kan vise — her slipper vi bare gjennom noe som er et tall.
  fileSize: z.number().int().min(0),
})

/**
 * Åpner en multipart-opplasting mot R2 og gir klienten en signert billett.
 * Selve bytene sendes inn via ./part. Filer som ikke godtas avvises her, med
 * en begrunnelse klienten kan vise — ikke i stillhet slik som før.
 */
export const Route = createFileRoute('/api/upload/start')({
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
        const { workId, fileName, fileSize } = parsed.data

        const reason = uploadRejectionReason({ name: fileName, size: fileSize })
        if (reason) return Response.json({ error: reason }, { status: 400 })

        const work = (
          await db().select({ id: works.id }).from(works).where(eq(works.id, workId)).limit(1)
        )[0]
        if (!work) return Response.json({ error: 'Fant ikke verket' }, { status: 404 })

        let editionId: string | null
        try { editionId = await resolveEdition(db(), workId, parsed.data.editionId) }
        catch { return Response.json({ error: 'Utgaven tilhører ikke dette verket' }, { status: 400 }) }

        const fileId = newId()
        const key = `works/${workId}/${fileId}.${uploadExtension(fileName)}`
        const upload = await env.FILES.createMultipartUpload(key)

        const token = await signUploadTicket({
          workId,
          editionId,
          fileId,
          key,
          uploadId: upload.uploadId,
          fileName,
          userId: me.id,
        })

        return Response.json({ token, partSize: PART_SIZE })
      },
    },
  },
})
