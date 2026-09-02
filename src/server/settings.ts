import { createServerFn } from '@tanstack/react-start'
import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { invitations, memberProfiles, parts, rolePermissions, roles, userParts, workFiles } from '../db/schema'
import { findRoleNameCollision, roleNameCollisionMessage } from '../lib/roles'
import { SECTION_ORDER } from '../lib/taxonomy'
import { requirePermission } from './access'
import { buildDisplayOrder, listSiblings, reorderAfter } from './parts-tree'

const SETTINGS_PERMISSION = 'settings.manage'

/** Kjente rettigheter med norske etiketter — vises i rolle-matrisen. */
export const PERMISSION_CATALOG: Array<{ key: string; label: string; hint: string }> = [
  { key: 'works.manage', label: 'Verk og filer', hint: 'Opprette, redigere og laste opp i arkivet' },
  { key: 'projects.manage', label: 'Prosjekter', hint: 'Lage prosjekter, sette repertoar, publisere' },
  { key: 'shares.manage', label: 'Vikarlenker', hint: 'Dele stemmer med vikarer' },
  { key: 'members.manage', label: 'Medlemmer', hint: 'Invitere og endre roller/stemmer' },
  { key: 'members.manage.section', label: 'Lede egen seksjon', hint: 'Tildele stemmer og se noter for egen seksjon' },
  { key: 'scores.view', label: 'Partitur', hint: 'Se og laste ned partitur' },
  { key: 'archive.viewAll', label: 'Se hele arkivet', hint: 'Se og laste ned ALLE stemmer, ikke bare egne' },
  { key: 'downloads.view', label: 'Filtilgangslogg', hint: 'Se hvem som har vist eller lastet ned filer' },
  { key: 'board.manage', label: 'Styrearbeid', hint: 'Se og redigere styrets oppgaver, møter og dokumenter' },
  { key: 'calendar.manage', label: 'Øvingsplan', hint: 'Sette verk, rekkefølge og prosjektkobling på en øvelse' },
  {
    key: 'attendance.manage',
    label: 'Fravær og oppmøte',
    hint: 'Se hele oppmøtelista og registrere fravær for et medlem',
  },
  { key: 'posts.publish', label: 'Beskjeder', hint: 'Skrive og publisere beskjeder til korpset' },
  {
    key: 'assets.manage',
    label: 'Utstyr',
    hint: 'Registrere og endre utstyr, bilder, eierskap og lån. Alle medlemmer kan se registeret',
  },
  { key: SETTINGS_PERMISSION, label: 'Innstillinger', hint: 'Administrere besetning og roller' },
]

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // kombinerende diakritiske tegn
      .replace(/[æ]/g, 'a')
      .replace(/ø/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'stemme'
  )
}

