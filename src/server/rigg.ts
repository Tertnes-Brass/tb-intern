import { createServerFn } from '@tanstack/react-start'
import { asc, eq, like, or } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Db } from '../db'
import { assets, memberProfiles, rigItems, user } from '../db/schema'
import { newId } from '../lib/id'
import { isOccurrenceKey } from '../lib/occurrence'
import {
  RIG_NAME_MAX,
  RIG_RESPONSIBLE_MAX,
  type RigScope,
  applyRigCheck,
  canManageRigList,
  parseRigItemInput,
  parseRigScope,
} from '../lib/rigg'
import { type Me, requireMe } from './access'
import { ensureEventMeta } from './event-meta-row'
import { loadRigItemScope, loadRigItems } from './rig-store'
import { loadVisibleProject } from './project-access'

/**
 * Riggelista (#12): «ta med»-sjekklista for et prosjekt eller en øving.
 *
 * **Tilgangsmodellen er todelt, og det er hele poenget i saken.**
 * - REDIGERING (legge til og fjerne linjer, sette ansvarlig) krever
 *   `projects.manage` ELLER `assets.manage`. Lista har to naturlige eiere:
 *   prosjektansvarlig vet hva konserten trenger, materialforvalteren vet hva
 *   korpset eier. En ny `rig.manage` ville betydd at begge måtte be om den.
 * - AVKRYSSING krever bare `requireMe()`. Det er riggegruppa som står på gulvet
 *   med kassa i hendene, og de har som regel ingen rettighet i det hele tatt.
 *   Sjekklista er verdiløs hvis bare stab kan hake av.
 *
 * Begge håndheves her, aldri i UI-et. Avkryssingen lagrer HVEM og NÅR (`taken_by`
 * / `returned_by` + tidsstempler), som er sporbarheten saken ber om — og
 * grunnen til at avkryssingen ikke er et boolsk felt.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra.** Rutene importerer
 * modulen; leselaget med de levende eksportene bor i `rig-store.ts`.
 */

const scopeSchema = z
  .object({
    projectId: z.string().min(1).max(64).nullish(),
    occurrenceKey: z.string().max(200).nullish(),
  })
  .refine((v) => !v.occurrenceKey || isOccurrenceKey(v.occurrenceKey), {
    message: 'Ugyldig hendelse',
  })

/**
 * Riggelista skal kunne skrives på fra to steder, og tilgangen til hver av dem
 * er ULIK — derfor sjekkes eierskapet, ikke bare rettigheten:
 *
 * - Prosjekt: brukeren må kunne SE prosjektet (`loadVisibleProject`), ellers
 *   ville riggelista vært en bakvei til navnet på et upublisert prosjekt.
 * - Øving: `event_meta`-raden opprettes lazily fra FEEDEN, akkurat som
 *   øvingsplanen. Et rått kall kan dermed ikke lage en riggeliste på en
 *   hendelse som ikke finnes.
 *
 * `ensureRow` er `false` ved lesing: å bare åpne en side skal ikke skrive en rad.
 */
async function resolveScope(
  d: Db,
  me: Me,
  input: { projectId?: string | null; occurrenceKey?: string | null },
  ensureRow: boolean,
): Promise<RigScope> {
  const scope = parseRigScope(input)
  if (scope.kind === 'project') {
    await loadVisibleProject(d, scope.projectId, me)
    return scope
  }
  if (ensureRow) await ensureEventMeta(d, scope.occurrenceKey, me.id)
  return scope
}

/** Redigering krever ÉN av to rettigheter — se modulkommentaren. */
function requireRigManage(me: Me): void {
  if (!canManageRigList(me.permissions)) {
    throw new Error('Du mangler tilgangen «projects.manage» eller «assets.manage»')
  }
}

// ---------- Lesing ----------

export const getRigList = createServerFn()
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const scope = await resolveScope(d, me, data, false)
    const [items, memberOptions] = await Promise.all([
      loadRigItems(d, scope),
      // Velgerlista sendes kun til den som faktisk kan skrive: en medlemsliste
      // er data, ikke pynt (samme regel som `memberOptions` i utstyr.ts).
      canManageRigList(me.permissions)
        ? d
            .select({ id: user.id, name: user.name })
            .from(memberProfiles)
            .innerJoin(user, eq(memberProfiles.authUserId, user.id))
            .where(eq(memberProfiles.isActive, true))
            .orderBy(asc(user.name))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ])
    return { items, memberOptions, canManage: canManageRigList(me.permissions) }
  })

/**
 * Utstyrssøket til «legg til fra registeret». Egen funksjon og ikke gjenbruk av
 * `listAssets` i `utstyr.ts`: den returnerer hele registeret med bilder og
 * eierskap, og en velger i en dialog trenger id og navn. Gated på skriveretten
 * til riggelista, ikke på `assets.manage` alene — ellers kunne ikke
 * prosjektansvarlig legge til en gjenstand hen tydelig ser i registeret.
 */
