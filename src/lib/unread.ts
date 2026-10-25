/**
 * «Ulest» for veggen og forumet. Rene regler uten database, slik at de kan
 * testes og deles av hub-en, fanelinjen og app-ikonet (Badging API).
 *
 * Bare de siste dagene teller. Lest-kvitteringene for beskjeder (`post_reads`)
 * kom 25. oktober 2026; uten et vindu ville alt som ble publisert før det stått
 * som ulest for alle, og et tall som aldri går ned er et tall ingen stoler på.
 */
export const UNREAD_WINDOW_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/** Eldste publiseringstidspunkt (epoch-ms) som fortsatt kan være ulest. */
export function unreadSince(now: number): number {
  return now - UNREAD_WINDOW_DAYS * DAY_MS
}

/** Det som vises på en fane eller et ikon: tall opp til 9, så «9+». */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null
  return count > 9 ? '9+' : String(count)
}

/**
 * Tellerne skallet trenger: Beskjeder-fanen, prikken på Forum og tallet på
 * app-ikonet. App-ikonet viser bare uleste beskjeder — forumet er en samtale
 * man går inn i, ikke noe man skal mases på om fra hjemskjermen.
 */
export type ShellCounts = {
  unreadPosts: number
  forumUnread: boolean
  /** Åpne og forfalte styreoppgaver for Styre-flisen, kun med `board.manage`. */
  board: { openTasks: number; overdue: number } | null
}

export const EMPTY_SHELL_COUNTS: ShellCounts = { unreadPosts: 0, forumUnread: false, board: null }

/** Ett innlegg slik ulest-regelen ser det. */
export type UnreadCandidate = {
  publishedAt: number | null
  authorId: string | null
  audience: 'all' | 'board'
  read: boolean
}

/**
 * Samme regel som SQL-en i `src/server/unread.ts` — testet her, brukt der.
 * Ulest = publisert innenfor vinduet, skrevet av noen andre, synlig for deg
 * (styrebeskjeder bare med `posts.publish`) og ikke åpnet.
 */
export function isUnread(
  post: UnreadCandidate,
  viewer: { id: string; canSeeBoardPosts: boolean },
  now: number,
): boolean {
  if (post.publishedAt === null || post.publishedAt < unreadSince(now)) return false
  if (post.authorId === viewer.id) return false
  if (post.audience === 'board' && !viewer.canSeeBoardPosts) return false
  return !post.read
}
