import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { stagePlots, user } from '../db/schema'
import { type StageElement, countStageElements, parseStagePlot, stageSummary } from '../lib/scene'

/**
 * Leselaget for sceneoppsettet (#11).
 *
 * **Hvorfor egen modul:** de to funksjonene under er LEVENDE eksporter som
 * rører `db`, og de brukes av både `scene.ts` (som ruta importerer for
 * serverfunksjonene) og `projects.ts` (som fyller prosjekt-dashboardet i én
 * runde). Samme grense som `rig-store.ts` og `board-files.ts`: denne filen
 * importeres ALDRI fra en rutekomponent, ellers følger `cloudflare:workers`
 * med inn i klientbygget.
 */

export type StagePlotRow = {
  elements: StageElement[]
  note: string | null
  updatedAt: number | null
  /** Dagens navn på den som lagret sist. Null når raden er tom eller personen er borte. */
  updatedByName: string | null
}

const EMPTY: StagePlotRow = { elements: [], note: null, updatedAt: null, updatedByName: null }

/**
 * Hele oppsettet for ett prosjekt. Finnes ingen rad, er svaret et TOMT oppsett
 * — ikke `null`: et prosjekt uten sceneoppsett og et prosjekt med et tomt
 * sceneoppsett er samme sak for den som åpner tegneflaten, og to tilfeller ville
 * bare gitt to kodeveier i UI-et.
 *
 * Layouten går gjennom `parseStagePlot` ved LESING også, ikke bare ved skriving:
 * en rad skrevet av en eldre versjon (eller for hånd i databasen) skal aldri
 * kunne velte tegneflaten.
 */
export async function loadStagePlot(d: Db, projectId: string): Promise<StagePlotRow> {
  const row = (
    await d
      .select({
        layout: stagePlots.layout,
        note: stagePlots.note,
        updatedAt: stagePlots.updatedAt,
        updatedByName: user.name,
      })
      .from(stagePlots)
      .leftJoin(user, eq(stagePlots.updatedBy, user.id))
      .where(eq(stagePlots.projectId, projectId))
      .limit(1)
  )[0]
  if (!row) return EMPTY
  return {
    elements: parseStagePlot(row.layout).elements,
    note: row.note,
    updatedAt: row.updatedAt.getTime(),
    updatedByName: row.updatedByName,
  }
}

export type StagePlotSummary = {
  /** «12 stoler, 4 notestativ» — eller en ærlig tomtilstand. */
  summary: string
  counts: ReturnType<typeof countStageElements>
  total: number
  updatedAt: number | null
  updatedByName: string | null
}

/**
 * Bare tallene, til prosjekt-dashboardet. Saken ber uttrykkelig om at
 * opptellingen per elementtype skal være synlig der — men dashboardet skal
 * IKKE tegne scenen i miniatyr: det ville vært en kopi som blir gammel, og
 * §4 i docs/designprinsipper.md advarer mot nettopp det. Elementlista sendes
 * derfor ikke med; den bor på tegneflaten.
 */
export async function loadStagePlotSummary(d: Db, projectId: string): Promise<StagePlotSummary> {
  const plot = await loadStagePlot(d, projectId)
  return {
    summary: stageSummary(plot.elements),
    counts: countStageElements(plot.elements),
    total: plot.elements.length,
    updatedAt: plot.updatedAt,
    updatedByName: plot.updatedByName,
  }
}
