import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { boardDocuments } from '../../../db/schema'
import { currentUser, hasPermission } from '../../../server/access'
import { canRenderInline, getBoardObject } from '../../../server/board-files'

/**
 * Gaten for styredokumenter. Den eneste veien til bytene i `board/…`:
 * uinnlogget gir 401, innlogget uten `board.manage` gir 403. Ingen
 * delingstokens, ingen offentlige URL-er, og aldri via note-gaten i
 * `/api/files/$fileId` — den håndhever et helt annet tilgangsbegrep (stemmer og
 * vikarlenker) som ikke gir mening for styrepapirer.
 */
export const Route = createFileRoute('/api/board-files/$documentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const me = await currentUser()
        if (!me) return new Response('Krever innlogging', { status: 401 })
        if (!hasPermission(me, 'board.manage')) {
          return new Response('Ingen tilgang til styredokumenter', { status: 403 })
        }

        const doc = (
          await db().select().from(boardDocuments).where(eq(boardDocuments.id, params.documentId)).limit(1)
        )[0]
        if (!doc) return new Response('Fant ikke dokumentet', { status: 404 })

        const object = await getBoardObject(doc.r2Key)
        if (!object) return new Response('Filen mangler i lageret', { status: 404 })

        // Alt som ikke er trygt å vise inline strømmes som nedlasting med
        // octet-stream — et opplastet HTML-dokument skal aldri kunne kjøre
        // skript på vårt eget origin.
        const wantsDownload = new URL(request.url).searchParams.get('download') === '1'
        const inline = !wantsDownload && canRenderInline(doc.contentType)
        // RFC 5987-dobbelform: filename* gir korrekte norske filnavn (æøå),
        // ASCII-fallback må stripe " og \ siden fileName er brukerstyrt.
        const asciiFallback = doc.fileName.replace(/["\\]/g, "'").replace(/[^\x20-\x7E]/g, '_')
        const disposition = `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`

        return new Response(object.body, {
          headers: {
            'Content-Type': inline ? doc.contentType : 'application/octet-stream',
            'Content-Length': String(object.size),
            'Content-Disposition': disposition,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=300',
            'X-Robots-Tag': 'noindex',
            'Referrer-Policy': 'no-referrer',
          },
        })
      },
    },
  },
})
