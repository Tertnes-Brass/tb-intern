import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { assetImages, assetProjects, assets, memberProfiles, projects, user } from '../db/schema'
import { newId } from '../lib/id'
import {
  ASSETS_PERMISSION,
  ASSET_LINK_NOTE_MAX,
  ASSET_NAME_MAX,
  ASSET_NOTES_MAX,
  ASSET_OWNER_MAX,
  ASSET_SHORT_MAX,
  type AssetUsage,
  type OwnerKind,
  OWNER_KINDS,
  ASSET_USAGES,
  sanitizeAssetInput,
} from '../lib/utstyr'
import { hasPermission, requireMe, requirePermission } from './access'
import { deleteAssetObject } from './utstyr-images'

/**
 * Utstyrsregisteret (#13): hvem eier hva, hva er lånt inn, og hvilket prosjekt
 * skal det brukes til.
 *
 * **Tilgangsmodellen er skjev med vilje.** Lesing krever bare `requireMe()` —
 * «kven eiger denne skarptromma?» er et spørsmål alle i korpset stiller, og et
 * register bare materialforvalteren ser, er et regneark med ekstra steg. ALL
 * skriving krever `assets.manage`. Det finnes ingen «egen» gjenstand slik det
 * finnes et eget innlegg på veggen: eierskap i registeret er en OPPLYSNING om
 * den fysiske gjenstanden, ikke en rettighet i systemet. Et medlem som eier
 * pauken sin privat, får altså ikke skriverett av den grunn.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra.** Rutene importerer
 * modulen, og en levende eksport ville dratt `cloudflare:workers` (via `db`)
 * inn i klientbygget — samme felle som `post-images.ts` og `event-meta.ts`.
 * R2-laget og gaten for bildene bor i `utstyr-images.ts`, de rene reglene i
 * `src/lib/utstyr.ts`, som begge sider kan importere.
 */

const idInput = z.object({ id: z.string().min(1) })

const assetInputSchema = z.object({
  name: z.string().max(ASSET_NAME_MAX * 2),
  category: z.string().max(200).nullable().optional(),
  manufacturer: z.string().max(ASSET_SHORT_MAX * 2).nullable().optional(),
  model: z.string().max(ASSET_SHORT_MAX * 2).nullable().optional(),
  serialNumber: z.string().max(ASSET_SHORT_MAX * 2).nullable().optional(),
  ownerKind: z.enum(OWNER_KINDS),
  ownerUserId: z.string().max(64).nullable().optional(),
  ownerName: z.string().max(ASSET_OWNER_MAX * 2).nullable().optional(),
  loanedFrom: z.string().max(ASSET_OWNER_MAX * 2).nullable().optional(),
  loanFrom: z.string().max(20).nullable().optional(),
  loanUntil: z.string().max(20).nullable().optional(),
  notes: z.string().max(ASSET_NOTES_MAX * 2).nullable().optional(),
})

// ---------- Lesing ----------

export type AssetListItem = {
  id: string
  name: string
  category: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  ownerKind: OwnerKind
  ownerName: string | null
  /** Dagens navn på et medlem som eier gjenstanden. Null når eieren ikke er et medlem. */
  memberName: string | null
  loanedFrom: string | null
  loanFrom: string | null
  loanUntil: string | null
  /** Første bilde, til miniatyren i lista. Vises via /api/utstyr-images/$imageId. */
  coverImageId: string | null
}

/**
 * Hele registeret på én gang. Det er et bevisst valg: et korps har titalls til
 * hundretalls gjenstander, ikke titusener, og med hele lista i klienten blir
 * søket og filtrene øyeblikkelige — de kjører gjennom de samme rene funksjonene
 * (`filterAssets`) som testene låser. Filtervalgene bor i `validateSearch` på
 * ruta, så en filtrert visning kan lenkes til (docs/designprinsipper.md §4).
 */
