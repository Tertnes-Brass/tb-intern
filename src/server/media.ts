import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, like, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { mediaItems, projects, user, works } from '../db/schema'
import {
  BOARD_PERMISSION,
  MEDIA_DESCRIPTION_MAX,
  MEDIA_PERMISSION,
  MEDIA_TITLE_MAX,
  MEDIA_VISIBILITIES,
  type MediaKind,
  type MediaVisibility,
  assignableVisibilities,
  canEditMedia,
  canViewMedia,
  sanitizeMediaInput,
} from '../lib/media'
import { hasPermission, requireMe, requirePermission } from './access'
import { deleteMediaObject } from './media-files'

/**
 * Mediearkivet (#32): korpsets egne opptak, bilder og video, samlet ett sted og
 * knyttet til prosjektet eller verket de hører til.
 *
 * **Tilgangsmodellen er skjev, som i utstyrsregisteret.** Lesing av `intern`
 * (og `offentlig-kandidat`) krever bare `requireMe()` — et konsertopptak er noe
 * hele korpset skal kunne høre, og et arkiv bare staben ser er en delt mappe med
 * ekstra steg. `styre` krever `board.manage`, også for å se AT elementet finnes.
 * ALL skriving krever `media.manage`, uansett hvem som lastet opp: opplasteren
 * er en opplysning om hvor filen kom fra, ikke en rettighet.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra.** Rutene importerer
 * modulen, og en levende eksport ville dratt `cloudflare:workers` (via `db`)
 * inn i klientbygget — samme felle som `post-images.ts` og `event-meta.ts`.
 * R2-laget og filgaten bor i `media-files.ts`, de rene reglene i
 * `src/lib/media.ts`, som begge sider kan importere.
 */

const idInput = z.object({ id: z.string().min(1) })

// ---------- Lesing ----------

export type MediaListItem = {
  id: string
  title: string
  kind: MediaKind
  visibility: MediaVisibility
  recordedOn: string | null
  description: string | null
  projectId: string | null
  projectName: string | null
  workId: string | null
  workTitle: string | null
  size: number
  contentType: string
}

/**
 * Hele arkivet den innloggede har lov til å se, på én gang.
 *
 * Samme avveining som utstyrsregisteret: et korps har titalls til hundretalls
 * opptak, ikke titusener, og med lista i klienten blir søket og filtrene
 * øyeblikkelige gjennom de rene funksjonene i `src/lib/media.ts`. Payloaden er
 * metadata — bytene hentes først når noen faktisk trykker på et element.
 *
 * `styre`-elementene filtreres bort i SQL, ikke i klienten: en rad som aldri
 * forlater serveren kan heller ikke lekke gjennom en glemt `filter()` i UI-et.
 */
export const listMedia = createServerFn().handler(async () => {
  const me = await requireMe()
  const canManageBoard = hasPermission(me, BOARD_PERMISSION)
  const canManage = hasPermission(me, MEDIA_PERMISSION)
  // Et upublisert prosjekt skal ikke lekke navnet sitt gjennom en mediekobling
  // (samme regel som utstyrsregisteret trekker for `asset_projects`).
  const canSeeUnpublished = canManage || hasPermission(me, 'projects.manage')

  const d = db()
  const rows = await d
    .select({
      id: mediaItems.id,
      title: mediaItems.title,
      kind: mediaItems.kind,
      visibility: mediaItems.visibility,
      recordedOn: mediaItems.recordedOn,
      description: mediaItems.description,
      projectId: mediaItems.projectId,
      projectName: projects.name,
      projectPublished: projects.isPublished,
      workId: mediaItems.workId,
      workTitle: works.title,
      size: mediaItems.size,
      contentType: mediaItems.contentType,
    })
    .from(mediaItems)
    .leftJoin(projects, eq(mediaItems.projectId, projects.id))
    .leftJoin(works, eq(mediaItems.workId, works.id))
    .where(canManageBoard ? undefined : ne(mediaItems.visibility, 'styre'))
    .orderBy(desc(mediaItems.recordedOn), asc(mediaItems.title))

  const items: MediaListItem[] = rows.map(({ projectPublished, ...row }) => {
    const hideProject = row.projectId !== null && !projectPublished && !canSeeUnpublished
    return {
      ...row,
      projectId: hideProject ? null : row.projectId,
      projectName: hideProject ? null : row.projectName,
    }
  })

  // Prosjektvelgeren i opprettelsesdialogen. Kun til den som kan skrive — en
  // velgerliste er data, ikke pynt — og kun publiserte prosjekter, som er de
  // eneste `updateMedia` godtar.
  const projectOptions = canManage
    ? await d
        .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
        .from(projects)
        .where(eq(projects.isPublished, true))
        .orderBy(desc(projects.eventDate))
    : []

  return {
    items,
    canManage,
    canManageBoard,
    projectOptions,
    visibilities: assignableVisibilities({ canManageBoard }),
  }
})

