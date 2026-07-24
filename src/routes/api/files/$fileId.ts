import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '../../../db'
import { downloadLog, projects, projectWorks, shareLinks, workFiles } from '../../../db/schema'
import { newId, sha256Hex } from '../../../lib/id'
import { currentUser, hasFullArchiveAccess, memberFileAccessContext } from '../../../server/access'
import { memberCanAccessFile, shareAllows } from '../../../server/file-access'

function contentTypeFor(fileName: string): string {
  if (/\.pdf$/i.test(fileName)) return 'application/pdf'
  if (/\.mp3$/i.test(fileName)) return 'audio/mpeg'
  if (/\.m4a$/i.test(fileName)) return 'audio/mp4'
  if (/\.wav$/i.test(fileName)) return 'audio/wav'
  if (/\.ogg$/i.test(fileName)) return 'audio/ogg'
  return 'application/octet-stream'
}

export const Route = createFileRoute('/api/files/$fileId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const shareToken = url.searchParams.get('t')
        const wantsDownload = url.searchParams.get('download') === '1'

        const d = db()
        const file = (
          await d.select().from(workFiles).where(eq(workFiles.id, params.fileId)).limit(1)
        )[0]
        if (!file) return new Response('Fant ikke filen', { status: 404 })

        let shareLinkId: string | null = null
        let userId: string | null = null

        const me = await currentUser()
        if (me) {
          userId = me.id
          const canViewAll = hasFullArchiveAccess(me)
          let inAccessibleProject = canViewAll
          if (!canViewAll) {
            const today = new Date().toISOString().slice(0, 10)
            const accessibleProject = (
              await d
                .select({ projectId: projectWorks.projectId })
                .from(projectWorks)
                .innerJoin(projects, eq(projectWorks.projectId, projects.id))
                .where(
                  and(
                    eq(projectWorks.workId, file.workId),
                    eq(projects.isPublished, true),
                    gte(projects.eventDate, today),
                  ),
                )
                .limit(1)
            )[0]
            inAccessibleProject = !!accessibleProject
          }
          // Hard tilgangsstyring: stemmefiler krever egen effektiv stemme eller
          // et løv i aktivt seksjonsleder-scope, og at verket er i et publisert,
          // kommende prosjekt. Partitur krever scores.view. Fullt arkivinnsyn
          // omgår prosjektkravet. Håndheves server-side her — den ENESTE reelle
          // porten — ikke bare i UI-et.
          const ok = memberCanAccessFile(file, memberFileAccessContext(me, inAccessibleProject))
          if (!ok) return new Response('Ingen tilgang til denne filen', { status: 403 })
        } else if (shareToken) {
          // Vikartilgang: token må være gyldig, og filen må tilhøre prosjektet
          // og en av de (snapshottede løv-)stemmene som er delt. Lyd alltid med;
          // partitur/uplassert deles aldri. Aldri arkivinnsyn-bypass her.
          const tokenHash = await sha256Hex(shareToken)
          const share = (
            await d.select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash)).limit(1)
          )[0]
          if (!share || share.revokedAt || share.expiresAt.getTime() < Date.now()) {
            return new Response('Lenken er utløpt eller trukket tilbake', { status: 403 })
          }
          const inProject = (
            await d
              .select()
              .from(projectWorks)
              .where(and(eq(projectWorks.projectId, share.projectId), eq(projectWorks.workId, file.workId)))
              .limit(1)
          )[0]
          const sharedLeafIds = JSON.parse(share.partIds) as string[]
          if (!inProject || !shareAllows(file, sharedLeafIds)) {
            return new Response('Ingen tilgang til denne filen', { status: 403 })
          }
          shareLinkId = share.id
        } else {
          return new Response('Krever innlogging', { status: 401 })
        }

        const object = await env.FILES.get(file.r2Key)
        if (!object) return new Response('Filen mangler i lageret', { status: 404 })

        if (wantsDownload) {
          // Revisjonslogg skal aldri blokkere selve nedlastingen.
          try {
            await d.insert(downloadLog).values({
              id: newId(),
              userId,
              shareLinkId,
              workFileId: file.id,
              at: new Date(),
            })
          } catch (err) {
            console.error('[download_log] kunne ikke logge nedlasting:', err)
          }
        }

        // RFC 5987-dobbelform: filename* gir korrekte norske filnavn (æøå),
        // ASCII-fallback må stripe " og \ siden fileName er brukerstyrt.
        const asciiFallback = file.fileName.replace(/["\\]/g, "'").replace(/[^\x20-\x7E]/g, '_')
        const disposition = `${wantsDownload ? 'attachment' : 'inline'}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
        return new Response(object.body, {
          headers: {
            // octet-stream ved nedlasting hindrer iOS Safari i å overstyre
            // attachment og åpne PDF-en i innebygd viewer i stedet (#21).
            'Content-Type': wantsDownload ? 'application/octet-stream' : contentTypeFor(file.fileName),
            'Content-Length': String(object.size),
            'Content-Disposition': disposition,
            'Cache-Control': 'private, max-age=300',
            'X-Robots-Tag': 'noindex',
            // Hindre at en delingstoken i URL-en lekker via Referer til tredjeparter.
            'Referrer-Policy': 'no-referrer',
          },
        })
      },
    },
  },
})
