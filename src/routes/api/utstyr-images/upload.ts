import { createFileRoute } from '@tanstack/react-router'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../../db'
import { assetImages } from '../../../db/schema'
import { newId } from '../../../lib/id'
import {
  MAX_ASSET_IMAGES,
  MAX_ASSET_IMAGE_BYTES,
  assetImageExtension,
  assetImageRejectionReason,
} from '../../../lib/utstyr'
import { currentUser } from '../../../server/access'
import {
  ASSET_R2_PREFIX,
  canManageAssetImages,
  deleteAssetObject,
  putAssetObject,
} from '../../../server/utstyr-images'

/**
 * Én PUT per bilde av en gjenstand i utstyrsregisteret (#13).
 *
 * Note-arkivets multipart-flyt (`/api/upload/*`) er laget for store PDF-er med
 * signerte billetter og stemme-gjenkjenning; et telefonbilde av en skarptromme
 * trenger ingen av delene. Mønsteret er veggbildenes
 * (`/api/post-images/upload`), med én forskjell i gaten: her er det ikke
 * eierskap men rettigheten `assets.manage` som avgjør.
 *
 * R2-nøkkelen bygges ALLTID av en fersk id og en endelse utledet av
 * innholdstypen — aldri av filnavnet, som er brukerstyrt.
 */
export const Route = createFileRoute('/api/utstyr-images/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })

        const url = new URL(request.url)
        const assetId = url.searchParams.get('assetId')?.trim()
        const fileName = (url.searchParams.get('fileName') ?? 'bilde').slice(0, 200)
        const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
        if (!assetId) return Response.json({ error: 'Mangler gjenstand' }, { status: 400 })

        // Én melding for både «finnes ikke» og «ikke tilgang». De to er ikke verdt
        // å skille her: registeret er lesbart for alle medlemmer, så en id er
        // ingen hemmelighet, og den som får dette svaret har uansett samme
        // neste steg.
        if (!(await canManageAssetImages(assetId, me))) {
          return Response.json(
            { error: 'Fant ikke gjenstanden, eller du mangler tilgangen «assets.manage»' },
            { status: 403 },
          )
        }

        // Content-Length er en påstand fra klienten og brukes kun til å avvise
        // tidlig. Den virkelige grensen håndheves på bytene under.
        const declared = Number(request.headers.get('content-length') ?? '0')
        const earlyReason = assetImageRejectionReason({ type: contentType, size: declared || 1 })
        if (earlyReason) return Response.json({ error: earlyReason }, { status: 400 })

        const d = db()
        const countRow = await d
          .select({ n: sql<number>`count(*)` })
          .from(assetImages)
          .where(eq(assetImages.assetId, assetId))
        const count = countRow[0]?.n ?? 0
        if (count >= MAX_ASSET_IMAGES) {
          return Response.json({ error: `Maks ${MAX_ASSET_IMAGES} bilder per gjenstand` }, { status: 400 })
        }

        const bytes = new Uint8Array(await request.arrayBuffer())
        const reason = assetImageRejectionReason({ type: contentType, size: bytes.byteLength })
        if (reason) return Response.json({ error: reason }, { status: 400 })
        if (bytes.byteLength > MAX_ASSET_IMAGE_BYTES) {
          return Response.json({ error: 'Bildet er større enn 10 MB' }, { status: 400 })
        }

        const id = newId()
        const key = `${ASSET_R2_PREFIX}${id}.${assetImageExtension(contentType)}`
        await putAssetObject(key, bytes, contentType)

        try {
          await d.insert(assetImages).values({
            id,
            assetId,
            r2Key: key,
            fileName,
            size: bytes.byteLength,
            contentType,
            sortOrder: count,
            uploadedBy: me.id,
            createdAt: new Date(),
          })
        } catch (err) {
          // Ingen foreldreløse objekter i R2 hvis raden ikke ble skrevet.
          await deleteAssetObject(key)
          throw err
        }

        return Response.json({ id, fileName })
      },
    },
  },
})