export type MediaDetail = {
  id: string
  title: string
  kind: MediaKind
  visibility: MediaVisibility
  recordedOn: string | null
  description: string | null
  projectId: string | null
  projectName: string | null
  workId: string | null
  workTitle: string | null
  workComposer: string | null
  fileName: string
  size: number
  contentType: string
  uploaderName: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Ett medieelement — avspillingssiden (#23 ba om et større vindu enn en liten
 * boks i en liste, og svaret er en egen side per element).
 *
 * `projectOptions` sendes kun til den som faktisk kan skrive: en velgerliste er
 * data, ikke pynt. Verkene kommer fra `searchMediaWorks` i stedet — arkivet kan
 * ha hundrevis av verk, og hele lista i hver sidelast ville vært en payload
 * ingen leser.
 */
export const getMediaItem = createServerFn()
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canManageBoard = hasPermission(me, BOARD_PERMISSION)
    const canManageMedia = hasPermission(me, MEDIA_PERMISSION)
    const canSeeUnpublished = canManageMedia || hasPermission(me, 'projects.manage')
    const d = db()

    const row = (
      await d
        .select({
          id: mediaItems.id,
          title: mediaItems.title,
          kind: mediaItems.kind,
          visibility: mediaItems.visibility,
          recordedOn: mediaItems.recordedOn,
          description: mediaItems.description,
          projectId: mediaItems.projectId,
          projectName: projects.name,
          projectPublished: projects.isPublished,
          workId: mediaItems.workId,
          workTitle: works.title,
          workComposer: works.composer,
          fileName: mediaItems.fileName,
          size: mediaItems.size,
          contentType: mediaItems.contentType,
          uploaderName: user.name,
          createdAt: mediaItems.createdAt,
          updatedAt: mediaItems.updatedAt,
        })
        .from(mediaItems)
        .leftJoin(projects, eq(mediaItems.projectId, projects.id))
        .leftJoin(works, eq(mediaItems.workId, works.id))
        .leftJoin(user, eq(mediaItems.uploadedBy, user.id))
        .where(eq(mediaItems.id, data.id))
        .limit(1)
    )[0]

    // Samme melding for «finnes ikke» og «ikke tilgang»: et styreopptak skal
    // ikke kunne bekreftes ved å gjette en id.
    if (!row || !canViewMedia(row, { canManageBoard })) throw new Error('Fant ikke medieelementet')

    const canEdit = canEditMedia(row, { canManageMedia, canManageBoard })
    const projectOptions = canEdit
      ? await d
          .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
          .from(projects)
          .where(eq(projects.isPublished, true))
          .orderBy(desc(projects.eventDate))
      : []

    const hideProject = row.projectId !== null && !row.projectPublished && !canSeeUnpublished
    const { projectPublished: _p, ...rest } = row
    const item: MediaDetail = {
      ...rest,
      projectId: hideProject ? null : rest.projectId,
      projectName: hideProject ? null : rest.projectName,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }

    return {
      item,
      canEdit,
      projectOptions,
      visibilities: assignableVisibilities({ canManageBoard }),
    }
  })

