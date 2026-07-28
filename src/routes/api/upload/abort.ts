import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { currentUser, hasPermission } from '../../../server/access'
import { verifyUploadTicket } from '../../../server/upload-token'

const Body = z.object({ token: z.string().min(1) })

/**
 * Rydder opp en avbrutt opplasting, slik at R2 ikke sitter igjen med
 * halvferdige deler. Kalles av klienten når noe feiler underveis.
 */
export const Route = createFileRoute('/api/upload/abort')({
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
        if (!ticket) return Response.json({ ok: true })

        try {
          await env.FILES.resumeMultipartUpload(ticket.key, ticket.uploadId).abort()
        } catch {
          // Allerede fullført eller ryddet — ingenting å gjøre.
        }
        return Response.json({ ok: true })
      },
    },
  },
})