export const getSettingsData = createServerFn().handler(async () => {
  await requirePermission(SETTINGS_PERMISSION)
  const d = db()

  const [allParts, allRoles, perms, partFileCounts, partMemberCounts, roleMemberCounts, roleInviteCounts] =
    await Promise.all([
      d.select().from(parts).orderBy(asc(parts.sortOrder)),
      d.select().from(roles).orderBy(asc(roles.name)),
      d.select().from(rolePermissions),
      d
        .select({ partId: workFiles.partId, n: sql<number>`count(*)` })
        .from(workFiles)
        .groupBy(workFiles.partId),
      d.select({ partId: userParts.partId, n: sql<number>`count(*)` }).from(userParts).groupBy(userParts.partId),
      d
        .select({ roleId: memberProfiles.roleId, n: sql<number>`count(*)` })
        .from(memberProfiles)
        .groupBy(memberProfiles.roleId),
      d.select({ roleId: invitations.roleId, n: sql<number>`count(*)` }).from(invitations).groupBy(invitations.roleId),
    ])

  const fileCount = new Map(partFileCounts.map((r) => [r.partId, r.n]))
  const memberPartCount = new Map(partMemberCounts.map((r) => [r.partId, r.n]))
  const roleMembers = new Map(roleMemberCounts.map((r) => [r.roleId, r.n]))
  const roleInvites = new Map(roleInviteCounts.map((r) => [r.roleId, r.n]))
  const permsByRole = new Map<string, string[]>()
  for (const p of perms) {
    const list = permsByRole.get(p.roleId) ?? []
    list.push(p.permission)
    permsByRole.set(p.roleId, list)
  }

  const partById = new Map(allParts.map((part) => [part.id, part]))
  const displayParts = buildDisplayOrder(allParts).map((id) => partById.get(id)!)

  return {
    parts: displayParts.map((p) => ({
      id: p.id,
      sortOrder: p.sortOrder,
      nameNo: p.nameNo,
      nameEn: p.nameEn,
      section: p.section,
      parentId: p.parentId,
      aliases: JSON.parse(p.aliases) as string[],
      inUse: (fileCount.get(p.id) ?? 0) + (memberPartCount.get(p.id) ?? 0),
      fileCount: fileCount.get(p.id) ?? 0,
    })),
    roles: allRoles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      isAdmin: (permsByRole.get(r.id) ?? []).includes('*'),
      permissions: permsByRole.get(r.id) ?? [],
      memberCount: (roleMembers.get(r.id) ?? 0) + (roleInvites.get(r.id) ?? 0),
    })),
    permissionCatalog: PERMISSION_CATALOG,
    sections: SECTION_ORDER,
  }
})

// ---------- Besetning (parts) ----------

const partInput = z.object({
  nameNo: z.string().min(1, 'Norsk navn er påkrevd'),
  nameEn: z.string().min(1, 'Engelsk navn er påkrevd'),
  section: z.enum(SECTION_ORDER),
  aliases: z.array(z.string()).default([]),
  parentId: z.string().nullable().optional(),
})

/**
 * Håndhever stemme-tre-invariantene: maks to nivåer og ingen sykel.
 * Partitur kan ligge visuelt under Dirigent, men ekskluderes fortsatt fra
 * tilgangstreet i `parts-tree.ts`. `selfId` er null ved opprettelse.
 */
async function assertValidParent(
  parentId: string | null | undefined,
  selfId: string | null,
  section: string,
): Promise<void> {
  if (!parentId) return
  const isScoreUnderConductor = selfId === 'score' && parentId === 'conductor'
  if (section === 'score' && !isScoreUnderConductor) {
    throw new Error('Bare Partitur kan ligge under Dirigent')
  }
  if (parentId === 'conductor' && !isScoreUnderConductor) {
    throw new Error('Bare Partitur kan ligge under Dirigent')
  }
  if (parentId === 'score') throw new Error('Partitur kan ikke være forelder-stemme')
  if (selfId && parentId === selfId) throw new Error('En stemme kan ikke være sin egen forelder')
  const rows = await db().select({ id: parts.id, parentId: parts.parentId }).from(parts)
  const parent = rows.find((r) => r.id === parentId)
  if (!parent) throw new Error('Ukjent forelder-stemme')
  if (parent.parentId) throw new Error('Maks to nivåer: forelderen er allerede en understemme')
  if (selfId && rows.some((r) => r.parentId === selfId)) {
    throw new Error('Denne stemmen har egne understemmer og kan ikke flyttes under en annen')
  }
}

