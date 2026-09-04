import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { memberProfiles, partShares, parts, user, userParts } from '../db/schema'
import { type PartShareRow, partShareRejection } from '../lib/part-shares'
import { writeAudit } from './audit'
import { requireMe } from './access'

/**
 * Delte stemmer mellom medlemmer (#16).
 *
 * Ingen ny rettighet: å dele SIN EGEN stemme er en medlemshandling, som å legge
 * ut noe på veggen. Gaten er eierskapet — `partShareRejection` krever at stemma
 * står i din egen `user_parts` — ikke en nøkkel i `PERMISSION_CATALOG`. En
 * rettighet ville dessuten vært feil verktøy: den ville gitt noen retten til å
 * dele *andres* stemmer, som er nøyaktig det denne funksjonen ikke gjør.
 *
 * Lesing av delingene skjer i `currentUser()` (mottakersiden, hver forespørsel)
 * og i `getHome` (giversiden, «Mine noter»). Selve tilgangen håndheves ETT sted:
 * `memberCanAccessPart` i `file-access.ts`, via `AccessCtx.sharedParts`.
 *
 * Modulen eksporterer BARE serverfunksjoner og typer. En levende eksport her
 * ville dratt `cloudflare:workers` inn i klientbygget gjennom `PartShares.tsx`,
 * som importerer serverfunksjonene herfra (samme felle som `post-images.ts`).
 * Giversidens spørring bor derfor i `projects.ts`, og komponentene tar den rene
 * logikken fra `src/lib/part-shares.ts`.
 */

/**
 * Valgmulighetene i delingsdialogen: stemmene DU kan dele, og medlemmene du kan
 * dele med. Hentes først når dialogen åpnes — korpset er tretti personer, og
 * lista skal ikke ligge i hver eneste lasting av «Mine noter».
 *
 * `myParts` er de RÅ tildelte stemmene (`user_parts`), ikke de ekspanderte og
 * ikke de du har fått delt: du kan bare dele det som faktisk er ditt, og en
 * mottatt deling kan derfor ikke deles videre.
 */
export const listPartShareOptions = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()

  const rows = await d
    .select({
      id: user.id,
      name: user.name,
      partName: parts.nameNo,
      partSort: parts.sortOrder,
      isPrimary: userParts.isPrimary,
    })
    .from(memberProfiles)
    .innerJoin(user, eq(memberProfiles.authUserId, user.id))
    .leftJoin(userParts, eq(userParts.userId, user.id))
    .leftJoin(parts, eq(userParts.partId, parts.id))
    .where(eq(memberProfiles.isActive, true))

  // Primærstemmen først, ellers laveste sortOrder — samme regel som medlemslista
  // og «ansvarlig»-velgeren, så et navn ikke får to ulike stemmer to steder.
  const byId = new Map<string, { id: string; name: string; partName: string | null; rank: number }>()
  for (const row of rows) {
    if (row.id === me.id) continue
    const rank = (row.isPrimary ? 0 : 1) * 10_000 + (row.partSort ?? 999)
    const current = byId.get(row.id)
    if (!current) {
      byId.set(row.id, { id: row.id, name: row.name, partName: row.partName, rank })
    } else if (rank < current.rank) {
      current.partName = row.partName
      current.rank = rank
    }
  }

  return {
    myParts: me.parts.map((p) => ({ id: p.id, nameNo: p.nameNo })),
    members: [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
      .map(({ rank: _rank, ...member }) => member),
  }
})

export const sharePart = createServerFn({ method: 'POST' })
  .validator(z.object({ partId: z.string().max(64), toUserId: z.string().max(64) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const d = db()

    const [recipient, given] = await Promise.all([
      d
        .select({ isActive: memberProfiles.isActive })
        .from(memberProfiles)
        .where(eq(memberProfiles.authUserId, data.toUserId))
        .limit(1),
      d.select({ partId: partShares.partId, toUserId: partShares.toUserId }).from(partShares).where(eq(partShares.fromUserId, me.id)),
    ])

    // Alle reglene på ett sted, og de samme som skjemaet viser. `me.parts` er
    // de RÅ tildelte stemmene — hverken ekspanderte barn eller mottatte delinger.
    const rejection = partShareRejection({
      meId: me.id,
      ownPartIds: me.parts.map((p) => p.id),
      givenCount: given.length,
      toUserId: data.toUserId,
      partId: data.partId,
      recipientIsActiveMember: !!recipient[0]?.isActive,
      alreadyShared: given.some((g) => g.toUserId === data.toUserId && g.partId === data.partId),
    })
    if (rejection) throw new Error(rejection)

    await d
      .insert(partShares)
      .values({ fromUserId: me.id, toUserId: data.toUserId, partId: data.partId, createdAt: new Date() })
      .onConflictDoNothing()

    await writeAudit({
      action: 'member.part_shared',
      actorUserId: me.id,
      targetUserId: data.toUserId,
      details: { partId: data.partId },
    })
    return { ok: true }
  })

/**
 * Fjerner en deling. BEGGE parter kan gjøre det: deleren angrer, og mottakeren
 * skal kunne takke nei til en stemme hen ikke vil ha liggende. Derfor står både
 * `from_user_id` og `to_user_id` i WHERE — id-ene alene ville latt et rått kall
 * rive ned en deling mellom to andre.
 */
export const removePartShare = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      fromUserId: z.string().max(64),
      toUserId: z.string().max(64),
      partId: z.string().max(64),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireMe()
    if (me.id !== data.fromUserId && me.id !== data.toUserId) {
      throw new Error('Du kan bare fjerne delinger du selv er part i.')
    }
    await db()
      .delete(partShares)
      .where(
        and(
          eq(partShares.fromUserId, data.fromUserId),
          eq(partShares.toUserId, data.toUserId),
          eq(partShares.partId, data.partId),
        ),
      )
    await writeAudit({
      action: 'member.part_share_removed',
      actorUserId: me.id,
      targetUserId: me.id === data.fromUserId ? data.toUserId : data.fromUserId,
      details: { partId: data.partId, removedBy: me.id === data.fromUserId ? 'sharer' : 'recipient' },
    })
    return { ok: true }
  })

export type { PartShareRow }
