import { eq } from 'drizzle-orm'
import { redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { db } from '../db'
import { memberProfiles, parts, rolePermissions, roles, sectionLeaders, userParts } from '../db/schema'
import { getAuth } from './auth-instance'
import type { AccessCtx } from './file-access'
import { buildChildrenMap, expandPartIds, leaderCanAssign } from './parts-tree'

export type Me = {
  id: string
  name: string
  email: string
  roleId: string
  roleName: string
  permissions: string[]
  parts: Array<{ id: string; nameNo: string; nameEn: string; section: string }>
  // Tildelte stemmer ekspandert nedover treet (forelder ⇒ alle barn). Brukes
  // til tilgang/«mine noter». Lik parts.map(id) så lenge treet er flatt.
  effectivePartIds: string[]
  // Stemmer denne brukeren er seksjonsleder for, ekspandert nedover. Tomt for
  // de fleste. Scope for `members.manage.section`.
  leadsPartIds: string[]
  // Kun konkrete løvstemmer i det ekspanderte lederomfanget. Brukes til
  // notetilgang; forelder-rader er grupper og gir ikke en egen notefiltilgang.
  leadsLeafPartIds: string[]
}

export async function currentUser(): Promise<Me | null> {
  const { headers } = getRequest()
  const session = await getAuth().api.getSession({ headers })
  if (!session?.user) return null

  const authUserId = session.user.id
  const d = db()

  const rows = await d
    .select({
      roleId: memberProfiles.roleId,
      roleName: roles.name,
      isActive: memberProfiles.isActive,
    })
    .from(memberProfiles)
    .innerJoin(roles, eq(memberProfiles.roleId, roles.id))
    .where(eq(memberProfiles.authUserId, authUserId))
    .limit(1)

  const profile = rows[0]
  if (!profile || !profile.isActive) return null

  const [perms, myParts, allPartRows, leaderRows] = await Promise.all([
    d
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, profile.roleId)),
    d
      .select({ id: parts.id, nameNo: parts.nameNo, nameEn: parts.nameEn, section: parts.section })
      .from(userParts)
      .innerJoin(parts, eq(userParts.partId, parts.id))
      .where(eq(userParts.userId, authUserId)),
    d.select({ id: parts.id, parentId: parts.parentId }).from(parts),
    d.select({ partId: sectionLeaders.partId }).from(sectionLeaders).where(eq(sectionLeaders.userId, authUserId)),
  ])

  const childrenMap = buildChildrenMap(allPartRows)
  const leadsPartIds = expandPartIds(leaderRows.map((r) => r.partId), childrenMap)

  return {
    id: authUserId,
    name: session.user.name,
    email: session.user.email,
    roleId: profile.roleId,
    roleName: profile.roleName,
    permissions: perms.map((p) => p.permission),
    parts: myParts,
    effectivePartIds: expandPartIds(myParts.map((p) => p.id), childrenMap),
    leadsPartIds,
    leadsLeafPartIds: leadsPartIds.filter((id) => !childrenMap.has(id)),
  }
}

export function hasPermission(me: Me | null, permission: string): boolean {
  if (!me) return false
  return me.permissions.includes('*') || me.permissions.includes(permission)
}

/** Fullt arkivinnsyn, uavhengig av om det kommer fra lesing eller forvaltning. */
export function hasFullArchiveAccess(me: Me | null): boolean {
  return hasPermission(me, 'archive.viewAll') || hasPermission(me, 'works.manage')
}

/**
 * Bygger den felles konteksten for filmetadata og filstrømming. Lederomfanget
 * holdes separat fra egne stemmer slik at en foreldet section_leaders-rad aldri
 * virker uten den faktiske rettigheten.
 */
export function memberFileAccessContext(me: Me, inAccessibleProject: boolean): AccessCtx {
  return {
    effectivePartIds: me.effectivePartIds,
    sectionLeaderPartIds: me.leadsLeafPartIds,
    canManageSection: hasPermission(me, 'members.manage.section'),
    canViewScore: hasPermission(me, 'scores.view'),
    canViewAll: hasFullArchiveAccess(me),
    inAccessibleProject,
  }
}

/**
 * Kan `me` endre stemmene til `targetUserId` til `requestedPartIds`?
 * Global `members.manage` ⇒ ja. Ellers må `me` ha `members.manage.section` og
 * være seksjonsleder med omfang som dekker BÅDE målets nåværende og innsendte
 * stemmer (se `leaderCanAssign`). Leser målets nåværende stemmer ferskt fra DB
 * (ikke fra cachet `Me`) for å unngå TOCTOU.
 */
export async function canManageMemberParts(
  me: Me,
  targetUserId: string,
  requestedPartIds: string[],
): Promise<boolean> {
  if (hasPermission(me, 'members.manage')) return true
  if (!hasPermission(me, 'members.manage.section')) return false
  const current = await db()
    .select({ partId: userParts.partId })
    .from(userParts)
    .where(eq(userParts.userId, targetUserId))
  return leaderCanAssign(me.leadsPartIds, current.map((c) => c.partId), requestedPartIds)
}

/** Krever innlogget bruker — ellers redirect til /login. */
export async function requireMe(): Promise<Me> {
  const me = await currentUser()
  if (!me) throw redirect({ to: '/login' })
  return me
}

/** Krever en spesifikk rettighet — ellers feil (vises som melding i UI). */
export async function requirePermission(permission: string): Promise<Me> {
  const me = await requireMe()
  if (!hasPermission(me, permission)) {
    throw new Error(`Du mangler tilgangen «${permission}»`)
  }
  return me
}
