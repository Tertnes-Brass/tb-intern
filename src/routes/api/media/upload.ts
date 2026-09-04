import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../db'
import { mediaItems } from '../../../db/schema'
import { newId } from '../../../lib/id'
import {
  BOARD_PERMISSION,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_MB,
  MEDIA_TITLE_MAX,
  assignableVisibilities,
  isMediaVisibility,
  mediaExtension,
  mediaKindFor,
  mediaRejectionReason,
} from '../../../lib/media'
import { currentUser, hasPermission } from '../../../server/access'
import { MEDIA_R2_PREFIX, canUploadMedia, deleteMediaObject, putMediaObject } from '../../../server/media-files'

/**
 * Én PUT per medieelement i mediearkivet (#32).
 *
 * Mønsteret er veggbildenes (`/api/post-images/upload`), ikke note-arkivets
 * multipart-flyt: den er laget for PDF-er med signerte billetter og
 * stemme-gjenkjenning, og et øvingsopptak trenger ingen av delene.
 *
 * **Ruta oppretter hele raden, ikke bare filen.** Alternativet — lag raden
 * først, last opp etterpå — ville etterlatt et medieelement uten fil hver gang
 * en opplasting ble avbrutt, og et element uten fil er en avspillingsside som
 * ikke kan spille av noe. Her finnes raden aldri uten bytene sine.
 *
 * Tittelen settes til filnavnet, og resten av opplysningene kommer i et
 * `updateMedia`-kall rett etterpå. Feiler DET, står elementet igjen med
 * filnavnet som tittel og kan redigeres — en dårlig tittel er en mye mildere
 * feilmodus enn en fil uten rad, eller en rad uten fil.
 *
 * Tilgangsnivået er likevel med HER, som en spørreparameter, og ikke bare i
 * oppfølgingskallet: et opptak som skal være «Bare styret» ville ellers ligget
 * som `intern` i det vinduet de to kallene tar. Ett sekund er nok.
 */
export const Route = createFileRoute('/api/media/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        if (!canUploadMedia(me)) {
          return Response.json({ error: 'Du mangler tilgangen «media.manage»' }, { status: 403 })
        }

        const url = new URL(request.url)
        const fileName = (url.searchParams.get('fileName') ?? 'opptak').slice(0, 200)
        const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()

        // Tilgangsnivået valideres mot det DENNE brukeren har lov til å sette,
        // ikke bare mot listen over gyldige verdier: `styre` krever
        // `board.manage`, også fra et rått kall.
        const rawVisibility = (url.searchParams.get('tilgang') ?? 'intern').trim()
        const allowed = assignableVisibilities({ canManageBoard: hasPermission(me, BOARD_PERMISSION) })
        if (!isMediaVisibility(rawVisibility) || !allowed.includes(rawVisibility)) {
          return Response.json({ error: 'Ugyldig tilgangsnivå' }, { status: 400 })
        }

        const kind = mediaKindFor(contentType)
        if (!kind) {
          return Response.json(
            { error: mediaRejectionReason({ type: contentType, size: 1 }) ?? 'Filtypen støttes ikke' },
            { status: 400 },
          )
        }

        // Content-Length er en påstand fra klienten og brukes kun til å avvise
        // TIDLIG — poenget er å slippe å ta imot 95 MB for så å si nei. Den
        // virkelige grensen håndheves på bytene under.
        //
        // Merk at Workers uansett har et tak på request-body rundt 100 MB. Alt
        // over det avvises av kanten før koden vår ser forespørselen, og blir
        // en nettverksfeil uten forklaring. Derfor ligger vår grense under, og
        // derfor sjekker klienten den også selv, før den begynner å sende.
        const declared = Number(request.headers.get('content-length') ?? '0')
        if (declared > MAX_MEDIA_BYTES) {
          return Response.json(
            { error: `Filen er større enn ${MAX_MEDIA_MB} MB. Større opptak må deles opp inntil videre` },
            { status: 413 },
          )
        }

        const bytes = new Uint8Array(await request.arrayBuffer())
        const reason = mediaRejectionReason({ type: contentType, size: bytes.byteLength })
        if (reason) return Response.json({ error: reason }, { status: 400 })

        const id = newId()
        // Nøkkelen bygges ALLTID av en fersk id og en endelse utledet av
        // innholdstypen — aldri av filnavnet, som er brukerstyrt.
        const key = `${MEDIA_R2_PREFIX}${id}.${mediaExtension(contentType)}`
        await putMediaObject(key, bytes, contentType)

        // Filnavnet uten endelse er en bedre førstetittel enn filnavnet med:
        // «Julekonsert 2025» leser bedre enn «Julekonsert 2025.mp3».
        const title = (fileName.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim() || fileName).slice(0, MEDIA_TITLE_MAX)

        try {
          const now = new Date()
          await db().insert(mediaItems).values({
            id,
            title,
            kind,
            visibility: rawVisibility,
            recordedOn: null,
            description: null,
            projectId: null,
            workId: null,
            r2Key: key,
            fileName,
            size: bytes.byteLength,
            contentType,
            uploadedBy: me.id,
            createdAt: now,
            updatedAt: now,
          })
        } catch (err) {
          // Ingen foreldreløse objekter i R2 hvis raden ikke ble skrevet.
          await deleteMediaObject(key)
          throw err
        }

        return Response.json({ id, title, kind })
      },
    },
  },
})
