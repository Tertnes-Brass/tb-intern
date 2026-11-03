/**
 * Sceneoppsett — reglene som gjelder på begge sider: hva en lagret tegning
 * kan inneholde, grensene, og hvem som kan lese et oppsett. Ingen DB og ingen
 * Excalidraw her; modulen importeres av `src/server/stage-setups.ts`, av
 * `getProject` og av editoren.
 */
import { z } from 'zod'
import { type ProjectVisibility, projectReadError } from './project-access'

/** Rettigheten som gir skriving (og lesing av eldre publiserte prosjekters oppsett). */
export const STAGE_PERMISSION = 'stage.manage'

export const STAGE_TITLE_MAX = 120
export const STAGE_NOTES_MAX = 4000
/** Romslig for vektortegninger (et fullt korps er ~150 kB). Bilder lagres ikke. */
export const STAGE_SCENE_MAX_BYTES = 1_000_000
export const STAGE_MAX_ELEMENTS = 5000

/**
 * Elementtypene vi lagrer. Bilder (`image`) er utelatt med vilje — de ville
 * kreve egen lagring og tilgangskontroll i R2 — og det samme er `embeddable`/
 * `iframe`, som viser fremmede nettsider inne i tegningen.
 */
export const STAGE_ELEMENT_TYPES = ['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'text', 'freedraw', 'frame'] as const

/**
 * En lenke på et element må være http(s), mailto eller relativ. Kontrolltegn og
 * mellomrom fjernes FØR skjemasjekken, så `java\tscript:` ikke slipper forbi —
 * samme regel som `safeHref` i `markdown.ts`.
 */
export function isSafeElementLink(link: string): boolean {
  const cleaned = link.replace(/[\u0000- \u007f]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (!scheme) return true
  return ['http', 'https', 'mailto'].includes(scheme[1]!.toLowerCase())
}

const finite = z.number().finite()

const elementSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(STAGE_ELEMENT_TYPES),
    x: finite,
    y: finite,
    width: finite.nonnegative(),
    height: finite.nonnegative(),
    isDeleted: z.boolean().optional(),
    link: z
      .string()
      .max(2048)
      .nullable()
      .optional()
      .refine((v) => v == null || isSafeElementLink(v), 'Lenker må være vanlige nettadresser'),
  })
  .passthrough()

const appStateSchema = z
  .object({
    viewBackgroundColor: z.string().max(40).optional(),
    gridSize: finite.positive().max(500).nullable().optional(),
    gridStep: z.number().int().positive().max(100).optional(),
    gridModeEnabled: z.boolean().optional(),
  })
  .strict()

export const stageSceneSchema = z
  .object({
    elements: z.array(elementSchema).max(STAGE_MAX_ELEMENTS, 'Tegningen har for mange elementer'),
    appState: appStateSchema.default({}),
  })
  .strict()
  .refine((s) => new Set(s.elements.map((e) => e.id)).size === s.elements.length, 'Tegningen har like element-id-er')

export type StageScene = z.infer<typeof stageSceneSchema>

export const EMPTY_STAGE_APP_STATE: StageScene['appState'] = {
  viewBackgroundColor: '#ffffff',
  gridSize: 20,
  gridStep: 5,
  gridModeEnabled: true,
}

/**
 * Validerer en innsendt tegning. Slettede elementer tas ut — de trengs ikke
 * uten sanntidssamarbeid, og de ville bare gjort raden større for hver lagring.
 */
export function parseStageScene(input: unknown): StageScene {
  const size = new TextEncoder().encode(JSON.stringify(input ?? null)).byteLength
  if (size > STAGE_SCENE_MAX_BYTES) throw new Error('Tegningen er for stor til å lagres (maks 1 MB)')
  const parsed = stageSceneSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Tegningen kunne ikke lagres: ${issue?.message ?? 'ugyldig innhold'}`)
  }
  return { ...parsed.data, elements: parsed.data.elements.filter((e) => !e.isDeleted) }
}

export function normalizeStageTitle(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, STAGE_TITLE_MAX).trim()
  if (!title) throw new Error('Gi oppsettet et navn')
  return title
}

/** CRLF → LF, trimmet, maks lengde. Tomt blir `null`. */
export function normalizeStageNotes(input: string | null | undefined): string | null {
  if (input == null) return null
  const notes = input.replace(/\r\n?/g, '\n').trim().slice(0, STAGE_NOTES_MAX).trim()
  return notes || null
}

/** Kontaktpersonen arrangøren skal ringe. Tomme felt er tomme strenger på klienten. */
export type StageContact = { name: string; email: string; phone: string }

export const STAGE_CONTACT_MAX = { name: 120, email: 254, phone: 40 } as const

export const EMPTY_STAGE_CONTACT: StageContact = { name: '', email: '', phone: '' }

/**
 * Trimmer og kutter kontaktfeltene; tomt blir `null` i databasen. Formatet
 * sjekkes bevisst ikke: feltene lagres mens man skriver, og «ola@» midt i et
 * ord skal ikke gi en lagringsfeil.
 */
export function normalizeStageContact(input: Partial<StageContact>) {
  const clean = (value: string | undefined, max: number) => value?.replace(/\s+/g, ' ').trim().slice(0, max).trim() || null
  return {
    contactName: clean(input.name, STAGE_CONTACT_MAX.name),
    contactEmail: clean(input.email, STAGE_CONTACT_MAX.email),
    contactPhone: clean(input.phone, STAGE_CONTACT_MAX.phone),
  }
}

export type StageReader = { canManageProjects: boolean; canBrowseArchive: boolean; canManageStage: boolean }

/**
 * Kan denne brukeren lese oppsettene i prosjektet?
 *
 * Utgangspunktet er prosjektsidens egen regel (`projectReadError`): ser du
 * prosjektet, ser du oppsettene. I tillegg kan `stage.manage` lese oppsett i
 * **tidligere publiserte** prosjekter — fjorårets konkurranseoppsett er det
 * naturlige utgangspunktet for årets — men aldri i et utkast, der selv navnet
 * er stabens.
 */
export function canReadStageSetups(project: ProjectVisibility, reader: StageReader, today: string): boolean {
  const error = projectReadError(project, { canManage: reader.canManageProjects, canBrowseArchive: reader.canBrowseArchive }, today)
  if (!error) return true
  return reader.canManageStage && project.isPublished
}

/** Filnavn uten tegn som er ulovlige på Windows/macOS. */
export function stageFileName(projectName: string, title: string, extension: string): string {
  const base = `${projectName} – ${title}`
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
  return `${base || 'Sceneoppsett'}.${extension}`
}
