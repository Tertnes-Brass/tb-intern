import { createFileRoute } from '@tanstack/react-router'
import { BAND_MEDIA_PERMISSION } from '../../../lib/band-media'
import { currentUser, hasPermission } from '../../../server/access'
import { storeBandMedia } from '../../../server/band-media-store'
import { MediaUploadError, readMediaBody } from '../../../server/message-media'

/**
 * Legger en GIF i Tertnes-samlingen: én PUT med bytene, navnet i `?title=`
 * (æ/ø/å tåles ikke i en header). Krever `gifs.manage`. Bytene kontrolleres
 * som en vanlig opplasting — maks 10 MB, og formatet leses fra bytene.
 */
export const Route = createFileRoute('/api/band-media/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        if (!hasPermission(me, BAND_MEDIA_PERMISSION)) return Response.json({ error: 'Ingen tilgang' }, { status: 403 })
        const title = new URL(request.url).searchParams.get('title') ?? ''
        try {
          return Response.json(await storeBandMedia(await readMediaBody(request), title, me))
        } catch (err) {
          if (err instanceof MediaUploadError) return Response.json({ error: err.message }, { status: 400 })
          throw err
        }
      },
    },
  },
})
