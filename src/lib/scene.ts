/**
 * Reglene for sceneoppsettet (#11): elementene, tegneflaten, opptellingen og
 * serialiseringen. Rene funksjoner uten server- eller DOM-avhengigheter, slik
 * at tegneflaten, serveren og testene er enige om hva et gyldig oppsett er.
 *
 * Tegneflaten er bygget SELV i SVG med pointer events. Ingen ny avhengighet:
 * et bibliotek for drag-and-drop på lerret koster mer enn de hundre linjene det
 * erstatter, og formatet vårt (en liste med typer og koordinater) er uansett
 * vårt eget.
 */

import { permissionsInclude } from './permissions'

// ---------- Tilgang ----------

/**
 * Redigering krever `projects.manage` ELLER `assets.manage` — nøyaktig samme
 * regel som riggelista (#12), og av samme grunn: oppsettet er prosjektets
 * ansvar, men det er materialforvalteren som vet hvor mange stoler som finnes.
 * VISNING er åpen for alle innloggede: hele korpset skal kunne se hvor de skal
 * sitte.
 */
export const STAGE_MANAGE_PERMISSIONS = ['projects.manage', 'assets.manage'] as const

export function canManageStagePlot(permissions: Iterable<string>): boolean {
  const list = [...permissions]
  return STAGE_MANAGE_PERMISSIONS.some((p) => permissionsInclude(list, p))
}

// ---------- Tegneflaten ----------

/**
 * Scenen er 1200 × 800 «enheter», ikke piksler: SVG-en skaleres til bredden den
 * får, og et lagret oppsett ser likt ut på en telefon, på en projektor og i den
 * nedlastede fila. Forholdet 3:2 er valgt fordi en scene er bredere enn den er
 * dyp, og fordi et brassband på 30 stoler i buer får plass uten å klumpe seg.
 */
export const STAGE_WIDTH = 1200
export const STAGE_HEIGHT = 800

/** Taket finnes for å hindre at et rått kall lagrer en million stoler. */
export const MAX_STAGE_ELEMENTS = 300
export const STAGE_LABEL_MAX = 40
export const STAGE_NOTE_MAX = 2000

export const STAGE_ELEMENT_TYPES = ['chair', 'stand', 'podium', 'percussion', 'other'] as const
export type StageElementType = (typeof STAGE_ELEMENT_TYPES)[number]

export function isStageElementType(value: unknown): value is StageElementType {
  return typeof value === 'string' && (STAGE_ELEMENT_TYPES as readonly string[]).includes(value)
}

/**
 * Entall og flertall hver for seg, fordi norsk intetkjønn ikke får -er:
 * «4 notestativ», ikke «4 notestativer». Opptellingen er en setning et menneske
 * skal lese høyt under rigging, og da teller den slags.
 */
export const STAGE_ELEMENT_LABELS: Record<StageElementType, { one: string; many: string }> = {
  chair: { one: 'stol', many: 'stoler' },
  stand: { one: 'notestativ', many: 'notestativ' },
  podium: { one: 'dirigentpodium', many: 'dirigentpodier' },
  percussion: { one: 'slagverk', many: 'slagverk' },
  other: { one: 'element', many: 'elementer' },
}

/** Teksten på knappene i paletten, i den rekkefølgen de skal stå. */
export const STAGE_ELEMENT_BUTTON_LABELS: Record<StageElementType, string> = {
  chair: 'Stol',
  stand: 'Notestativ',
  podium: 'Dirigentpodium',
  percussion: 'Slagverk',
  other: 'Annet',
}

/** Elementtyper som bærer en fritekst-etikett («Pauker», «Bordflagg»). */
export function usesLabel(type: StageElementType): boolean {
  return type === 'percussion' || type === 'other'
}

/** Størrelsen i sceneenheter. Brukes av både tegneflaten og treffområdet. */
export function stageElementSize(type: StageElementType): { w: number; h: number } {
  switch (type) {
    case 'chair':
      return { w: 46, h: 46 }
    case 'stand':
      return { w: 38, h: 38 }
    case 'podium':
      return { w: 110, h: 80 }
    case 'percussion':
      return { w: 84, h: 84 }
    case 'other':
      return { w: 90, h: 60 }
  }
}

// ---------- Modellen ----------