export const searchAssetsForRig = createServerFn()
  .validator(z.object({ q: z.string().max(120).optional() }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireRigManage(me)
    const q = (data.q ?? '').trim()
    const rows = await db()
      .select({ id: assets.id, name: assets.name, category: assets.category })
      .from(assets)
      .where(
        q
          ? or(like(assets.name, `%${q}%`), like(assets.category, `%${q}%`), like(assets.model, `%${q}%`))
          : undefined,
      )
      .orderBy(asc(assets.name))
      .limit(30)
    return { assets: rows }
  })

// ---------- Skriving: redigere lista ----------

export const addRigItem = createServerFn({ method: 'POST' })
  .validator(
    scopeSchema.and(
      z.object({
        assetId: z.string().max(64).nullish(),
        name: z.string().max(RIG_NAME_MAX * 2).nullish(),
        responsibleUserId: z.string().max(64).nullish(),
        responsibleName: z.string().max(RIG_RESPONSIBLE_MAX * 2).nullish(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireRigManage(me)
    const d = db()
    const scope = await resolveScope(d, me, data, true)

    // Navnesnapshotet tas fra REGISTERET når en gjenstand er valgt, aldri fra
    // klienten — samme disiplin som `ensureEventMeta`, der tittelen kommer fra
    // feeden. Ellers kunne et rått kall lagt inn «Sølvfat» med en asset-id som
    // peker på et notestativ.
    let name = data.name ?? null
    const assetId = (data.assetId ?? '').trim() || null
    if (assetId) {
      const asset = (await d.select({ name: assets.name }).from(assets).where(eq(assets.id, assetId)).limit(1))[0]
      if (!asset) throw new Error('Fant ikke gjenstanden i utstyrsregisteret')
      name = asset.name
    }

    const value = parseRigItemInput({ ...data, assetId, name })
    const now = new Date()
    const id = newId()
    await d.insert(rigItems).values({
      id,
      projectId: scope.kind === 'project' ? scope.projectId : null,
      occurrenceKey: scope.kind === 'event' ? scope.occurrenceKey : null,
      ...value,
      takenAt: null,
      takenBy: null,
      returnedAt: null,
      returnedBy: null,
      createdBy: me.id,
      createdAt: now,
      updatedAt: now,
    })
    return { id }
  })

/**
 * Endrer navn og ansvarlig på en linje. Eierskapet (prosjekt/øving) og
 * gjenstandsreferansen kan IKKE endres: en linje som flyttes mellom to lister
 * ville tatt avkryssingene sine med seg, og «tatt med» ville plutselig gjeldt en
 * annen konsert. Feil liste rettes ved å slette linja og legge den inn på nytt.
 */
export const updateRigItem = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().max(RIG_NAME_MAX * 2).nullish(),
      responsibleUserId: z.string().max(64).nullish(),
      responsibleName: z.string().max(RIG_RESPONSIBLE_MAX * 2).nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireRigManage(me)
    const d = db()
    const row = await loadRigItemScope(d, data.id)
    await resolveScope(d, me, row, false)

    const value = parseRigItemInput({ ...data, assetId: null })
    await d
      .update(rigItems)
      .set({
        name: value.name,
        responsibleUserId: value.responsibleUserId,
        responsibleName: value.responsibleName,
        updatedAt: new Date(),
      })
      .where(eq(rigItems.id, data.id))
    return { ok: true }
  })

export const removeRigItem = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireRigManage(me)
    const d = db()
    const row = await loadRigItemScope(d, data.id)
    await resolveScope(d, me, row, false)
    await d.delete(rigItems).where(eq(rigItems.id, data.id))
    return { ok: true }
  })

// ---------- Skriving: avkryssing ----------

/**
 * De to avkryssingene. ALLE aktive medlemmer kan gjøre dette — `requireMe()` er
 * hele gaten, og det er med vilje: riggegruppa er tre personer på et gulv, ikke
 * en rolle i rollematrisen.
 *
 * Selve regelen (invarianten «kommet tilbake ⇒ tatt med», og at en ny
 * avkryssing ikke overskriver hvem som gjorde det først) bor i `applyRigCheck`
 * i `src/lib/rigg.ts` og er enhetstestet. Tilstanden leses FRA DATABASEN før
 * regelen kjøres — klienten sender bare hvilket kryss og av/på, aldri
 * tidsstempler eller hvem som gjorde det.
 */
export const setRigCheck = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      field: z.enum(['taken', 'returned']),
      checked: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    const row = await loadRigItemScope(d, data.id)
    // Samme synlighetskrav som lesing: en linje på et prosjekt du ikke får se,
    // kan du heller ikke krysse av.
    await resolveScope(d, me, row, false)

    const next = applyRigCheck(
      {
        takenAt: row.takenAt?.getTime() ?? null,
        takenBy: row.takenBy,
        returnedAt: row.returnedAt?.getTime() ?? null,
        returnedBy: row.returnedBy,
      },
      data.field,
      data.checked,
      me.id,
      Date.now(),
    )

    await d
      .update(rigItems)
      .set({
        takenAt: next.takenAt === null ? null : new Date(next.takenAt),
        takenBy: next.takenBy,
        returnedAt: next.returnedAt === null ? null : new Date(next.returnedAt),
        returnedBy: next.returnedBy,
        updatedAt: new Date(),
      })
      .where(eq(rigItems.id, data.id))
    return { ok: true }
  })
