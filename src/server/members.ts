import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  auditLog,
  invitations,
  memberInstruments,
  memberProfiles,
  parts,
  roles,
  sectionLeaders,
  session,
  user,
  userParts,
} from '../db/schema'
import { type InviteDelivery, invitePayloadSchema, orderPartsWithPrimary } from '../lib/invitation'
import { type InterestKey, parseInterests, redactContact } from '../lib/member-profile'
import { canManageMemberParts, hasPermission, requireMe, requirePermission } from './access'
import { auditInsert } from './audit'
import { adminMemberDetailsSchema, saveMemberDetails } from './member-details'
import { getAuth } from './auth-instance'
import { takeEmailOutcome } from './email'
import { leaderCanAssign } from './parts-tree'

/** Sjekker at rolle + stemmer faktisk finnes (partIds lagres uten FK i JSON). */
async function assertValidRoleAndParts(roleId: string, partIds: string[]): Promise<void> {
  const d = db()
  const role = await d.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!role[0]) throw new Error('Ukjent rolle')
  if (partIds.length > 0) {
    const found = await d.select({ id: parts.id }).from(parts).where(inArray(parts.id, partIds))
    if (found.length !== new Set(partIds).size) throw new Error('Ukjent stemme')
  }
}

export const listMembers = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()

  const rows = await d
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: memberProfiles.phone,
      interests: memberProfiles.interests,
      interestsNote: memberProfiles.interestsNote,
      otherInstruments: memberProfiles.otherInstruments,
      roleId: memberProfiles.roleId,
      roleName: roles.name,
      isActive: memberProfiles.isActive,
      partId: parts.id,
      partName: parts.nameNo,
      partSort: parts.sortOrder,
      partPrimary: userParts.isPrimary,
    })
    .from(memberProfiles)
    .innerJoin(user, eq(memberProfiles.authUserId, user.id))
    .innerJoin(roles, eq(memberProfiles.roleId, roles.id))
    .leftJoin(userParts, eq(userParts.userId, user.id))
    .leftJoin(parts, eq(userParts.partId, parts.id))

  // Bistemmer (#25) hentes i en egen spørring: en ekstra leftJoin ved siden av
  // `user_parts` ville gitt et kryssprodukt av tildelte stemmer og bistemmer.
  const secondaryRows = await d
    .select({ userId: memberInstruments.userId, partId: parts.id, name: parts.nameNo, sort: parts.sortOrder })
    .from(memberInstruments)
    .innerJoin(parts, eq(memberInstruments.partId, parts.id))
  const secondaryByUser = new Map<string, Array<{ id: string; name: string; sort: number }>>()
  for (const row of secondaryRows) {
    const list = secondaryByUser.get(row.userId) ?? []
    list.push({ id: row.partId, name: row.name, sort: row.sort })
    secondaryByUser.set(row.userId, list)
  }

  const byId = new Map<
    string,
    {
      id: string
      name: string
      email: string
      phone: string | null
      interests: InterestKey[]
      interestsNote: string | null
      otherInstruments: string | null
      roleId: string
      roleName: string
      isActive: boolean
      parts: Array<{ id: string; name: string; sort: number; isPrimary: boolean }>
      secondaryParts: Array<{ id: string; name: string; sort: number }>
    }
  >()
  for (const r of rows) {
    const m =
      byId.get(r.id) ??
      {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        interests: parseInterests(r.interests),
        interestsNote: r.interestsNote,
        otherInstruments: r.otherInstruments,
        roleId: r.roleId,
        roleName: r.roleName,
        isActive: r.isActive,
        parts: [],
        secondaryParts: (secondaryByUser.get(r.id) ?? []).sort((a, b) => a.sort - b.sort),
      }
    if (r.partId && r.partName) {
      m.parts.push({ id: r.partId, name: r.partName, sort: r.partSort ?? 999, isPrimary: r.partPrimary ?? false })
    }
    byId.set(r.id, m)
  }

  for (const member of byId.values()) {
    member.parts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sort - b.sort)
  }

  const members = [...byId.values()].sort((a, b) => {
    const sa = a.parts[0]?.sort ?? 998
    const sb = b.parts[0]?.sort ?? 998
    return sa - sb || a.name.localeCompare(b.name, 'nb')
  })

  const allParts = await d.select().from(parts).orderBy(asc(parts.sortOrder))
  const allRoles = await d.select().from(roles)
  const canManage = hasPermission(me, 'members.manage')
  const canManageSection = hasPermission(me, 'members.manage.section')

  // Seksjonsleder-bindinger (for «hvem kan jeg redigere» + admin-UI).
  const leaderRows = await d.select().from(sectionLeaders)
  const leadersByUser = new Map<string, string[]>()
  for (const lr of leaderRows) {
    const list = leadersByUser.get(lr.userId) ?? []
    list.push(lr.partId)
    leadersByUser.set(lr.userId, list)
  }
  const viewer = { canManageMembers: canManage, viewerId: me.id }
  const membersOut = members.map((m) => {
    const memberPartIds = m.parts.map((p) => p.id)
    return {
      // Innsyn (#14): medlemslista er intern, og poenget er å få tak i folk ved
      // fravær — kontaktinfo er derfor synlig for alle innloggede (og dermed
      // aktive) medlemmer. Dette er en bevisst omgjøring av den gamle regelen
      // «telefon er kun for administratorer». Deaktiverte medlemmers kontaktinfo
      // fjernes SERVER-side her, så den aldri følger med i payloaden.
      ...redactContact(viewer, m),
      // Global ⇒ alle; seksjonsleder ⇒ kun medlemmer helt innenfor eget omfang.
      canEditParts: canManage || (canManageSection && leaderCanAssign(me.leadsPartIds, memberPartIds, memberPartIds)),
      leaderPartIds: leadersByUser.get(m.id) ?? [],
    }
  })

  const pendingInvites = canManage
    ? await d
        .select({
          email: invitations.email,
          name: invitations.name,
          roleId: invitations.roleId,
          roleName: roles.name,
          partIds: invitations.partIds,
          createdAt: invitations.createdAt,
          acceptedAt: invitations.acceptedAt,
        })
        .from(invitations)
        .innerJoin(roles, eq(invitations.roleId, roles.id))
        .orderBy(desc(invitations.createdAt))
    : []

  return {
    members: membersOut,
    allParts,
    allRoles,
    canManage,
    canManageSection,
    // null = full tilgang (alle stemmer); ellers begrenset til ledelsesomfanget.
    assignablePartIds: canManage ? null : me.leadsPartIds,
    meId: me.id,
    invites: pendingInvites
      .filter((i) => !i.acceptedAt)
      .map((i) => ({
        email: i.email,
        name: i.name,
        roleName: i.roleName,
        // Første stemme er hovedstemmen (samme konvensjon som `user_parts`).
        partNames: (JSON.parse(i.partIds) as string[])
          .map((id) => allParts.find((p) => p.id === id)?.nameNo ?? id),
        createdAt: i.createdAt.getTime(),
      })),
  }
})