export type StageElement = {
  id: string
  type: StageElementType
  /** Midtpunktet, i sceneenheter. */
  x: number
  y: number
  /** Grader, 0–359. 0 = elementet vender mot publikum (nedover på skjermen). */
  rotation: number
  label: string | null
}

export type StagePlot = { elements: StageElement[] }

export const EMPTY_STAGE_PLOT: StagePlot = { elements: [] }

/** Åtte retninger. Fri rotasjon finnes også, men knappene går i 45°-steg. */
export const STAGE_ROTATION_STEP = 45

export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const rounded = Math.round(deg)
  return ((rounded % 360) + 360) % 360
}

/** Nærmeste av de åtte retningene. */
export function snapRotation(deg: number): number {
  return normalizeRotation(Math.round(normalizeRotation(deg) / STAGE_ROTATION_STEP) * STAGE_ROTATION_STEP)
}

/**
 * Holder midtpunktet innenfor scenen. Et element som havner utenfor er ikke en
 * feil verdt en feilmelding — det er en finger som gled, og svaret er å legge
 * det tilbake på kanten.
 */
export function clampToStage(x: number, y: number): { x: number; y: number } {
  const clamp = (value: number, max: number) => {
    if (!Number.isFinite(value)) return Math.round(max / 2)
    return Math.round(Math.min(max, Math.max(0, value)))
  }
  return { x: clamp(x, STAGE_WIDTH), y: clamp(y, STAGE_HEIGHT) }
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, STAGE_LABEL_MAX) : null
}

// ---------- Validering og serialisering ----------

/**
 * Leser en lagret layout. **Tolerant, ikke tillitsfull:** ukjente elementtyper,
 * manglende koordinater og rot i JSON-en gir et TOMT oppsett eller en droppet
 * rad — aldri et kast. En feil i en gammel rad skal ikke gjøre prosjektsiden
 * utilgjengelig; den skal gjøre tegningen tom, som er en tilstand brukeren kan
 * rette opp selv.
 *
 * Funksjonen kjøres ved BÅDE lesing og skriving (som `sanitizeAssetInput`), så
 * et rått kall ikke kan legge inn egne elementtyper, koordinater utenfor
 * scenen, en etikett på 4 MB eller flere elementer enn taket.
 */
export function parseStagePlot(raw: unknown): StagePlot {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { elements: [] }
    }
  }
  if (!value || typeof value !== 'object') return { elements: [] }
  const list = (value as { elements?: unknown }).elements
  if (!Array.isArray(list)) return { elements: [] }

  const elements: StageElement[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (elements.length >= MAX_STAGE_ELEMENTS) break
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (!isStageElementType(item.type)) continue

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 64) : `e${elements.length}`
    // Duplikate id-er ville gjort «flytt dette elementet» tvetydig.
    if (seen.has(id)) continue
    seen.add(id)

    const { x, y } = clampToStage(Number(item.x), Number(item.y))
    elements.push({
      id,
      type: item.type,
      x,
      y,
      rotation: normalizeRotation(Number(item.rotation)),
      label: usesLabel(item.type) ? cleanLabel(item.label) : null,
    })
  }
  return { elements }
}

/** JSON-en som lagres. Går alltid gjennom `parseStagePlot` først. */
export function serializeStagePlot(plot: StagePlot): string {
  return JSON.stringify(parseStagePlot(plot))
}

// ---------- Redigering (rene operasjoner) ----------

export function addStageElement(elements: StageElement[], element: StageElement): StageElement[] {
  if (elements.length >= MAX_STAGE_ELEMENTS) throw new Error(`Maks ${MAX_STAGE_ELEMENTS} elementer på scenen`)
  const { x, y } = clampToStage(element.x, element.y)
  return [
    ...elements,
    { ...element, x, y, rotation: normalizeRotation(element.rotation), label: usesLabel(element.type) ? element.label : null },
  ]
}

export function moveStageElement(elements: StageElement[], id: string, x: number, y: number): StageElement[] {
  const next = clampToStage(x, y)
  return elements.map((el) => (el.id === id ? { ...el, ...next } : el))
}

export function rotateStageElement(elements: StageElement[], id: string, delta: number): StageElement[] {
  return elements.map((el) => (el.id === id ? { ...el, rotation: normalizeRotation(el.rotation + delta) } : el))
}

