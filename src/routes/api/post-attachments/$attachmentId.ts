import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { attachmentDisposition } from '../../../lib/post-attachments'
import { currentUser } from '../../../server/access'
import { postAttachmentAccess } from '../../../server/post-attachment-storage'

export const Route = createFileRoute('/api/post-attachments/$attachmentId')({
  server: { handlers: {
    GET: async ({ params }) => {
      const me = await currentUser()
      if (!me) return new Response('Krever innlogging', { status: 401 })
      const attachment = await postAttachmentAccess(params.attachmentId, me)
      if (!attachment) return new Response('Fant ikke vedlegget', { status: 404 })
      const object = await env.FILES.get(attachment.r2Key)
      if (!object) return new Response('Fant ikke vedlegget', { status: 404 })
      return new Response(object.body, { headers: {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size),
        'Content-Disposition': attachmentDisposition(attachment.fileName),
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
      } })
    },
  } },
})