/**
 * Verkssøket for koblingen. Egen funksjon gated på `media.manage`, ikke
 * gjenbruk av `searchWorksForPicker` i `projects.ts` — den krever
 * `projects.manage`, og en medieansvarlig skal ikke måtte være
 * prosjektansvarlig for å kunne si hvilket stykke opptaket er av. Samme grunn
 * som `searchWorksForEvent` finnes ved siden av den.
 */
export const searchMediaWorks = createServerFn()
  .validator(z.object({ q: z.string().max(120).optional() }))
  .handler(async ({ data }) => {
    await requirePermission(MEDIA_PERMISSION)
    const q = data.q?.trim()
    const rows = await db()
      .select({ id: works.id, title: works.title, composer: works.composer })
      .from(works)
      .where(q ? or(like(works.title, `%${q}%`), like(works.composer, `%${q}%`)) : undefined)
      .orderBy(asc(works.title))
      .limit(12)
    return { works: rows }
  })

// ---------- Skriving ----------

const mediaInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(MEDIA_TITLE_MAX * 2),
  recordedOn: z.string().max(20).nullable().optional(),
  description: z.string().max(MEDIA_DESCRIPTION_MAX * 2).nullable().optional(),
  visibility: z.enum(MEDIA_VISIBILITIES),
  projectId: z.string().max(64).nullable().optional(),
  workId: z.string().max(64).nullable().optional(),
})

/**
 * Leser tilgangsnivået og avviser den som ikke har lov til å røre elementet.
 * Både redigering og sletting går gjennom denne — `media.manage` alene holder
 * ikke for et `styre`-element, se `canEditMedia`.
 */
async function requireEditable(id: string) {
  const me = await requirePermission(MEDIA_PERMISSION)
  const canManageBoard = hasPermission(me, BOARD_PERMISSION)
  const row = (
    await db()
      .select({ visibility: mediaItems.visibility, r2Key: mediaItems.r2Key })
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .limit(1)
  )[0]
  if (!row || !canEditMedia(row, { canManageMedia: true, canManageBoard })) {
    throw new Error('Fant ikke medieelementet')
  }
  return { me, canManageBoard, row }
}

/**
 * Endrer opplysningene på et element. Filen røres aldri her — den er lastet opp
 * én gang og byttes ikke ut: en ny fil er et nytt opptak, og en lenke noen har
 * delt skal fortsette å peke på det den pekte på.
 *
 * `sanitizeMediaInput` kjøres med skriverens egne rettigheter, slik at et rått
 * kall ikke kan sette «Bare styret» uten styretilgang.
 */
export const updateMedia = createServerFn({ method: 'POST' })
  .validator(mediaInputSchema)
  .handler(async ({ data }) => {
    const { canManageBoard } = await requireEditable(data.id)
    const value = sanitizeMediaInput(data, { canManageBoard })
    const d = db()

    // Bare publiserte prosjekter kan kobles: et upublisert prosjekt er ikke
    // synlig ellers i plattformen, og en kobling herfra ville vært en bakvei
    // inn til navnet (samme regel som `linkAssetProject` og prosjektvelgeren
    // på /kalender/$eventId).
    if (value.projectId) {
      const project = await d
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, value.projectId), eq(projects.isPublished, true)))
        .limit(1)
      if (!project[0]) throw new Error('Fant ikke prosjektet')
    }
    if (value.workId) {
      const work = await d.select({ id: works.id }).from(works).where(eq(works.id, value.workId)).limit(1)
      if (!work[0]) throw new Error('Fant ikke verket')
    }

    await d
      .update(mediaItems)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(mediaItems.id, data.id))
    return { ok: true }
  })

/**
 * Sletter elementet. Bytene fjernes fra R2 FØR raden: forsvinner raden først,
 * mister vi nøkkelen og etterlater et objekt ingen kan finne igjen — og en
 * mediefil er stor nok til at det faktisk koster noe.
 */
export const deleteMediaItem = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    const { row } = await requireEditable(data.id)
    await deleteMediaObject(row.r2Key)
    await db().delete(mediaItems).where(eq(mediaItems.id, data.id))
    return { ok: true }
  })