export const listAssets = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()

  const [rows, images] = await Promise.all([
    d
      .select({
        id: assets.id,
        name: assets.name,
        category: assets.category,
        manufacturer: assets.manufacturer,
        model: assets.model,
        serialNumber: assets.serialNumber,
        ownerKind: assets.ownerKind,
        ownerName: assets.ownerName,
        memberName: user.name,
        loanedFrom: assets.loanedFrom,
        loanFrom: assets.loanFrom,
        loanUntil: assets.loanUntil,
      })
      .from(assets)
      .leftJoin(user, eq(assets.ownerUserId, user.id))
      .orderBy(asc(assets.name)),
    d
      .select({ id: assetImages.id, assetId: assetImages.assetId, sortOrder: assetImages.sortOrder })
      .from(assetImages)
      .orderBy(asc(assetImages.sortOrder)),
  ])

  // Første bilde per gjenstand. Ett oppslag i stedet for én spørring per rad.
  const cover = new Map<string, string>()
  for (const img of images) if (!cover.has(img.assetId)) cover.set(img.assetId, img.id)

  const list: AssetListItem[] = rows.map((row) => ({ ...row, coverImageId: cover.get(row.id) ?? null }))
  return { assets: list, canManage: hasPermission(me, ASSETS_PERMISSION) }
})

export type AssetImageItem = { id: string; fileName: string; sortOrder: number }

export type AssetProjectRow = {
  projectId: string
  projectName: string
  eventDate: string | null
  usage: AssetUsage
  note: string | null
}

/**
 * Én gjenstand med bilder og prosjektkoblinger.
 *
 * Upubliserte prosjekter filtreres bort for lesere uten `projects.manage` eller
 * `assets.manage` — et prosjekt som ikke er publisert, skal ikke lekke navnet
 * sitt gjennom en utstyrskobling. `memberOptions` og `projectOptions` sendes kun
 * til den som faktisk kan skrive: en velgerliste er data, ikke pynt.
 */
export const getAsset = createServerFn()
  .validator(idInput)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const canManage = hasPermission(me, ASSETS_PERMISSION)
    const canSeeUnpublished = canManage || hasPermission(me, 'projects.manage')
    const d = db()

    const row = (
      await d
        .select({
          id: assets.id,
          name: assets.name,
          category: assets.category,
          manufacturer: assets.manufacturer,
          model: assets.model,
          serialNumber: assets.serialNumber,
          ownerKind: assets.ownerKind,
          ownerUserId: assets.ownerUserId,
          ownerName: assets.ownerName,
          memberName: user.name,
          loanedFrom: assets.loanedFrom,
          loanFrom: assets.loanFrom,
          loanUntil: assets.loanUntil,
          notes: assets.notes,
          createdAt: assets.createdAt,
          updatedAt: assets.updatedAt,
        })
        .from(assets)
        .leftJoin(user, eq(assets.ownerUserId, user.id))
        .where(eq(assets.id, data.id))
        .limit(1)
    )[0]
    if (!row) throw new Error('Fant ikke gjenstanden')

    const [imageRows, linkRows, memberOptions, projectOptions] = await Promise.all([
      d
        .select({ id: assetImages.id, fileName: assetImages.fileName, sortOrder: assetImages.sortOrder })
        .from(assetImages)
        .where(eq(assetImages.assetId, data.id))
        .orderBy(asc(assetImages.sortOrder)),
      d
        .select({
          projectId: assetProjects.projectId,
          projectName: projects.name,
          eventDate: projects.eventDate,
          isPublished: projects.isPublished,
          usage: assetProjects.usage,
          note: assetProjects.note,
        })
        .from(assetProjects)
        .innerJoin(projects, eq(assetProjects.projectId, projects.id))
        .where(eq(assetProjects.assetId, data.id)),
      canManage
        ? d
            .select({ id: user.id, name: user.name })
            .from(memberProfiles)
            .innerJoin(user, eq(memberProfiles.authUserId, user.id))
            .where(eq(memberProfiles.isActive, true))
            .orderBy(asc(user.name))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      canManage
        ? d
            .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
            .from(projects)
            .where(eq(projects.isPublished, true))
            .orderBy(asc(projects.eventDate))
        : Promise.resolve([] as Array<{ id: string; name: string; eventDate: string | null }>),
    ])

    const links: AssetProjectRow[] = linkRows
      .filter((l) => l.isPublished || canSeeUnpublished)
      .map(({ isPublished: _p, ...l }) => l)

    return {
      asset: {
        ...row,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      },
      images: imageRows as AssetImageItem[],
      links,
      memberOptions,
      projectOptions,
      canManage,
    }
  })

// ---------- Skriving ----------

