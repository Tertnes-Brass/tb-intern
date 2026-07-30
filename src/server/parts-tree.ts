/**
 * Ren, runtime-uavhengig logikk for stemme-treet (nøstede stemmer).
 * Holdes fri for importer (db, auth m.m.) så den kan enhetstestes i node.
 *
 * Modell: `parts.parentId` er en nullable self-FK. En forelder-stemme
 * (parentId = null, men har barn) som «Slagverk» dekker understemmene sine
 * (Slagverk 1/2/3 …). Tildeles en bruker en forelder, ekspanderes tilgangen
 * til hele subtreet. Partitur-raden ('score') kan være visuelt nøstet under
 * Dirigent, men er aldri del av tilgangstreet.
 *
 * Brukes som ÉN sannhetskilde for ekspansjon — av effektive stemmer for et
 * medlem, ledelsesomfang for en seksjonsleder, og snapshot av vikar-deling.
 */

// Defensivt dybdetak. Praktisk besetning er maks 2 nivåer; taket sikrer at en
// patologisk/feilkonfigurert parentId-kjede aldri kan løkke uendelig.
export const MAX_PART_DEPTH = 3

export type PartNode = { id: string; parentId?: string | null }

/** parentId → direkte barn-id-er. Ekskluderer 'score' eksplisitt fra tilgangstreet. */
export function buildChildrenMap(rows: PartNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const r of rows) {
    if (r.id === 'score') continue
    if (!r.parentId || r.parentId === 'score') continue
    const list = map.get(r.parentId) ?? []
    list.push(r.id)
    map.set(r.parentId, list)
  }
  return map
}

/**
 * Transitiv lukking nedover: gitt et sett tildelte stemmer, returnér settet av
 * alle stemmer brukeren effektivt har tilgang til (seg selv + alle etterkommere).
 * Sykel-vern via visited-set + hard dybdegrense, så ingen parentId-konfig kan
 * henge beregningen. 'score' tas aldri med. Identitet når treet er flatt
 * (alle parentId = null) — dvs. dagens oppførsel inntil noen bygger et tre.
 */
export function expandPartIds(rawIds: string[], childrenMap: Map<string, string[]>): string[] {
  const out = new Set<string>()
  const stack: Array<{ id: string; depth: number }> = []
  for (const id of rawIds) {
    if (id !== 'score') stack.push({ id, depth: 0 })
  }
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!
    if (out.has(id)) continue // sykel-vern
    out.add(id)
    if (depth >= MAX_PART_DEPTH) continue
    for (const child of childrenMap.get(id) ?? []) {
      if (!out.has(child)) stack.push({ id: child, depth: depth + 1 })
    }
  }
  return [...out]
}

/**
 * Kan en seksjonsleder med dette (allerede ekspanderte) omfanget administrere
 * et medlems stemmer? Krever at BÅDE medlemmets nåværende stemmer OG de
 * innsendte ligger HELT innenfor omfanget — da er en enkel full-overskriving
 * trygg fordi lederen aldri rører stemmer utenfor egen seksjon. Stemmeløse
 * medlemmer (ingen nåværende stemmer) håndteres kun av global `members.manage`.
 *
 * `leadsPartIds` forutsettes ekspandert (forelder ⇒ barn) av `expandPartIds`.
 */
export function leaderCanAssign(
  leadsPartIds: string[],
  currentPartIds: string[],
  requestedPartIds: string[],
): boolean {
  const scope = new Set(leadsPartIds)
  if (scope.size === 0) return false
  if (currentPartIds.length === 0) return false
  return currentPartIds.every((id) => scope.has(id)) && requestedPartIds.every((id) => scope.has(id))
}

// ---------- Visningsrekkefølge og flytting ----------

export type OrderedPart = { id: string; parentId: string | null; sortOrder: number }

