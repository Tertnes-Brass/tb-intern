import { createFileRoute } from '@tanstack/react-router'
import { currentUser } from '../../../server/access'
import { MediaUploadError, readMediaBody, storeMessageMedia } from '../../../server/message-media'

/**
 * Opplasting av ett bilde eller én GIF til en melding som ennå ikke er sendt —
 * i forumet, i en kommentar eller i en chat. Én PUT per fil, som veggbildene.
 *
 * Gaten er bare innlogging: bildet er et utkast som kun eieren ser, og det er
 * serverfunksjonen som sender meldingen som avgjør om det får stå der (den
 * sjekker området og kobler bildet til meldingen). Et tak på antall utkast per
 * medlem og den daglige ryddingen holder lageret rent.
 */
export const Route = createFileRoute('/api/message-media/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        try {
          return Response.json(await storeMessageMedia(await readMediaBody(request), me))
        } catch (err) {
          if (err instanceof MediaUploadError) return Response.json({ error: err.message }, { status: 400 })
          throw err
        }
      },
    },
  },
})
