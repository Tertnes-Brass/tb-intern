import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { MAX_PARTS } from '../../../lib/upload'
import { currentUser, hasPermission } from '../../../server/access'
import { verifyUploadTicket } from '../../../server/upload-token'

/**
 * Tar imot én del av en pågående opplasting og skyver den rett til R2.
 * Kroppen er én bit (se PART_SIZE), så minnebruken per request er liten
 * uansett hvor stor filen er.
 */
export const Route = createFileRoute('/api/upload/part')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me || !hasPermission(me, 'works.manage')) {
          return Response.json({ error: 'Krever arkivar-tilgang' }, { status: 403 })
        }

        const url = new URL(request.url)
        const ticket = await verifyUploadTicket(url.searchParams.get('token'), me.id)
        if (!ticket) {
          return Response.json({ error: 'Opplastingen er utløpt — prøv på nytt' }, { status: 400 })
        }

        const partNumber = Number(url.searchParams.get('part'))
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
          return Response.json({ error: 'Ugyldig delnummer' }, { status: 400 })
        }

        const body = await request.arrayBuffer()
        if (body.byteLength === 0) {
          return Response.json({ error: 'Tom del' }, { status: 400 })
        }

        const upload = env.FILES.resumeMultipartUpload(ticket.key, ticket.uploadId)
        const part = await upload.uploadPart(partNumber, body)

        return Response.json({ partNumber: part.partNumber, etag: part.etag })
      },
    },
  },
})