export const updateMemberParts = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string(), partIds: z.array(z.string()).max(4) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    // Hard tilgang: stemme = tilgang, derfor INGEN self-service. Bare global
    // members.manage eller seksjonsleder (innenfor eget omfang) kan tildele.
    if (!(await canManageMemberParts(me, data.userId, data.partIds))) {
      throw new Error('Du har ikke tilgang til å endre stemmer for dette medlemmet')
    }
    const d = db()
    await assertValidRoleAndParts(me.roleId, data.partIds) // gjenbruk: validerer partIds
    const current = await d.select({ partId: userParts.partId }).from(userParts).where(eq(userParts.userId, data.userId))
    const currentPartIds = current.map((row) => row.partId)
    if (
      currentPartIds.length === data.partIds.length &&
      currentPartIds.every((partId) => data.partIds.includes(partId))
    ) {
      return { ok: true }
    }
    const remove = d.delete(userParts).where(eq(userParts.userId, data.userId))
    const audit = auditInsert(d, {
      action: 'member.parts_changed',
      actorUserId: me.id,
      targetUserId: data.userId,
      details: { fromPartIds: currentPartIds, toPartIds: data.partIds },
    })
    if (data.partIds.length > 0) {
      await d.batch([
        remove,
        d
          .insert(userParts)
          .values(data.partIds.map((partId, i) => ({ userId: data.userId, partId, isPrimary: i === 0 }))),
        audit,
      ])
    } else {
      await d.batch([remove, audit])
    }
    return { ok: true }
  })

