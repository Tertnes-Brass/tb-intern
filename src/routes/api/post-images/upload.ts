import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../../db'
import { postImages } from '../../../db/schema'
import { newId } from '../../../lib/id'
import {
  MAX_POST_IMAGES,
  MAX_POST_IMAGE_BYTES,
  imageExtension,
  imageRejectionReason,
} from '../../../lib/posts'
import { currentUser } from '../../../server/access'
import { canAttachImages } from '../../../server/post-images'

/**
 * Enkel én-forespørsels-opplasting av ett bilde til et innlegg på veggen.
 *
 * Note-arkivets multipart-flyt (`/api/upload/*`) er laget for store PDF-er med
 * signerte billetter og stemme-gjenkjenning; et telefonbilde på noen megabyte
 * trenger ingen av delene. Gaten er `requireMe()` + at du eier innlegget (eller
 * har `posts.publish`). R2-nøkkelen bygges ALLTID av en fersk id — aldri av
 * filnavnet, som er brukerstyrt.
 */
export const Route = createFileRoute('/api/post-images/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })

        const url = new URL(request.url)
        const postId = url.searchParams.get('postId')?.trim()
        const fileName = (url.searchParams.get('fileName') ?? 'bilde').slice(0, 200)
        const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
        if (!postId) return Response.json({ error: 'Mangler innlegg' }, { status: 400 })

        if (!(await canAttachImages(postId, me))) {
          return Response.json({ error: 'Du kan bare legge bilder på dine egne innlegg' }, { status: 403 })
        }

        // Content-Length er en påstand fra klienten; den brukes kun til å avvise
        // tidlig. Den virkelige grensen håndheves på bytene under.
        const declared = Number(request.headers.get('content-length') ?? '0')
        const earlyReason = imageRejectionReason({ type: contentType, size: declared || 1 })
        if (earlyReason) return Response.json({ error: earlyReason }, { status: 400 })

        const d = db()
        const countRow = await d
          .select({ n: sql<number>`count(*)` })
          .from(postImages)
          .where(eq(postImages.postId, postId))
        const count = countRow[0]?.n ?? 0
        if (count >= MAX_POST_IMAGES) {
          return Response.json({ error: `Maks ${MAX_POST_IMAGES} bilder per innlegg` }, { status: 400 })
        }

        const bytes = new Uint8Array(await request.arrayBuffer())
        const reason = imageRejectionReason({ type: contentType, size: bytes.byteLength })
        if (reason) return Response.json({ error: reason }, { status: 400 })
        if (bytes.byteLength > MAX_POST_IMAGE_BYTES) {
          return Response.json({ error: 'Bildet er større enn 10 MB' }, { status: 400 })
        }

        const id = newId()
        const key = `posts/${id}.${imageExtension(contentType)}`
        await env.FILES.put(key, bytes, { httpMetadata: { contentType } })

        try {
          await d.insert(postImages).values({
            id,
            postId,
            r2Key: key,
            fileName,
            size: bytes.byteLength,
            contentType,
            width: null,
            height: null,
            sortOrder: count,
            uploadedBy: me.id,
            createdAt: new Date(),
          })
        } catch (err) {
          // Ingen foreldreløse objekter i R2 hvis raden ikke ble skrevet.
          await env.FILES.delete(key).catch(() => {})
          throw err
        }

        return Response.json({ id, fileName })
      },
    },
  },
})