export const createPart = createServerFn({ method: 'POST' })
  .validator(partInput)
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    await assertValidParent(data.parentId, null, data.section)
    const d = db()
    // Unik slug fra engelsk navn
    let id = slugify(data.nameEn)
    const existing = new Set((await d.select({ id: parts.id }).from(parts)).map((p) => p.id))
    if (existing.has(id)) {
      let i = 2
      while (existing.has(`${id}-${i}`)) i++
      id = `${id}-${i}`
    }
    const maxRow = await d.select({ m: sql<number>`coalesce(max(sort_order), 0)` }).from(parts)
    await d.insert(parts).values({
      id,
      sortOrder: (maxRow[0]?.m ?? 0) + 10,
      nameNo: data.nameNo.trim(),
      nameEn: data.nameEn.trim(),
      section: data.section,
      parentId: data.parentId ?? null,
      aliases: JSON.stringify(data.aliases.map((a) => a.trim()).filter(Boolean)),
    })
    // Ny understemme skal legge seg rett under forelderen, ikke nederst i listen.
    if (data.parentId) {
      const rows = await partRows()
      await renumberParts(buildDisplayOrder(rows), rows)
    }
    return { id }
  })

export const updatePart = createServerFn({ method: 'POST' })
  .validator(partInput.extend({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    await assertValidParent(data.parentId, data.id, data.section)
    const d = db()
    const prev = (await d.select({ parentId: parts.parentId }).from(parts).where(eq(parts.id, data.id)).limit(1))[0]
    await d
      .update(parts)
      .set({
        nameNo: data.nameNo.trim(),
        nameEn: data.nameEn.trim(),
        section: data.section,
        parentId: data.parentId ?? null,
        aliases: JSON.stringify(data.aliases.map((a) => a.trim()).filter(Boolean)),
      })
      .where(eq(parts.id, data.id))
    // Ved re-parenting: renummerer så stemmen legger seg rett under (ny) forelder.
    if (prev && (data.parentId ?? null) !== prev.parentId) {
      const rows = await partRows()
      await renumberParts(buildDisplayOrder(rows), rows)
    }
    return { ok: true }
  })

export const deletePart = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const d = db()
    const files = await d
      .select({ n: sql<number>`count(*)` })
      .from(workFiles)
      .where(eq(workFiles.partId, data.id))
    if ((files[0]?.n ?? 0) > 0) {
      throw new Error(`Stemmen er i bruk på ${files[0]!.n} fil(er). Flytt eller slett dem først.`)
    }
    const children = await d
      .select({ n: sql<number>`count(*)` })
      .from(parts)
      .where(eq(parts.parentId, data.id))
    if ((children[0]?.n ?? 0) > 0) {
      throw new Error(`Stemmen har ${children[0]!.n} understemme(r). Flytt eller slett dem først.`)
    }
    // user_parts fjernes via cascade
    await d.delete(parts).where(eq(parts.id, data.id))
    return { ok: true }
  })

function partRows() {
  return db()
    .select({ id: parts.id, parentId: parts.parentId, sortOrder: parts.sortOrder })
    .from(parts)
    .orderBy(asc(parts.sortOrder))
}

/** Skriver ny rekkefølge som sortOrder = (posisjon + 1) * 10 — atomisk via batch. */
async function renumberParts(order: string[], rows: Array<{ id: string; sortOrder: number }>) {
  const d = db()
  const current = new Map(rows.map((r) => [r.id, r.sortOrder]))
  const updates = order
    .map((id, i) => ({ id, sortOrder: (i + 1) * 10 }))
    .filter((u) => current.get(u.id) !== u.sortOrder)
    .map((u) => d.update(parts).set({ sortOrder: u.sortOrder }).where(eq(parts.id, u.id)))
  if (updates.length > 0) await d.batch(updates as [(typeof updates)[number], ...typeof updates])
}

/** Ett hakk opp/ned blant søsknene — en rot hopper over hele naboblokken, barna følger med. */
export const movePart = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), direction: z.enum(['up', 'down']) }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const rows = await partRows()
    const peers = listSiblings(rows, data.id)
    const idx = peers.indexOf(data.id)
    const targetIdx = data.direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || targetIdx < 0 || targetIdx >= peers.length) return { ok: true }
    const afterId = data.direction === 'up' ? (peers[idx - 2] ?? null) : peers[idx + 1]!
    await renumberParts(reorderAfter(rows, data.id, afterId), rows)
    return { ok: true }
  })

