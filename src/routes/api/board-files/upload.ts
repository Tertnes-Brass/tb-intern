import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { boardDocuments, boardMeetings } from '../../../db/schema'
import { currentUser, hasPermission } from '../../../server/access'
import {
  BOARD_MAX_UPLOAD_BYTES,
  boardObjectKey,
  newDocumentId,
  putBoardObject,
  sanitizeFileName,
  storableContentType,
} from '../../../server/board-files'

/**
 * Opplasting av ett styredokument: én `PUT` med filen som kropp og metadata i
 * søkestrengen.
 *
 * Hvorfor ikke multipart-opplastingen i `/api/upload/*`? Den er bygget rundt
 * notearkivet hele veien: billetten inneholder `workId`, `complete` skriver til
 * `work_files` og gjetter stemme fra filnavnet, og alle fire rutene er gated på
 * `works.manage`. Å gjenbruke dem ville betydd en «kind»-bryter gjennom
 * billetten, gaten og `complete` — altså å gjøre noteopplastingens gate
 * betinget. Det er nettopp den gaten `docs/tilgangsstyring.md` sier skal være
 * enkel å lese. Styredokumenter er små (referater, budsjetter, kontrakter), så
 * de trenger ikke multipart i det hele tatt.
 */
export const Route = createFileRoute('/api/board-files/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const me = await currentUser()
        if (!me) return Response.json({ error: 'Krever innlogging' }, { status: 401 })
        if (!hasPermission(me, 'board.manage')) {
          return Response.json({ error: 'Krever styretilgang' }, { status: 403 })
        }

        const url = new URL(request.url)
        const fileName = sanitizeFileName(url.searchParams.get('name') ?? '')
        const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200) || fileName
        const meetingParam = url.searchParams.get('meetingId')?.trim() || null

        // Avvis på Content-Length før vi leser kroppen, så en for stor fil ikke
        // først må gjennom minnet.
        const declared = Number(request.headers.get('content-length') ?? '0')
        if (Number.isFinite(declared) && declared > BOARD_MAX_UPLOAD_BYTES) {
          return Response.json({ error: 'Filen er større enn 25 MB' }, { status: 413 })
        }

        let meetingId: string | null = null
        if (meetingParam) {
          const meeting = (
            await db()
              .select({ id: boardMeetings.id })
              .from(boardMeetings)
              .where(eq(boardMeetings.id, meetingParam))
              .limit(1)
          )[0]
          if (!meeting) return Response.json({ error: 'Fant ikke møtet' }, { status: 400 })
          meetingId = meeting.id
        }

        const body = await request.arrayBuffer()
        if (body.byteLength === 0) return Response.json({ error: 'Filen er tom' }, { status: 400 })
        // Content-Length er klientens påstand; byte-tallet er fasit.
        if (body.byteLength > BOARD_MAX_UPLOAD_BYTES) {
          return Response.json({ error: 'Filen er større enn 25 MB' }, { status: 413 })
        }

        const contentType = storableContentType(request.headers.get('content-type'))
        const id = newDocumentId()
        const key = boardObjectKey(id, fileName)
        await putBoardObject(key, body, contentType)

        await db().insert(boardDocuments).values({
          id,
          title,
          r2Key: key,
          fileName,
          size: body.byteLength,
          contentType,
          meetingId,
          uploadedBy: me.id,
          createdAt: new Date(),
        })

        return Response.json({ document: { id, title, fileName, size: body.byteLength } })
      },
    },
  },
})
