import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { stagePlots } from '../db/schema'
import {
  MAX_STAGE_ELEMENTS,
  STAGE_ELEMENT_TYPES,
  STAGE_LABEL_MAX,
  STAGE_NOTE_MAX,
  canManageStagePlot,
  parseStagePlot,
  serializeStagePlot,
} from '../lib/scene'
import { type Me, requireMe } from './access'
import { loadVisibleProject } from './project-access'
import { loadStagePlot } from './scene-store'

/**
 * Sceneoppsettet (#11): den grafiske riggen for ett prosjekt.
 *
 * **Tilgangsmodellen er den samme som riggelista (#12).** Visning krever bare
 * at du kan se prosjektet — hele korpset skal kunne finne stolen sin. Skriving
 * krever `projects.manage` ELLER `assets.manage`: oppsettet er prosjektets
 * ansvar, men det er materialforvalteren som vet hvor mange stoler som finnes.
 *
 * **Ingen serverjobb for deling.** Nedlastingen er en klientside-serialisering
 * av den SVG-en som allerede står på skjermen (`standaloneStageSvg` i
 * `src/lib/scene.ts`), og utskriften er `@media print`. Serveren lagrer JSON og
 * ingenting annet — vi har verken en bilderenderer eller et sted å legge en fil
 * som uansett ville vært utdatert i det oppsettet endres.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra.** Leselaget med de
 * levende eksportene bor i `scene-store.ts`.
 */

const elementSchema = z.object({
  id: z.string().max(64),
  type: z.enum(STAGE_ELEMENT_TYPES),
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  label: z.string().max(STAGE_LABEL_MAX * 4).nullish(),
})

function requireStageManage(me: Me): void {
  if (!canManageStagePlot(me.permissions)) {
    throw new Error('Du mangler tilgangen «projects.manage» eller «assets.manage»')
  }
}

export const getStagePlot = createServerFn()
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()
    // Synlighetsregelen for prosjektet er felles (`project-access.ts`): et
    // upublisert prosjekt skal ikke lekke navnet sitt gjennom sceneoppsettet.
    const { project } = await loadVisibleProject(d, data.projectId, me)
    const plot = await loadStagePlot(d, data.projectId)
    return {
      project: { id: project.id, name: project.name, eventDate: project.eventDate, venue: project.venue },
      plot,
      canManage: canManageStagePlot(me.permissions),
    }
  })

/**
 * Lagrer hele oppsettet i én skriving. Det er med vilje ikke én operasjon per
 * flyttet stol: tegneflaten er en skisse man drar rundt på i et halvt minutt,
 * og et kall per pointermove ville vært hundrevis av skrivinger for én
 * arbeidsøkt — og en kø av forespørsler som kan komme i feil rekkefølge.
 *
 * `parseStagePlot` kjøres på nytt her, selv om zod allerede har validert
 * formen: zod sier at feltene FINNES, den rene funksjonen sier at verdiene er
 * innenfor scenen, at rotasjonen er 0–359, at etiketten er kuttet og at taket
 * på antall holdes. Det er den samme disiplinen som `sanitizeAssetInput` — én
 * normalisering, kalt fra alle skrivestier.
 *
 * Siste skriving vinner. To personer som tegner samtidig er ikke et problem vi
 * har (oppsettet lages av én person i forkant), og en låsemekanisme ville kostet
 * mer forklaring enn den sparer — men `updated_at` og «sist endret av» vises i
 * UI-et, slik at man SER at noen andre har vært der.
 */
export const saveStagePlot = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string().min(1),
      elements: z.array(elementSchema).max(MAX_STAGE_ELEMENTS * 2),
      note: z.string().max(STAGE_NOTE_MAX * 2).nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireStageManage(me)
    const d = db()
    await loadVisibleProject(d, data.projectId, me)

    const layout = serializeStagePlot(
      parseStagePlot({ elements: data.elements.map((e) => ({ ...e, label: e.label ?? null })) }),
    )
    const note = (data.note ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, STAGE_NOTE_MAX) || null
    const now = new Date()

    await d
      .insert(stagePlots)
      .values({ projectId: data.projectId, layout, note, updatedBy: me.id, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: stagePlots.projectId,
        set: { layout, note, updatedBy: me.id, updatedAt: now },
      })
    return { ok: true, updatedAt: now.getTime() }
  })

/**
 * Fjerner oppsettet helt. Å tømme scenen og å slette raden er ikke det samme:
 * en tom rad ville stått igjen med «sist endret av» og sett ut som et oppsett
 * noen har jobbet med, mens sletting gir prosjektet tilbake tomtilstanden sin.
 */
export const deleteStagePlot = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    requireStageManage(me)
    const d = db()
    await loadVisibleProject(d, data.projectId, me)
    await d.delete(stagePlots).where(eq(stagePlots.projectId, data.projectId))
    return { ok: true }
  })
