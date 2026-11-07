import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { currentUser } from '../../../server/access'
import { bandMediaSource } from '../../../server/band-media-store'

/**
 * Den ENESTE veien til bytene i Tertnes-samlingen: alle innloggede medlemmer
 * (det er de som kan velge dem), ingen andre. Ikke i `public/` med vilje — repoet
 * er offentlig, og GIF-ene viser folk i korpset. Innholdet bak en id endres
 * aldri, så nettleseren får en ETag og et 304 neste gang, men gaten kjører hver
 * gang: en GIF som fjernes, er borte for alle som ikke allerede har den i cachen.
 */
export const Route = createFileRoute('/api/band-media/$mediaId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })

        const source = await bandMediaSource(params.mediaId)
        if (!source) return new Response('Fant ikke GIF-en', { status: 404 })
        const object = await env.FILES.get(source.r2Key, { onlyIf: request.headers })
        if (!object) return new Response('GIF-en mangler i lageret', { status: 404 })

        const headers = new Headers({
          'Content-Type': source.contentType,
          'Content-Disposition': 'inline',
          ETag: object.httpEtag,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Robots-Tag': 'noindex',
          'Referrer-Policy': 'no-referrer',
        })
        // `onlyIf` med If-None-Match: R2 gir objektet uten kropp når ETag-en stemmer.
        if (!('body' in object)) return new Response(null, { status: 304, headers })
        headers.set('Content-Length', String(object.size))
        return new Response(object.body, { headers })
      },
    },
  },
})
