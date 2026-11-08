import { createFileRoute } from '@tanstack/react-router'
import { BAND_MEDIA_CONSENT_REQUIRED } from '../../../lib/band-media'
import { currentUser } from '../../../server/access'
import { storeBandMedia } from '../../../server/band-media-store'
import { MediaUploadError, readMediaBody } from '../../../server/message-media'

/**
 * Legger en GIF i Tertnes-samlingen: én PUT med bytene, navnet i `?title=`
 * (æ/ø/å tåles ikke i en header). Alle innloggede medlemmer kan legge til, men
 * bare med `?consent=1`: at alle som er med i GIF-en har sagt ja (avkrysningen i
 * skjemaet). Bytene kontrolleres som en vanlig opplasting — maks 10 MB, og
 * formatet leses fra bytene.
 */
export const Route = createFileRoute('/api/band-media/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        const params = new URL(request.url).searchParams
        if (params.get('consent') !== '1') return Response.json({ error: BAND_MEDIA_CONSENT_REQUIRED }, { status: 400 })
        const title = params.get('title') ?? ''
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
