import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { currentUser } from '../../../server/access'
import { postImageAccess } from '../../../server/post-images'

/**
 * Den ENESTE veien til bytene i et veggbilde. Gaten er innlogging pluss samme
 * synlighetsregel som innlegget selv (`canReadPost`): et bilde på en beskjed
 * merket for styret skal ikke kunne hentes av et vanlig medlem som gjetter en
 * id. Ingen delingstokens her — veggen er intern (docs/tilgangsstyring.md).
 */
export const Route = createFileRoute('/api/post-images/$imageId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })

        const image = await postImageAccess(params.imageId, me)
        // Finnes ikke / ikke for deg gir samme svar, så en id ikke kan brukes
        // til å bekrefte at et styre-innlegg finnes.
        if (!image) return new Response('Fant ikke bildet', { status: 404 })

        const object = await env.FILES.get(image.r2Key)
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
