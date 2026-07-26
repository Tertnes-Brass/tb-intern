import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  auditLog,
  invitations,
  memberProfiles,
  parts,
  roles,
  sectionLeaders,
  session,
  user,
  userParts,
} from '../db/schema'
import { memberNameSchema, normalizePhone, phoneSchema } from '../lib/profile'
import { canManageMemberParts, hasPermission, requireMe, requirePermission } from './access'
import { auditInsert } from './audit'
import { getAuth } from './auth-instance'
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

  const byId = new Map<
    string,
    {
      id: string
      name: string
      email: string
      phone: string | null
      roleId: string
      roleName: string
      isActive: boolean
      parts: Array<{ id: string; name: string; sort: number; isPrimary: boolean }>
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
        roleId: r.roleId,
        roleName: r.roleName,
        isActive: r.isActive,
        parts: [],
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
  const membersOut = members.map((m) => {
    const memberPartIds = m.parts.map((p) => p.id)
    return {
      ...m,
      // Telefonnummer er medlemsdata for administrasjon, ikke katalogdata.
      phone: canManage ? m.phone : null,
      // Global ⇒ alle; seksjonsleder ⇒ kun medlemmer helt innenfor eget omfang.
      canEditParts: canManage || (canManageSection && leaderCanAssign(me.leadsPartIds, memberPartIds, memberPartIds)),
      leaderPartIds: leadersByUser.get(m.id) ?? [],
    }
  })

  const pendingInvites = canManage
    ? await d
        .select({
          email: invitations.email,
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
        roleName: i.roleName,
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

export const updateMemberProfile = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string(), name: memberNameSchema, phone: phoneSchema }))
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    const phone = normalizePhone(data.phone)
    const d = db()
    const current = await d
      .select({ name: user.name, phone: memberProfiles.phone })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .where(eq(memberProfiles.authUserId, data.userId))
      .limit(1)
    if (!current[0]) throw new Error('Fant ikke medlemmet')
    const changedFields = [
      ...(current[0].name === data.name ? [] : ['name']),
      ...((current[0].phone ?? null) === phone ? [] : ['phone']),
    ]
    if (changedFields.length === 0) return { ok: true }
    await d.batch([
      d.update(user).set({ name: data.name }).where(eq(user.id, data.userId)),
      d.update(memberProfiles).set({ phone }).where(eq(memberProfiles.authUserId, data.userId)),
      auditInsert(d, {
        action: 'member.profile_updated_by_admin',
        actorUserId: me.id,
        targetUserId: data.userId,
        details: { changedFields },
      }),
    ])
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
  .validator(
    z.object({
      email: z.string().email('Ugyldig e-post'),
      name: z.string().optional(),
      roleId: z.string(),
      partIds: z.array(z.string()).max(4).default([]),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission('members.manage')
    await assertValidRoleAndParts(data.roleId, data.partIds)
    const email = data.email.trim().toLowerCase()
    const name = data.name?.trim() || null
    const d = db()
    const upsert = d
      .insert(invitations)
      .values({
        email,
        name,
        roleId: data.roleId,
        partIds: JSON.stringify(data.partIds),
        invitedBy: me.id,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: invitations.email,
        set: { name, roleId: data.roleId, partIds: JSON.stringify(data.partIds), acceptedAt: null },
      })
    await d.batch([
      upsert,
      auditInsert(d, {
        action: 'member.invited',
        actorUserId: me.id,
        details: { targetEmail: email, roleId: data.roleId, partIds: data.partIds },
      }),
    ])

    // Prøv å sende innloggingslenke (magisk lenke). Feiler stille hvis e-post
    // ikke er aktivert ennå — invitasjonen står uansett, og medlemmet kan logge
    // inn selv på noter.tertnesbrass.com med e-posten sin.
    let emailSent = false
    try {
      await getAuth().api.signInMagicLink({
        body: { email, callbackURL: '/' },
        headers: getRequest().headers,
      })
      emailSent = true
    } catch {
      emailSent = false
    }
    return { ok: true, emailSent }
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