export function labelStageElement(elements: StageElement[], id: string, label: string | null): StageElement[] {
  return elements.map((el) => (el.id === id ? { ...el, label: usesLabel(el.type) ? cleanLabel(label) : null } : el))
}

export function removeStageElement(elements: StageElement[], id: string): StageElement[] {
  return elements.filter((el) => el.id !== id)
}

// ---------- Opptelling ----------

export type StageCount = {
  type: StageElementType
  /** «12 stoler» / «1 stol» — riktig tall og riktig form. */
  label: string
  count: number
  /** Fritekst-etikettene som faktisk finnes, for slagverk og «annet». */
  labels: string[]
}

/**
 * Antall per elementtype, i palettens rekkefølge. Typer uten elementer faller
 * ut — en opptelling skal ikke si «0 dirigentpodier».
 */
export function countStageElements(elements: StageElement[]): StageCount[] {
  const counts: StageCount[] = []
  for (const type of STAGE_ELEMENT_TYPES) {
    const matching = elements.filter((el) => el.type === type)
    if (matching.length === 0) continue
    const words = STAGE_ELEMENT_LABELS[type]
    const labels: string[] = []
    for (const el of matching) {
      if (el.label && !labels.includes(el.label)) labels.push(el.label)
    }
    counts.push({
      type,
      label: `${matching.length} ${matching.length === 1 ? words.one : words.many}`,
      count: matching.length,
      labels: labels.sort((a, b) => a.localeCompare(b, 'nb')),
    })
  }
  return counts
}

/** Én linje: «12 stoler, 4 notestativ, 1 dirigentpodium». */
export function stageSummary(elements: StageElement[]): string {
  const counts = countStageElements(elements)
  if (counts.length === 0) return 'Ingen elementer plassert ennå'
  return counts.map((c) => c.label).join(', ')
}

// ---------- Nedlastbar SVG ----------

/**
 * Tokens som må følge med i en frittstående fil. SVG-en på skjermen bruker
 * `fill="var(--paper-raised)"` og arver verdiene fra sida; i en fil som åpnes
 * alene finnes ingen side å arve fra, så verdiene leses ut av `:root` ved
 * nedlasting og skrives inn i fila. Dermed er design-tokenene fortsatt eneste
 * kilde til farge — vi hardkoder ingenting.
 */
export const STAGE_SVG_TOKENS = [
  '--paper',
  '--paper-raised',
  '--paper-sunken',
  '--ink',
  '--ink-soft',
  '--ink-faint',
  '--line',
  '--line-strong',
  '--brass',
  '--brass-strong',
] as const

export type StageSvgTokens = Partial<Record<(typeof STAGE_SVG_TOKENS)[number], string>>

/**
 * Gjør en serialisert `<svg>` fra sida om til en frittstående fil: legger på
 * `xmlns` (nettleseren utelater den i `innerHTML`-serialisering, og uten den er
 * fila ikke en SVG for noen andre), og skriver token-verdiene inn i et
 * `<style>`-element øverst.
 *
 * Ren strengoperasjon med vilje — ingen DOM. Det gjør den testbar i node, og
 * det gjør at én funksjon dekker både «last ned» og en eventuell serverbruk
 * senere. Selve markeringen kommer fra `XMLSerializer` på en KLONE der
 * redigeringskromet (`[data-editor-only]`) allerede er fjernet.
 */
export function standaloneStageSvg(markup: string, tokens: StageSvgTokens): string {
  const open = markup.match(/^\s*<svg\b[^>]*>/)
  if (!open) throw new Error('Fant ikke SVG-en å laste ned')

  let openTag = open[0].trimStart()
  if (!/\sxmlns=/.test(openTag)) {
    openTag = openTag.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  const declarations = STAGE_SVG_TOKENS.filter((name) => tokens[name])
    .map((name) => `  ${name}: ${tokens[name]};`)
    .join('\n')
  const style = declarations ? `<style>\nsvg {\n${declarations}\n}\n</style>\n` : ''

  const rest = markup.slice(open.index! + open[0].length)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${openTag}\n${style}${rest}`
}

/**
 * Filnavnet nedlastingen får. Norske bokstaver skrives om i stedet for å
 * strykes, slik at «Vårkonsert» blir `varkonsert`, ikke `vrkonsert`.
 */
export function stagePlotFileName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `sceneoppsett-${slug || 'prosjekt'}.svg`
}
