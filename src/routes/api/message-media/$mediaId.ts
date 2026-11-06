import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { currentUser } from '../../../server/access'
import { discardPendingMedia, messageMediaAccess } from '../../../server/message-media'

/**
 * Den ENESTE veien til bytene i et bilde i en samtale. Gaten gjentar regelen
 * til det bildet står i (`messageMediaAccess`): et bilde i styrechatten kan ikke
 * hentes av et vanlig medlem som gjetter en id, og et bilde i en slettet melding
 * er borte med meldingen. Innholdet endres aldri, så nettleseren får en ETag og
 * et 304 neste gang — men gaten kjører hver gang.
 *
 * Et valg fra GIF-velgeren har ingen bytes hos oss: etter samme sjekk sendes
 * man videre til KLIPYs CDN. Nettsiden viser KLIPY-adressen direkte, og
 * mobilappen følger med vilje aldri omdirigeringer (den får merkelappen «GIF»
 * i stedet, se `mobileMediaRow`), så dette er for alle andre som har stien.
 */
export const Route = createFileRoute('/api/message-media/$mediaId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })

        const media = await messageMediaAccess(params.mediaId, me)
        // Finnes ikke / ikke for deg gir samme svar.
        if (!media) return new Response('Fant ikke bildet', { status: 404 })
        if (media.source === 'klipy') {
          return new Response(null, {
            status: 302,
            headers: { Location: media.externalUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
          })
        }

        const object = await env.FILES.get(media.r2Key, { onlyIf: request.headers })
        if (!object) return new Response('Bildet mangler i lageret', { status: 404 })

        const headers = new Headers({
          'Content-Type': media.contentType,
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

      /** Krysset vekk fra skrivefeltet før meldingen ble sendt. Bare eget utkast. */
      DELETE: async ({ params }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        await discardPendingMedia(params.mediaId, me.id)
        // Samme svar uansett: et sendt bilde slettes med meldingen, ikke her.
        return new Response(null, { status: 204 })
      },
    },
  },
})
