export function canModerateForum(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('forum.moderate')
}

export function canEditForumText(me: { id: string; permissions: string[] }, authorId: string | null, locked: boolean): boolean {
  return canModerateForum(me.permissions) || (!locked && authorId === me.id)
}

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
 * Hvem får push om et nytt svar? To grupper, og aldri begge for samme person:
 *
 * - `mention`: omtalt i svaret (aktivt medlem, ikke skribenten, `mentions` ikke
 *   av). En direkte omtale varsler alltid, også med uleste svar i tråden.
 * - `reply`: følger tråden, har ikke slått av forumsvar, og har lest seg opp.
 *
 * «@Alle i korpset» er ikke med her — det ville vært en masseutsending uten
 * noen sperre foran.
 */
export function forumNotifyPlan(input: {
  authorId: string
  mentioned: readonly string[]
  candidates: readonly ForumNotifyCandidate[]
}): { mention: string[]; reply: string[] } {
  const byId = new Map(input.candidates.map((c) => [c.userId, c]))
  const mention: string[] = []
  for (const id of new Set(input.mentioned)) {
    const c = byId.get(id)
    if (!c || !c.isActive || id === input.authorId || c.mentions === 'off') continue
    mention.push(id)
  }
  const mentioned = new Set(mention)
  const reply: string[] = []
  for (const c of input.candidates) {
    if (!c.isActive || c.userId === input.authorId || mentioned.has(c.userId)) continue
    if (c.forumReplies === 'off' || !c.caughtUp || !followsForumTopic(c)) continue
    reply.push(c.userId)
  }
  return { mention, reply }
}
