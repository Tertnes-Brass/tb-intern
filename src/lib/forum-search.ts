/**
 * Sortering i forumet. Søkereglene (folding, treff, utdrag) er de samme som på
 * veggen og bor i src/lib/post-search.ts; her er bare det som skiller forumet:
 * en tråd lever av svarene sine, så standarden er siste aktivitet, ikke når
 * den ble startet — og «Eldste» finnes ikke (det dekker søket bedre).
 */

export type ForumSort = 'treff' | 'aktivitet' | 'nye' | 'aktive'

export const FORUM_SORTS: ReadonlyArray<{ value: ForumSort; label: string; hint: string }> = [
  { value: 'treff', label: 'Beste treff', hint: 'Treff i tittelen først' },
  { value: 'aktivitet', label: 'Siste aktivitet', hint: 'Sist besvart først' },
  { value: 'nye', label: 'Nye tråder', hint: 'Sist startet først' },
  { value: 'aktive', label: 'Flest svar', hint: 'De mest diskuterte først' },
]

export const FORUM_SORT_VALUES = FORUM_SORTS.map((s) => s.value) as [ForumSort, ...ForumSort[]]

/** Sorteringen som gjelder: «Beste treff» finnes bare når man søker, og er da standard. */
export function effectiveForumSort(sort: ForumSort | undefined, searching: boolean): ForumSort {
  if (!sort) return searching ? 'treff' : 'aktivitet'
  if (sort === 'treff' && !searching) return 'aktivitet'
  return sort
}

export function forumSortOptions(searching: boolean): typeof FORUM_SORTS {
  return searching ? FORUM_SORTS : FORUM_SORTS.filter((s) => s.value !== 'treff')
}

type SortableTopic = { id: string; activityAt: number; createdAt: number; replyCount: number }

/**
 * Sorterer en kopi — søketreffene; den vanlige lista sorteres i SQL med samme
 * regel (`listForum`). «Beste treff» beholder rekkefølgen den fikk. Lik verdi
 * faller tilbake på siste aktivitet og så id, som i SQL-en, så rekkefølgen er
 * stabil mellom to hentinger.
 */
export function sortForumTopics<T extends SortableTopic>(topics: readonly T[], sort: ForumSort): T[] {
  const byActivity = (a: T, b: T) => b.activityAt - a.activityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  const list = [...topics]
  switch (sort) {
    case 'treff':
      return list
    case 'aktivitet':
      return list.sort(byActivity)
    case 'nye':
      return list.sort((a, b) => b.createdAt - a.createdAt || byActivity(a, b))
    case 'aktive':
      return list.sort((a, b) => b.replyCount - a.replyCount || byActivity(a, b))
  }
}
