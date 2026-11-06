import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { reactions } from '../db/schema'
import { MAX_DISTINCT_REACTIONS, REACTION_TARGETS, type ReactionSummary, canAddDistinct, isReactionEmoji, normalizeReactionEmoji } from '../lib/reactions'
import { requireMe } from './access'
import { canReactTo, reactionsFor } from './reaction-store'

/**
 * Slår én emoji-reaksjon av eller på for den innloggede, på et innlegg, en
 * kommentar, en forumtråd eller et forumsvar. Svaret er den nye oppsummeringen
 * for innlegget, så skjermen kan erstatte sin optimistiske versjon med fasiten
 * (andre kan ha reagert i mellomtiden).
 *
 * Emojien valideres (`isReactionEmoji`) — en reaksjon kan aldri bli fritekst.
 */
export const toggleEmojiReaction = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(REACTION_TARGETS),
      targetId: z.string().min(1).max(100),
      // Normalisert FØR sjekken, så 👍 med og uten variantvalg blir samme reaksjon
      // (og samme som mobilappens like).
      emoji: z.string().max(64).transform(normalizeReactionEmoji).refine(isReactionEmoji, 'Ugyldig emoji'),
    }),
  )
  .handler(async ({ data }): Promise<{ reactions: ReactionSummary[] }> => {
    const me = await requireMe()
    if (!(await canReactTo(data.kind, data.targetId, me))) throw new Error('Fant ikke innholdet')
    const d = db()
    const target = and(eq(reactions.targetKind, data.kind), eq(reactions.targetId, data.targetId))
    const removed = await d
      .delete(reactions)
      .where(and(target, eq(reactions.userId, me.id), eq(reactions.emoji, data.emoji)))
      .returning({ emoji: reactions.emoji })
    if (removed.length === 0) {
      const existing = await d.selectDistinct({ emoji: reactions.emoji }).from(reactions).where(target)
      if (!canAddDistinct(existing.map((r) => r.emoji), data.emoji)) {
        throw new Error(`Maks ${MAX_DISTINCT_REACTIONS} ulike reaksjoner — bli med på en av dem som er der`)
      }
      await d
        .insert(reactions)
        .values({ targetKind: data.kind, targetId: data.targetId, userId: me.id, emoji: data.emoji, createdAt: new Date() })
        .onConflictDoNothing()
    }
    return { reactions: (await reactionsFor(data.kind, [data.targetId], me.id)).get(data.targetId) ?? [] }
  })

/**
 * Alle som har reagert på ett innlegg, en kommentar eller et forumsvar, per
 * emoji — arket «Hvem har reagert» (langt trykk på en reaksjon). Oppsummeringen
 * siden får med seg har bare de ti første navnene. Samme tilgang som å reagere:
 * «finnes ikke» og «ikke for deg» er samme svar.
 */
export const listReactionPeople = createServerFn({ method: 'POST' })
  .validator(z.object({ kind: z.enum(REACTION_TARGETS), targetId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<{ reactions: ReactionSummary[] }> => {
    const me = await requireMe()
    if (!(await canReactTo(data.kind, data.targetId, me))) throw new Error('Fant ikke innholdet')
    return { reactions: (await reactionsFor(data.kind, [data.targetId], me.id, Number.POSITIVE_INFINITY)).get(data.targetId) ?? [] }
  })
