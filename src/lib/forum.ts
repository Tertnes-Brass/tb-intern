export function canModerateForum(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('forum.moderate')
}

/**
 * Kan `me` redigere — og slette — denne teksten? Egen tekst så lenge tråden er
 * åpen, alt for en moderator. Et «slettet»-merke har ingen forfatter, så bare
 * en moderator kommer forbi her; serveren nekter uansett å røre et merke.
 */
export function canEditForumText(me: { id: string; permissions: string[] }, authorId: string | null, locked: boolean): boolean {
  return canModerateForum(me.permissions) || (!locked && authorId !== null && authorId === me.id)
}

/** Feilen når tråden ikke finnes — slettet, eller en gammel lenke. Ruta viser den som en rolig side. */
export const FORUM_TOPIC_GONE = 'Tråden finnes ikke lenger.'

// ---------- Varsler om nye svar ----------

export const FORUM_REPLY_CHOICES = ['all', 'off'] as const
export type ForumReplyChoice = (typeof FORUM_REPLY_CHOICES)[number]

/**
 * Følger medlemmet tråden? Et eksplisitt valg (`forum_follows`) vinner alltid;
 * uten det følger man tråder man har startet eller svart i. Den som har dempet
 * en tråd og svarer igjen, forblir dempet — valget var bevisst.
 */
export function followsForumTopic(input: { explicit: boolean | null; participated: boolean }): boolean {
  return input.explicit ?? input.participated
}

export type ForumNotifyCandidate = {
  userId: string
  isActive: boolean
  /** Har startet tråden eller svart i den. */
  participated: boolean
  /** Raden i `forum_follows`, eller null. */
  explicit: boolean | null
  /**
   * Ingen uleste svar fra andre siden man sist var med i tråden (eget svar,
   * startet tråden eller begynte å følge). Har man det, er man allerede varslet
   * om det første av dem — da kommer neste varsel først når man har lest.
   */
  caughtUp: boolean
  forumReplies: ForumReplyChoice
  mentions: 'all' | 'off'
}

/**
 * Hvem får push om et nytt svar? Tre grupper, og aldri mer enn én av dem for
 * samme person (første treff vinner):
 *
 * - `mention`: omtalt i svaret (aktivt medlem, ikke skribenten, `mentions` ikke
 *   av). En direkte omtale varsler alltid, også med uleste svar i tråden og i
 *   en dempet tråd.
 * - `direct`: den man svarte på («Svar» under et svar). Rettet til én person,
 *   som en omtale — derfor samme valg (`mentions`) og samme unntak for uleste
 *   svar og demping. Med `mentions` av faller man tilbake til `reply`.
 * - `reply`: følger tråden, har ikke slått av forumsvar, og har lest seg opp.
 *
 * «@Alle i korpset» er ikke med her — det ville vært en masseutsending uten
 * noen sperre foran.
 */
export function forumNotifyPlan(input: {
  authorId: string
  mentioned: readonly string[]
  /** Forfatteren av svaret det ble svart på, eller null for et svar rett på tråden. */
  repliedTo?: string | null
  candidates: readonly ForumNotifyCandidate[]
}): { mention: string[]; direct: string[]; reply: string[] } {
  const byId = new Map(input.candidates.map((c) => [c.userId, c]))
  const personal = (id: string) => {
    const c = byId.get(id)
    return !!c && c.isActive && id !== input.authorId && c.mentions !== 'off'
  }
  const mention = [...new Set(input.mentioned)].filter(personal)
  const taken = new Set(mention)
  const direct = input.repliedTo && !taken.has(input.repliedTo) && personal(input.repliedTo) ? [input.repliedTo] : []
  for (const id of direct) taken.add(id)
  const reply: string[] = []
  for (const c of input.candidates) {
    if (!c.isActive || c.userId === input.authorId || taken.has(c.userId)) continue
    if (c.forumReplies === 'off' || !c.caughtUp || !followsForumTopic(c)) continue
    reply.push(c.userId)
  }
  return { mention, direct, reply }
}
