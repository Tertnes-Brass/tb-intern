import { createFileRoute } from '@tanstack/react-router'
import { currentUser } from '../../../server/access'
import { canAttachPostFiles, readAttachmentBody, storePostAttachment } from '../../../server/post-attachment-storage'

export const Route = createFileRoute('/api/post-attachments/upload')({
  server: { handlers: {
    PUT: async ({ request }) => {
      const me = await currentUser()
      if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
      const query = new URL(request.url).searchParams
      const postId = query.get('postId')?.trim()
      if (!postId) return Response.json({ error: 'Mangler beskjed' }, { status: 400 })
      if (!(await canAttachPostFiles(postId, me))) return Response.json({ error: 'Du kan ikke legge vedlegg på denne beskjeden' }, { status: 403 })
      let bytes: Uint8Array
      try { bytes = await readAttachmentBody(request) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Kunne ikke lese filen' }, { status: 400 }) }
      try { return Response.json(await storePostAttachment(postId, query.get('fileName') ?? 'vedlegg', bytes, me)) }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('Maks ')) return Response.json({ error: error.message }, { status: 400 })
        throw error
      }
    },
  } },
})