export const movePartTo = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), afterId: z.string().nullable() }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const rows = await partRows()
    // reorderAfter kaster ved ugyldig mål (feil nivå / ukjent id)
    await renumberParts(reorderAfter(rows, data.id, data.afterId), rows)
    return { ok: true }
  })

// ---------- Roller og rettigheter ----------

export const setRolePermission = createServerFn({ method: 'POST' })
  .validator(z.object({ roleId: z.string(), permission: z.string(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    if (!PERMISSION_CATALOG.some((p) => p.key === data.permission)) throw new Error('Ukjent rettighet')
    const d = db()
    const role = (await d.select().from(roles).where(eq(roles.id, data.roleId)).limit(1))[0]
    if (!role) throw new Error('Ukjent rolle')
    // Admin-rollen («*») er alltid full tilgang og kan ikke finjusteres.
    const current = await d.select().from(rolePermissions).where(eq(rolePermissions.roleId, data.roleId))
    if (current.some((p) => p.permission === '*')) {
      throw new Error('Administrator har alltid full tilgang og kan ikke endres')
    }
    if (data.enabled) {
      await d.insert(rolePermissions).values({ roleId: data.roleId, permission: data.permission }).onConflictDoNothing()
    } else {
      await d
        .delete(rolePermissions)
        .where(sql`${rolePermissions.roleId} = ${data.roleId} and ${rolePermissions.permission} = ${data.permission}`)
    }
    return { ok: true }
  })

export const createRole = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().min(1, 'Navn er påkrevd') }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const d = db()
    const allRoles = await d.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
    // To roller med samme navn kan ikke skilles i rollematrisen — det var
    // nettopp det som skjedde med «Styremedlem» (#78). Navnet sammenlignes
    // normalisert, så «styremedlem » ikke slipper forbi «Styremedlem».
    const collision = findRoleNameCollision(data.name, allRoles)
    if (collision) throw new Error(roleNameCollisionMessage(collision))
    let id = slugify(data.name)
    const existing = new Set(allRoles.map((r) => r.id))
    if (existing.has(id)) {
      let i = 2
      while (existing.has(`${id}-${i}`)) i++
      id = `${id}-${i}`
    }
    await d.insert(roles).values({ id, name: data.name.trim(), isSystem: false })
    return { id }
  })

export const renameRole = createServerFn({ method: 'POST' })
  .validator(z.object({ roleId: z.string(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const d = db()
    // Samme vakt som ved opprettelse: en omdøping til et navn som allerede er i
    // bruk gir nøyaktig den duplikaten #78 handler om.
    const allRoles = await d.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
    const collision = findRoleNameCollision(data.name, allRoles, { excludeId: data.roleId })
    if (collision) throw new Error(roleNameCollisionMessage(collision))
    await d.update(roles).set({ name: data.name.trim() }).where(eq(roles.id, data.roleId))
    return { ok: true }
  })

export const deleteRole = createServerFn({ method: 'POST' })
  .validator(z.object({ roleId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(SETTINGS_PERMISSION)
    const d = db()
    const role = (await d.select().from(roles).where(eq(roles.id, data.roleId)).limit(1))[0]
    if (!role) return { ok: true }
    if (role.isSystem) throw new Error('Systemroller kan ikke slettes')
    const members = await d
      .select({ n: sql<number>`count(*)` })
      .from(memberProfiles)
      .where(eq(memberProfiles.roleId, data.roleId))
    const invites = await d
      .select({ n: sql<number>`count(*)` })
      .from(invitations)
      .where(eq(invitations.roleId, data.roleId))
    if ((members[0]?.n ?? 0) + (invites[0]?.n ?? 0) > 0) {
      throw new Error('Rollen er i bruk. Flytt medlemmer/invitasjoner til en annen rolle først.')
    }
    await d.delete(roles).where(eq(roles.id, data.roleId)) // role_permissions via cascade
    return { ok: true }
  })
