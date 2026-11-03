/**
 * Svar på svar — felles regler for forumet og kommentarene på veggen.
 *
 * ## To nivåer, ikke uendelig nøsting
 *
 * Et svar på tråden (eller en kommentar på innlegget) er en **rot**. Svarer man
 * på en rot, havner svaret under den. Svarer man på et svar som allerede står
 * under en rot, havner det nye svaret under den SAMME roten — ikke ett hakk
 * lenger inn — og husker hvem det svarte på (`replyToId`), slik at skjermen kan
 * skrive «Svar til Jonas». Det er modellen Facebook, Instagram og YouTube
 * bruker, og den eneste som holder på en telefonskjerm: en samtale på åtte
 * vekslende svar ville ellers stått i en stadig smalere kolonne.
 *
 * Derfor lagres to kolonner, og begge settes av serveren, aldri av klienten:
 * klienten sier bare HVA den svarer på (`replyToId`), og `replyPlacement`
 * avgjør hvor svaret står. Invarianten er at `parentId` alltid peker på en rot,
 * og at `replyToId` er roten selv eller et annet svar under den.
 *
 * Rene funksjoner uten database, testet i `threads.test.ts`.
 */

/** Det en rad må ha for å kunne plasseres i en tråd. */
export type ThreadItem = {
  id: string
  /** Roten svaret står under; null = selv en rot. */
  parentId: string | null
  /** Svaret det konkret svarer på; null for en rot. */
  replyToId: string | null
  createdAt: number
}

/** Hvor havner et nytt svar på `target`? Se modulkommentaren. */
export function replyPlacement(target: { id: string; parentId: string | null }): { parentId: string; replyToId: string } {
  return { parentId: target.parentId ?? target.id, replyToId: target.id }
}

/** Eldst først, med id som tie-break — samme rekkefølge som SQL-en. */
export function compareOldestFirst(a: { id: string; createdAt: number }, b: { id: string; createdAt: number }): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export type Thread<T> = T & { children: T[] }

/**
 * Grupperer en flat liste i tråder. Røttene beholder rekkefølgen de kom i
 * (kalleren vet om det er nyeste eller eldste først); svarene under hver rot
 * står alltid eldst først, som en samtale.
 *
 * Et svar hvis rot ikke finnes i lista blir en egen rot i stedet for å
 * forsvinne. Det skal ikke skje (sletting lar et merke stå igjen), men tekst
 * noen har skrevet skal aldri bli usynlig fordi en fremmednøkkel ble NULL.
 */
export function buildThreads<T>(items: readonly T[], ref: (item: T) => ThreadItem): Thread<T>[] {
  const ids = new Set(items.map((item) => ref(item).id))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const item of items) {
    const { parentId } = ref(item)
    if (parentId && parentId !== ref(item).id && ids.has(parentId)) {
      const list = children.get(parentId) ?? []
      list.push(item)
      children.set(parentId, list)
    } else {
      roots.push(item)
    }
  }
  // Et svar på et svar som selv sto under en rot (skal heller ikke skje) tas
  // med under den roten det faktisk hører til, ikke mistet.
  const rootIds = new Set(roots.map((r) => ref(r).id))
  for (const [parentId, list] of children) {
    if (rootIds.has(parentId)) continue
    const parent = items.find((item) => ref(item).id === parentId)
    const rootId = parent ? ref(parent).parentId : null
    if (rootId && rootIds.has(rootId)) children.set(rootId, [...(children.get(rootId) ?? []), ...list])
    else roots.push(...list)
    children.delete(parentId)
  }
  return roots.map((root) => ({
    ...root,
    children: [...(children.get(ref(root).id) ?? [])].sort((a, b) => compareOldestFirst(ref(a), ref(b))),
  }))
}

/**
 * Hva svarer et svar under en rot på? Bare når det er et ANNET svar enn roten
 * er det verdt en «Svar til …»-linje — et svar rett på roten står allerede
 * under den.
 *
 * - `root`: svarer på roten (eller mangler referanse).
 * - `sibling`: svarer på et annet svar i samme tråd.
 * - `gone`: svarte på noe som ikke lenger finnes i tråden.
 */
export type ReplyContext<T> = { kind: 'root' } | { kind: 'sibling'; target: T } | { kind: 'gone' }

export function replyContext<T>(child: T, siblings: readonly T[], ref: (item: T) => ThreadItem): ReplyContext<T> {
  const { replyToId, parentId } = ref(child)
  if (!replyToId || replyToId === parentId) return { kind: 'root' }
  const target = siblings.find((s) => ref(s).id === replyToId)
  return target ? { kind: 'sibling', target } : { kind: 'gone' }
}

/** Så mange svar vises under en rot før de eldste foldes sammen. */
export const VISIBLE_CHILDREN = 3

/**
 * Lange undertråder foldes: de eldste svarene skjules bak «Vis N tidligere
 * svar», de siste `keep` står fremme. To ting skjules aldri: et svar man ikke
 * har sett (`mustShow`, typisk uleste og det man ble lenket til) — og heller
 * ikke noe som står ETTER et slikt, for en samtale med hull i midten er
 * vanskeligere å lese enn en som starter litt tidligere. Å folde bort ett
 * eneste svar er ikke verdt et klikk, så da vises alt.
 */
export function foldChildren<T>(
  children: readonly T[],
  options: { keep?: number; mustShow?: (child: T) => boolean } = {},
): { hidden: number; visible: T[] } {
  const keep = options.keep ?? VISIBLE_CHILDREN
  let start = Math.max(0, children.length - keep)
  if (options.mustShow) {
    const first = children.findIndex(options.mustShow)
    if (first !== -1) start = Math.min(start, first)
  }
  if (start <= 1) return { hidden: 0, visible: [...children] }
  return { hidden: start, visible: children.slice(start) }
}
