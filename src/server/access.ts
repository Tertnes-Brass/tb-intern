import { asc, eq, inArray } from 'drizzle-orm'
import { redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { db } from '../db'
import { memberProfiles, memberRoles, parts, rolePermissions, roles, sectionLeaders, userParts } from '../db/schema'
import { effectiveRoleIds, orderRoles, unionRolePermissions } from '../lib/roles'
import { getAuth } from './auth-instance'
import type { AccessCtx } from './file-access'
import { buildChildrenMap, expandPartIds, leaderCanAssign } from './parts-tree'

export type Me = {
  id: string
  name: string
  email: string
  /**
   * Alle rollene medlemmet har (#48), i rollelistas rekkefølge. Et medlem kan
   * være «Musiker» og «Styremedlem» samtidig, og `permissions` er UNIONEN av
   * rettighetene til dem alle — ingen rolle trekker fra.
   */
  roles: Array<{ id: string; name: string }>
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

  // Alt som ikke avhenger av HVILKE roller brukeren har, hentes i én runde.
  // Rollene måtte ellers vært slått opp før rettighetene, og `currentUser()`
  // kjører på hver eneste forespørsel — én rundtur ekstra her koster overalt.
  const [rows, linkedRoles, allRoles, myParts, allPartRows, leaderRows] = await Promise.all([
    d
      .select({
        // DEPRECATED-kolonnen, kun som fallback for et medlem uten koblingsrader
        // (se `effectiveRoleIds`). Rollen leses fra `member_roles`.
        legacyRoleId: memberProfiles.roleId,
        isActive: memberProfiles.isActive,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, authUserId))
      .limit(1),
    d.select({ roleId: memberRoles.roleId }).from(memberRoles).where(eq(memberRoles.authUserId, authUserId)),
    d.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)),
    d
      .select({ id: parts.id, nameNo: parts.nameNo, nameEn: parts.nameEn, section: parts.section })
      .from(userParts)
      .innerJoin(parts, eq(userParts.partId, parts.id))
      .where(eq(userParts.userId, authUserId)),
    d.select({ id: parts.id, parentId: parts.parentId }).from(parts),
    d.select({ partId: sectionLeaders.partId }).from(sectionLeaders).where(eq(sectionLeaders.userId, authUserId)),
  ])

  const profile = rows[0]
  if (!profile || !profile.isActive) return null

  const myRoleIds = effectiveRoleIds(linkedRoles.map((r) => r.roleId), profile.legacyRoleId)
  const permRows =
    myRoleIds.length > 0
      ? await d
          .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, myRoleIds))
      : []

  const childrenMap = buildChildrenMap(allPartRows)
  const leadsPartIds = expandPartIds(leaderRows.map((r) => r.partId), childrenMap)

  const permissionsByRole = new Map<string, string[]>()
  for (const row of permRows) {
    const list = permissionsByRole.get(row.roleId) ?? []
    list.push(row.permission)
    permissionsByRole.set(row.roleId, list)
  }

  return {
    id: authUserId,
    name: session.user.name,
    email: session.user.email,
    roles: orderRoles(myRoleIds, allRoles),
    permissions: unionRolePermissions(myRoleIds, permissionsByRole),
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

/**
 * Rettighetene til ALLE medlemmer, som `userId → unionen av rollenes rettigheter`.
 *
 * Finnes fordi flere steder må vurdere andre enn den innloggede: hvem som kan
 * publisere en beskjed (`posts.ts`), hvem som hører til styret (`board.ts`),
 * hvem som kan omtales. Før #48 kunne hvert av dem slå opp én rolle-ID per
 * medlem og sjekke den mot et sett av «roller med rettigheten». Med flere roller
 * per medlem er det svaret feil for alle som har mer enn én rolle, og regelen
 * skal finnes ÉN gang — ikke gjenskapes med litt ulike join-er i tre moduler.
 *
 * Tre spørringer, uansett antall medlemmer. Bruk `permissionsInclude` fra
 * `src/lib/permissions.ts` til oppslaget, så `*` behandles likt overalt.
 */
export async function memberPermissionsByUser(): Promise<Map<string, string[]>> {
  const d = db()
  const [profileRows, linkRows, permRows] = await Promise.all([
    d
      .select({ authUserId: memberProfiles.authUserId, legacyRoleId: memberProfiles.roleId })
      .from(memberProfiles),
    d.select({ authUserId: memberRoles.authUserId, roleId: memberRoles.roleId }).from(memberRoles),
    d.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions),
  ])

  const permissionsByRole = new Map<string, string[]>()
  for (const row of permRows) {
    const list = permissionsByRole.get(row.roleId) ?? []
    list.push(row.permission)
    permissionsByRole.set(row.roleId, list)
  }
  const linkedByUser = new Map<string, string[]>()
  for (const row of linkRows) {
    const list = linkedByUser.get(row.authUserId) ?? []
    list.push(row.roleId)
    linkedByUser.set(row.authUserId, list)
  }

  return new Map(
    profileRows.map((profile) => [
      profile.authUserId,
      unionRolePermissions(
        effectiveRoleIds(linkedByUser.get(profile.authUserId) ?? [], profile.legacyRoleId),
        permissionsByRole,
      ),
    ]),
  )
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