export const createAsset = createServerFn({ method: 'POST' })
  .validator(assetInputSchema)
  .handler(async ({ data }) => {
    const me = await requirePermission(ASSETS_PERMISSION)
    // Samme normalisering som ved redigering, slik at et rått kall aldri kan
    // legge igjen eierfelt som motsier hverandre.
    const value = sanitizeAssetInput(data)
    const id = newId()
    const now = new Date()
    await db()
      .insert(assets)
      .values({ id, ...value, createdBy: me.id, createdAt: now, updatedAt: now })
    return { id }
  })

export const updateAsset = createServerFn({ method: 'POST' })
  .validator(assetInputSchema.extend({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePermission(ASSETS_PERMISSION)
    const { id, ...input } = data
    const value = sanitizeAssetInput(input)
    const updated = await db()
      .update(assets)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(assets.id, id))
      .returning({ id: assets.id })
    if (updated.length === 0) throw new Error('Fant ikke gjenstanden')
    return { ok: true }
  })

/**
 * Sletter gjenstanden. Bildebytene fjernes fra R2 FØR raden: forsvinner raden
 * først, mister vi nøklene og etterlater objekter ingen kan finne igjen. Radene
 * i `asset_images` og `asset_projects` forsvinner av seg selv (CASCADE).
 */
export const deleteAsset = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    await requirePermission(ASSETS_PERMISSION)
    const d = db()
    const keys = await d
      .select({ r2Key: assetImages.r2Key })
      .from(assetImages)
      .where(eq(assetImages.assetId, data.id))
    for (const key of keys) await deleteAssetObject(key.r2Key)
    await d.delete(assets).where(eq(assets.id, data.id))
    return { ok: true }
  })

export const deleteAssetImage = createServerFn({ method: 'POST' })
  .validator(idInput)
  .handler(async ({ data }) => {
    await requirePermission(ASSETS_PERMISSION)
    const d = db()
    const image = (
      await d.select({ r2Key: assetImages.r2Key }).from(assetImages).where(eq(assetImages.id, data.id)).limit(1)
    )[0]
    if (!image) throw new Error('Fant ikke bildet')
    await deleteAssetObject(image.r2Key)
    await d.delete(assetImages).where(eq(assetImages.id, data.id))
    return { ok: true }
  })

// ---------- Kobling til prosjekt ----------

/**
 * Kobler gjenstanden til et prosjekt, eller flytter en eksisterende kobling
 * mellom «skal brukes til» og «brukt på». Primærnøkkelen er (asset, prosjekt),
 * så den samme gjenstanden aldri står to ganger på det samme prosjektet — den
 * planlagte koblingen BLIR den brukte når konserten er spilt.
 *
 * Kun publiserte prosjekter kan kobles: et upublisert prosjekt er ikke synlig
 * ellers i plattformen, og en kobling herfra ville vært en bakvei inn til navnet
 * (samme regel som prosjektvelgeren på `/kalender/$eventId`).
 */
export const linkAssetProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      assetId: z.string().min(1),
      projectId: z.string().min(1),
      usage: z.enum(ASSET_USAGES),
      note: z.string().max(ASSET_LINK_NOTE_MAX * 2).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(ASSETS_PERMISSION)
    const d = db()
    const [asset, project] = await Promise.all([
      d.select({ id: assets.id }).from(assets).where(eq(assets.id, data.assetId)).limit(1),
      d
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, data.projectId), eq(projects.isPublished, true)))
        .limit(1),
    ])
    if (!asset[0]) throw new Error('Fant ikke gjenstanden')
    if (!project[0]) throw new Error('Fant ikke prosjektet')

    const note = (data.note ?? '').replace(/\s+/g, ' ').trim().slice(0, ASSET_LINK_NOTE_MAX) || null
    await d
      .insert(assetProjects)
      .values({
        assetId: data.assetId,
        projectId: data.projectId,
        usage: data.usage,
        note,
        createdBy: me.id,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [assetProjects.assetId, assetProjects.projectId],
        set: { usage: data.usage, note },
      })
    return { ok: true }
  })

export const unlinkAssetProject = createServerFn({ method: 'POST' })
  .validator(z.object({ assetId: z.string().min(1), projectId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePermission(ASSETS_PERMISSION)
    await db()
      .delete(assetProjects)
      .where(and(eq(assetProjects.assetId, data.assetId), eq(assetProjects.projectId, data.projectId)))
    return { ok: true }
  })
