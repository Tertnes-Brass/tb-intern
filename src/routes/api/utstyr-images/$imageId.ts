import { createFileRoute } from '@tanstack/react-router'
import { currentUser } from '../../../server/access'
import { assetImageAccess, getAssetObject } from '../../../server/utstyr-images'

/**
 * Den ENESTE veien til bytene i et utstyrsbilde. Gaten er innlogging: hele
 * registeret er lesbart for aktive medlemmer, så et bilde av en skarptromme er
 * det også. Skriving er en annen sak og krever `assets.manage`.
 *
 * Ingen delingstokens her — registeret er internt (docs/tilgangsstyring.md), og
 * bildene skal aldri kunne hentes gjennom note-gaten i `/api/files/$fileId`.
 */
export const Route = createFileRoute('/api/utstyr-images/$imageId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })

        const image = await assetImageAccess(params.imageId)
        if (!image) return new Response('Fant ikke bildet', { status: 404 })

        const object = await getAssetObject(image.r2Key)
        if (!object) return new Response('Bildet mangler i lageret', { status: 404 })

        const asciiFallback = image.fileName.replace(/["\\]/g, "'").replace(/[^\x20-\x7E]/g, '_')
        return new Response(object.body, {
          headers: {
            'Content-Type': image.contentType,
            'Content-Length': String(object.size),
            'Content-Disposition': `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(image.fileName)}`,
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex',
            'Referrer-Policy': 'no-referrer',
          },
        })
      },
    },
  },
})