/**
 * Setter hvilke stemmer/seksjoner en bruker er seksjonsleder for (full
 * overskriving). KRITISK: gated på GLOBAL `members.manage` — ALDRI
 * `members.manage.section`, ellers kunne en leder utvidet sitt eget omfang.
 */
export const setSectionLeaderParts = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string(), partIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    const d = db()
    if (data.partIds.length > 0) {
      const found = await d.select({ id: parts.id }).from(parts).where(inArray(parts.id, data.partIds))
      if (found.length !== new Set(data.partIds).size) throw new Error('Ukjent stemme')
    }
    const current = await d
      .select({ partId: sectionLeaders.partId })
      .from(sectionLeaders)
      .where(eq(sectionLeaders.userId, data.userId))
    const currentPartIds = current.map((row) => row.partId)
    if (
      currentPartIds.length === data.partIds.length &&
      currentPartIds.every((partId) => data.partIds.includes(partId))
    ) {
      return { ok: true }
    }
    const remove = d.delete(sectionLeaders).where(eq(sectionLeaders.userId, data.userId))
    const revokeSessions = d.delete(session).where(eq(session.userId, data.userId))
    const audit = auditInsert(d, {
      action: 'member.section_leadership_changed',
      actorUserId: me.id,
      targetUserId: data.userId,
      details: { fromPartIds: currentPartIds, toPartIds: data.partIds },
    })
    if (data.partIds.length > 0) {
      await d.batch([
        remove,
        d.insert(sectionLeaders).values(data.partIds.map((partId) => ({ userId: data.userId, partId }))),
        revokeSessions,
        audit,
      ])
    } else {
      await d.batch([remove, revokeSessions, audit])
    }
    return { ok: true }
  })

export const updateMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string(), roleId: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    if (data.userId === me.id) throw new Error('Du kan ikke endre din egen rolle')
    await assertValidRoleAndParts(data.roleId, [])
    const d = db()
    const current = await d
      .select({ roleId: memberProfiles.roleId })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, data.userId))
      .limit(1)
    if (!current[0]) throw new Error('Fant ikke medlemmet')
    if (current[0].roleId === data.roleId) return { ok: true }
    await d.batch([
      d.update(memberProfiles).set({ roleId: data.roleId }).where(eq(memberProfiles.authUserId, data.userId)),
      d.delete(session).where(eq(session.userId, data.userId)),
      auditInsert(d, {
        action: 'member.role_changed',
        actorUserId: me.id,
        targetUserId: data.userId,
        details: { fromRoleId: current[0].roleId, toRoleId: data.roleId },
      }),
    ])
    return { ok: true }
  })

/**
 * Medlemsansvarliges redigering av en annens profil (#25): samme felt som
 * medlemmet selv har på `/min-profil`, pluss navnet. Skrivelaget er delt med
 * selvbetjeningen (`saveMemberDetails`), så de to kan ikke komme i utakt om
 * normalisering og logging — det er bare gaten og revisjonshandlingen som skiller.
 *
 * `members.manage.section` gir IKKE tilgang hit: en seksjonsleder kan tildele
 * stemmer i egen seksjon (`updateMemberParts`), men skal ikke redigere andres
 * kontaktopplysninger.
 */