/**
 * Et barn i VISNINGS-forstand: forelderen finnes og er selv på rot-nivå.
 * Selv-forelder, ukjent forelder eller forelder-som-selv-er-barn (umulig med
 * invariantene, men mulig i feilkonfigurert data) behandles som rot, så alle
 * rader alltid er med i rekkefølgen og beregningen aldri kan løkke.
 */
function isChildRow(r: OrderedPart, byId: Map<string, OrderedPart>): boolean {
  if (r.parentId == null) return false
  const parent = byId.get(r.parentId)
  return parent != null && parent.id !== r.id && parent.parentId == null
}

/** Blokker i visningsrekkefølge: [rot-id, ...barn-id-er], røtter og barn hver for seg i sortOrder-rekkefølge. */
function buildBlocks(rows: OrderedPart[]): string[][] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const bySort = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  const children = new Map<string, string[]>()
  for (const r of bySort) {
    if (!isChildRow(r, byId)) continue
    const list = children.get(r.parentId!) ?? []
    list.push(r.id)
    children.set(r.parentId!, list)
  }
  return bySort.filter((r) => !isChildRow(r, byId)).map((r) => [r.id, ...(children.get(r.id) ?? [])])
}

/**
 * Visningsrekkefølgen som BLOKKER: røtter i sortOrder-rekkefølge, hver rot
 * umiddelbart etterfulgt av egne barn i sortOrder-rekkefølge. Reparerer
 * dermed historisk «løsrevne» barn hvis sortOrder havnet utenfor blokken.
 */
export function buildDisplayOrder(rows: OrderedPart[]): string[] {
  return buildBlocks(rows).flat()
}

/**
 * Ordnede «søsken»-id-er for en stemme: alle røttene hvis den er rot, ellers
 * forelderens barn. Ukjent id gir tom liste.
 */
export function listSiblings(rows: OrderedPart[], id: string): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const me = byId.get(id)
  if (!me) return []
  const blocks = buildBlocks(rows)
  if (isChildRow(me, byId)) return blocks.find((b) => b[0] === me.parentId)?.slice(1) ?? []
  return blocks.map((b) => b[0]!)
}

/**
 * Ny komplett id-rekkefølge etter å ha flyttet `id` rett etter `afterId`
 * (null = først blant sine søsken). En rot flyttes som HEL blokk (med barna)
 * og bare etter en annen rot; et barn flyttes bare innenfor sin forelder.
 * Kaster ved ugyldig mål — serveren stoler ikke på at UI-et begrenser options.
 */
export function reorderAfter(rows: OrderedPart[], id: string, afterId: string | null): string[] {
  if (id === afterId) throw new Error('En stemme kan ikke flyttes etter seg selv')
  const byId = new Map(rows.map((r) => [r.id, r]))
  const me = byId.get(id)
  if (!me) throw new Error('Ukjent stemme')
  const target = afterId == null ? null : byId.get(afterId)
  if (afterId != null && !target) throw new Error('Ukjent stemme å flytte etter')

  const blocks = buildBlocks(rows)

  if (isChildRow(me, byId)) {
    if (target && !(isChildRow(target, byId) && target.parentId === me.parentId)) {
      throw new Error('En understemme kan bare flyttes etter et søsken med samme forelder')
    }
    const block = blocks.find((b) => b[0] === me.parentId)!
    const siblings = block.slice(1).filter((s) => s !== id)
    siblings.splice(target ? siblings.indexOf(target.id) + 1 : 0, 0, id)
    block.splice(1, block.length - 1, ...siblings)
  } else {
    if (target && isChildRow(target, byId)) {
      throw new Error('En stemme på øverste nivå kan bare flyttes etter en annen stemme på øverste nivå')
    }
    const [block] = blocks.splice(
      blocks.findIndex((b) => b[0] === id),
      1,
    )
    blocks.splice(target ? blocks.findIndex((b) => b[0] === target.id) + 1 : 0, 0, block!)
  }
  return blocks.flat()
}
