import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { memberInstruments, memberProfiles, parts, user, userParts } from '../db/schema'
import {
  cleanSecondaryParts,
  interestsNoteSchema,
  interestsSchema,
  normalizeNote,
  otherInstrumentsSchema,
  parseInterests,
  secondaryPartsSchema,
  serializeInterests,
} from '../lib/member-profile'
import { memberNameSchema, normalizePhone, phoneSchema } from '../lib/profile'
import { type AuditAction, auditInsert } from './audit'

/**
 * Skrivelaget for den utvidede medlemsprofilen (#14 + #25). Delt av
 * selvbetjeningen på `/min-profil` og medlemsansvarliges redigering i
 * `/medlemmer`, slik at de to aldri kan komme i utakt om hva som lagres,
 * hva som normaliseres og hva som havner i revisjonsloggen.
 *
 * Modulen har LEVENDE eksport (den rører `db()` og dermed `cloudflare:workers`)
 * og skal derfor aldri importeres fra en rutekomponent — bare fra
 * `src/server/profile.ts` og `src/server/members.ts`, som eksporterer
 * serverfunksjoner. Samme regel som `post-images.ts`.
 *
 * TILGANGSKONTROLLEN LIGGER IKKE HER. Kallstedet har allerede avgjort hvem som
 * får skrive til hvem (`requireMe()` for egen profil, `requirePermission('members.manage')`
 * for andres); denne funksjonen skriver til den `targetUserId` den får.
 */

export const memberDetailsSchema = z.object({
  phone: phoneSchema,
  interests: interestsSchema,
  interestsNote: interestsNoteSchema,
  otherInstruments: otherInstrumentsSchema,
  secondaryPartIds: secondaryPartsSchema,
})

export type MemberDetailsInput = z.infer<typeof memberDetailsSchema>

/** Navnet er admin-feltet: medlemmet endrer sitt eget navn via better-auth. */
export const adminMemberDetailsSchema = memberDetailsSchema.extend({
  userId: z.string(),
  name: memberNameSchema,
})

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

/**
 * Lagrer profilfeltene og bistemmene i én batch sammen med ÉN revisjonsrad.
 * Returnerer feltene som faktisk endret seg — er lista tom, ble ingenting
 * skrevet og ingenting logget. `name` settes bare når det er oppgitt (admin).
 */
export async function saveMemberDetails(opts: {
  targetUserId: string
  actorUserId: string
  action: AuditAction
  input: MemberDetailsInput & { name?: string }
}): Promise<{ changedFields: string[] }> {
  const { targetUserId, actorUserId, action, input } = opts
  const d = db()

  const [profileRows, nameRows, assignedRows, currentSecondaryRows] = await Promise.all([
    d
      .select({
        phone: memberProfiles.phone,
        interests: memberProfiles.interests,
        interestsNote: memberProfiles.interestsNote,
        otherInstruments: memberProfiles.otherInstruments,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, targetUserId))
      .limit(1),
    d.select({ name: user.name }).from(user).where(eq(user.id, targetUserId)).limit(1),
    // Tildelte stemmer leses FERSKT fra databasen, ikke fra en cachet `Me`:
    // en bistemme som er blitt hovedstemme siden sida ble lastet, skal falle bort.
    d.select({ partId: userParts.partId }).from(userParts).where(eq(userParts.userId, targetUserId)),
    d
      .select({ partId: memberInstruments.partId })
      .from(memberInstruments)
      .where(eq(memberInstruments.userId, targetUserId)),
  ])

  const current = profileRows[0]
  if (!current) throw new Error('Fant ikke medlemsprofilen')

  const phone = normalizePhone(input.phone)
  const interests = serializeInterests(input.interests)
  const interestsNote = normalizeNote(input.interestsNote)
  const otherInstruments = normalizeNote(input.otherInstruments)
  const secondaryPartIds = cleanSecondaryParts(
    input.secondaryPartIds,
    assignedRows.map((row) => row.partId),
  )

  // Stemme-id-er kommer fra klienten og har ingen FK i payloaden — sjekk at de
  // finnes før de skrives, slik `assertValidRoleAndParts` gjør for tildelinger.
  if (secondaryPartIds.length > 0) {
    const found = await d.select({ id: parts.id }).from(parts).where(inArray(parts.id, secondaryPartIds))
    if (found.length !== secondaryPartIds.length) throw new Error('Ukjent stemme')
  }

  const currentSecondary = currentSecondaryRows.map((row) => row.partId)
  const changedFields = [
    ...(input.name !== undefined && nameRows[0] && nameRows[0].name !== input.name ? ['name'] : []),
    ...((current.phone ?? null) === phone ? [] : ['phone']),
    // Sammenlign NORMALISERT mot normalisert: en kolonne som fortsatt står med
    // gammel rekkefølge skal ikke telle som en endring hver gang man lagrer.
    ...(serializeInterests(parseInterests(current.interests)) === interests ? [] : ['interests']),
    ...((current.interestsNote ?? null) === interestsNote ? [] : ['interestsNote']),
    ...((current.otherInstruments ?? null) === otherInstruments ? [] : ['otherInstruments']),
    ...(sameSet(currentSecondary, secondaryPartIds) ? [] : ['secondaryParts']),
  ]
  if (changedFields.length === 0) return { changedFields }

  const statements = [
    ...(input.name !== undefined
      ? [d.update(user).set({ name: input.name }).where(eq(user.id, targetUserId))]
      : []),
    d
      .update(memberProfiles)
      .set({ phone, interests, interestsNote, otherInstruments })
      .where(eq(memberProfiles.authUserId, targetUserId)),
    // Full overskriving av bistemmene: lista på skjermen ER settet.
    d.delete(memberInstruments).where(eq(memberInstruments.userId, targetUserId)),
    ...(secondaryPartIds.length > 0
      ? [d.insert(memberInstruments).values(secondaryPartIds.map((partId) => ({ userId: targetUserId, partId })))]
      : []),
    auditInsert(d, {
      action,
      actorUserId,
      targetUserId,
      // Kun feltnavn — verdiene er personopplysninger og hører ikke i loggen.
      details: { changedFields },
    }),
  ]
  await d.batch(statements as [(typeof statements)[number], ...typeof statements])

  return { changedFields }
}

/**
 * Leser de utvidede feltene for én bruker. Brukes av `/min-profil`; medlemslista
 * henter de samme feltene for alle i én spørring i `listMembers`.
 */
export async function readMemberDetails(userId: string) {
  const d = db()
  const [profileRows, secondaryRows] = await Promise.all([
    d
      .select({
        phone: memberProfiles.phone,
        interests: memberProfiles.interests,
        interestsNote: memberProfiles.interestsNote,
        otherInstruments: memberProfiles.otherInstruments,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, userId))
      .limit(1),
    d
      .select({ id: parts.id, name: parts.nameNo, sortOrder: parts.sortOrder })
      .from(memberInstruments)
      .innerJoin(parts, eq(memberInstruments.partId, parts.id))
      .where(eq(memberInstruments.userId, userId)),
  ])

  return {
    phone: profileRows[0]?.phone ?? null,
    interests: parseInterests(profileRows[0]?.interests),
    interestsNote: profileRows[0]?.interestsNote ?? null,
    otherInstruments: profileRows[0]?.otherInstruments ?? null,
    secondaryParts: secondaryRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => ({ id: row.id, name: row.name })),
  }
}