export const updateMemberProfile = createServerFn({ method: 'POST' })
  .validator(adminMemberDetailsSchema)
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    const { userId, ...input } = data
    await saveMemberDetails({
      targetUserId: userId,
      actorUserId: me.id,
      action: 'member.profile_updated_by_admin',
      input,
    })
    return { ok: true }
  })

export const sendMemberPasswordReset = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    const d = db()
    const target = await d
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, data.userId))
      .limit(1)
    if (!target[0]) throw new Error('Fant ikke medlemmet')

    const recent = await d
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'member.password_reset_requested_by_admin'),
          eq(auditLog.targetUserId, data.userId),
          gte(auditLog.createdAt, new Date(Date.now() - 60_000)),
        ),
      )
      .limit(1)
    if (recent[0]) return { ok: true, throttled: true }

    await getAuth().api.requestPasswordReset({
      body: { email: target[0].email, redirectTo: '/tilbakestill-passord' },
      headers: getRequest().headers,
    })
    await auditInsert(d, {
      action: 'member.password_reset_requested_by_admin',
      actorUserId: me.id,
      targetUserId: data.userId,
      details: { delivery: 'registered-email' },
    })
    return { ok: true, throttled: false }
  })

export const inviteMember = createServerFn({ method: 'POST' })
  .validator(invitePayloadSchema)
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    await assertValidRoleAndParts(data.roleId, data.partIds)
    // E-posten er normalisert av skjemaet (trim + små bokstaver).
    const email = data.email
    const name = data.name ?? null
    // Hovedstemmen lagres som første element — databasehooken som oppretter
    // kontoen setter `isPrimary: i === 0` på samme måte som `updateMemberParts`.
    const partIds = orderPartsWithPrimary(data.partIds, data.primaryPartId)
    const d = db()

    // En eksisterende konto plukker aldri opp invitasjonen igjen (create-hooken
    // kjører bare én gang), så en «invitasjon» ville sett ut som den virket uten
    // å endre rolle eller stemmer. Si det i stedet.
    const existing = await d.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    if (existing[0]) {
      throw new Error('Adressen har allerede en konto — endre rolle og stemmer i medlemslista i stedet')
    }

    const upsert = d
      .insert(invitations)
      .values({
        email,
        name,
        roleId: data.roleId,
        partIds: JSON.stringify(partIds),
        invitedBy: me.id,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: invitations.email,
        set: { name, roleId: data.roleId, partIds: JSON.stringify(partIds), acceptedAt: null },
      })
    await d.batch([
      upsert,
      auditInsert(d, {
        action: 'member.invited',
        actorUserId: me.id,
        details: { targetEmail: email, roleId: data.roleId, partIds, emailRequested: data.sendEmail },
      }),
    ])

    // E-post er et eksplisitt valg. Invitasjonen står uansett, og medlemmet kan
    // logge inn selv på intern.tertnesbrass.com med e-posten sin.
    let delivery: InviteDelivery = 'skipped'
    if (data.sendEmail) {
      try {
        await getAuth().api.signInMagicLink({
          body: { email, callbackURL: '/' },
          headers: getRequest().headers,
        })
        // `sendEmail` degraderer til konsoll-logg uten å kaste, så et vellykket
        // API-kall beviser INGENTING. Hent det faktiske utfallet i stedet.
        delivery = takeEmailOutcome(email) ?? 'failed'
      } catch {
        delivery = 'failed'
      }
    }
    return { ok: true, delivery }
  })

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    const email = data.email.trim().toLowerCase()
    const d = db()
    await d.batch([
      d.delete(invitations).where(eq(invitations.email, email)),
      auditInsert(d, {
        action: 'member.invitation_revoked',
        actorUserId: me.id,
        details: { targetEmail: email },
      }),
    ])
    return { ok: true }
  })
