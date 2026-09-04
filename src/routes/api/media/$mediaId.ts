import { createFileRoute } from '@tanstack/react-router'
import { contentRangeHeader, parseByteRange, unsatisfiableRangeHeader } from '../../../lib/media'
import { currentUser } from '../../../server/access'
import { getMediaObject, mediaAccess } from '../../../server/media-files'

/**
 * Den ENESTE veien til bytene i et medieelement (#32).
 *
 * Gaten er `mediaAccess`, som håndhever tilgangsnivået server-side: `intern` og
 * `offentlig-kandidat` til alle aktive medlemmer, `styre` kun ved
 * `board.manage`. Regelen bor der og ikke her, slik at lista, detaljsiden og
 * filstrømmen ikke kan komme i utakt. «Finnes ikke» og «ikke tilgang» får
 * samme 404: å skille dem ville gjort ruta til et oppslagsverk over hvilke
 * styreopptak som finnes.
 *
 * Ingen delingstokens — arkivet er internt (docs/tilgangsstyring.md), og
 * bytene skal aldri kunne hentes gjennom note-gaten i `/api/files/$fileId`.
 *
 * **Range-støtte er ikke pynt.** En `<audio>` eller `<video>` ber om
 * `Range` før den spiller, og en server som svarer 200 med hele filen gjør at
 * spilleren ikke kan spole — på Safari (iOS) starter den ikke i det hele tatt.
 * Uten dette ville et 40 minutters konsertopptak måttet lastes ned i sin helhet
 * for at noen skulle høre siste sats. R2 tar utsnittet selv (`get(key, {range}))`,
 * så vi leser aldri hele objektet inn i minnet for å kutte i det.
 *
 * Størrelsen leses fra raden (`size` skrives av opplastingsruta fra de faktiske
 * bytene), ikke fra en `head()` mot R2 — det ville vært en ekstra rundtur per
 * forespørsel, og en mediespiller sender mange.
 */
export const Route = createFileRoute('/api/media/$mediaId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })

        const item = await mediaAccess(params.mediaId, me)
        if (!item) return new Response('Fant ikke medieelementet', { status: 404 })

        const asciiFallback = item.fileName.replace(/["\\]/g, "'").replace(/[^\x20-\x7E]/g, '_')
        // `?last=1` for nedlastingsknappen. Uten den vises og spilles filen i
        // nettleseren. Innholdstypene er begrenset til lyd, bilde og video
        // (`mediaKindFor`), så `inline` kan aldri bli et HTML- eller
        // SVG-dokument som kjører skript på vårt eget origin.
        const download = new URL(request.url).searchParams.get('last') === '1'
        const disposition = download ? 'attachment' : 'inline'
        const baseHeaders: Record<string, string> = {
          'Content-Type': item.contentType,
          'Content-Disposition': `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
          // Uten denne spør ikke nettleseren om utsnitt, og spolestripen blir
          // død selv om vi hadde svart riktig på en Range vi aldri fikk.
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
          'Referrer-Policy': 'no-referrer',
        }

        const requested = parseByteRange(request.headers.get('range'), item.size)

        if (requested.kind === 'unsatisfiable') {
          return new Response('Utenfor filen', {
            status: 416,
            headers: { 'Content-Range': unsatisfiableRangeHeader(item.size), 'Accept-Ranges': 'bytes' },
          })
        }

        const range = requested.kind === 'range' ? requested.range : undefined
        const object = await getMediaObject(item.r2Key, range)
        if (!object) return new Response('Filen mangler i lageret', { status: 404 })

        if (range) {
          return new Response(object.body, {
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Length': String(range.length),
              'Content-Range': contentRangeHeader(range, item.size),
            },
          })
        }

        return new Response(object.body, {
          headers: { ...baseHeaders, 'Content-Length': String(object.size) },
        })
      },
    },
  },
})
