import { and, asc, eq, exists, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  eventAttendance,
  eventProjects,
  memberProfiles,
  parts,
  postTargets,
  posts,
  projectTimes,
  projects,
  user,
  userParts,
} from '../db/schema'
import { SECTION_LABELS, type SectionId } from '../lib/taxonomy'
import { type PostReader, type PostTarget, MAX_POST_TARGETS } from '../lib/posts'
import { permissionsInclude } from '../lib/permissions'
import { type Me, hasPermission, memberPermissionsByUser } from './access'

/**
 * Målgruppelaget for veggen (#28): hvem er hvem, når en beskjed er snevret inn
 * til én eller flere stemmegrupper eller til medlemmene i et prosjekt.
 *
 * Modulen er skilt fra `posts.ts` av samme grunn som `post-images.ts`: den har
 * LEVENDE eksporter (vanlige funksjoner, ikke serverfunksjoner), og de kalles
 * også fra bilderuta `/api/post-images/$imageId`. Lå de i `posts.ts`, ville
 * `cloudflare:workers` blitt dratt inn i klientbygget.
 *
 * Reglene selv bor i `src/lib/posts.ts` (`inPostAudience`, `matchesTargets`,
 * `canReadPost`) og er testet der. Her er bare oppslagene som fyller dem med
 * data — én sannhetskilde for hvor `sectionIds` og `projectIds` kommer fra.
 */

const PUBLISH_PERMISSION = 'posts.publish'

/**
 * Stemmegruppene et medlem hører til: seksjonen til hver TILDELTE stemme
 * (`user_parts`), aldri bistemmene i `member_instruments`.
 *
 * Skillet er ikke en detalj: `member_instruments` er kompetanse medlemmet
 * setter SELV («jeg kan spille trombone»), mens `user_parts` er tildelingen en
 * ansvarlig har gjort. Ble bistemmer regnet med, kunne hvem som helst skrevet
 * seg inn i slagverkets beskjeder ved å hake av for et instrument.
 */
async function sectionsByUser(userIds?: string[]): Promise<Map<string, string[]>> {
  const rows = await db()
    .select({ userId: userParts.userId, section: parts.section })
    .from(userParts)
    .innerJoin(parts, eq(userParts.partId, parts.id))
    .where(userIds ? inArray(userParts.userId, userIds) : undefined)
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const list = out.get(r.userId) ?? []
    if (!list.includes(r.section)) list.push(r.section)
    out.set(r.userId, list)
  }
  return out
}

/**
 * Hvem regnes som «medlemmene i et prosjekt»?
 *
 * **Det finnes ingen prosjektmedlemskap i datamodellen.** Et prosjekt har
 * repertoar, tidsplan og koblede øvinger — ikke en deltakerliste. Denne
 * funksjonen er derfor en AVLEDNING, og den er bevisst valgt slik:
 *
 * 1. Medlemmer som har svart at de kommer (eller er usikre) på minst én øving
 *    koblet til prosjektet (`event_projects` → `event_attendance`). Et avbud
 *    (`not_attending`) teller ikke — den som har meldt fra at hen ikke er med,
 *    er ikke i prosjektet.
 * 2. Medlemmer som står som ansvarlig for et punkt i prosjektets tidsplan
 *    (`project_times.responsible_user_id`). Sjåføren som henter slagverket er
 *    med i prosjektet selv om hen aldri svarte på en øving.
 *
 * **Den kjente kanten:** den som ikke har svart på noe, er ikke med. En beskjed
 * målrettet mot et prosjekt når altså ikke hele korpset «for sikkerhets skyld».
 * Det er derfor velgeren viser ANTALLET medlemmer målrettingen treffer før man
 * publiserer — valget skal tas med tallet synlig, ikke i blinde.
 */
async function projectsByUser(userIds?: string[]): Promise<Map<string, string[]>> {
  const d = db()
  const [attendanceRows, responsibleRows] = await Promise.all([
    d
      .selectDistinct({ userId: eventAttendance.userId, projectId: eventProjects.projectId })
      .from(eventAttendance)
      .innerJoin(eventProjects, eq(eventProjects.occurrenceKey, eventAttendance.occurrenceKey))
      .where(
        and(
          ne(eventAttendance.status, 'not_attending'),
          userIds ? inArray(eventAttendance.userId, userIds) : undefined,
        ),
      ),
    d
      .selectDistinct({ userId: projectTimes.responsibleUserId, projectId: projectTimes.projectId })
      .from(projectTimes)
      .where(
        and(
          isNotNull(projectTimes.responsibleUserId),
          userIds ? inArray(projectTimes.responsibleUserId, userIds) : undefined,
        ),
      ),
  ])

  const out = new Map<string, string[]>()
  for (const r of [...attendanceRows, ...responsibleRows]) {
    if (!r.userId) continue
    const list = out.get(r.userId) ?? []
    if (!list.includes(r.projectId)) list.push(r.projectId)
    out.set(r.userId, list)
  }
  return out
}

/**
 * Leseren, slik `canReadPost` trenger den. Kalles på hver visning av veggen og
 * av bilderuta, og er derfor holdt til to små spørringer: stemmegruppene tas fra
 * `me.parts`, som `currentUser()` allerede har hentet.
 */
export async function postReaderFor(me: Me): Promise<PostReader> {
  const projectsForMe = await projectsByUser([me.id])
  return {
    canPublish: hasPermission(me, PUBLISH_PERMISSION),
    sectionIds: [...new Set(me.parts.map((p) => p.section))],
    projectIds: projectsForMe.get(me.id) ?? [],
  }
}

/** Et medlem med alt varsling, omtaler og sett-status trenger å vite om det. */
export type DirectoryMember = PostReader & {
  userId: string
  name: string
  email: string | null
  isActive: boolean
}

/**
 * HELE medlemslista med målgruppedata. Grunnlaget for e-postmottakere,
 * omtaleforslag og «Sett av N av M» — ett oppslag, slik at de tre aldri kan
 * komme i utakt om hvem som er i målgruppen.
 */
export async function memberDirectory(): Promise<DirectoryMember[]> {
  const d = db()
  const [memberRows, permissions, sections, memberProjects] = await Promise.all([
    d
      .select({
        userId: memberProfiles.authUserId,
        name: user.name,
        email: user.email,
        isActive: memberProfiles.isActive,
      })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .orderBy(asc(user.name)),
    memberPermissionsByUser(),
    sectionsByUser(),
    projectsByUser(),
  ])

  return memberRows.map((m) => ({
    userId: m.userId,
    name: m.name,
    email: m.email,
    isActive: m.isActive,
    canPublish: permissionsInclude(permissions.get(m.userId) ?? [], PUBLISH_PERMISSION),
    sectionIds: sections.get(m.userId) ?? [],
    projectIds: memberProjects.get(m.userId) ?? [],
  }))
}

// ---------- Målrettingen på et innlegg ----------

/** Målrettingen for en håndfull innlegg. Én spørring, tom liste = ingen innsnevring. */
export async function postTargetsFor(postIds: string[]): Promise<Map<string, PostTarget[]>> {
  const out = new Map<string, PostTarget[]>()
  if (postIds.length === 0) return out
  const rows = await db()
    .select({ postId: postTargets.postId, kind: postTargets.kind, refId: postTargets.refId })
    .from(postTargets)
    .where(inArray(postTargets.postId, postIds))
  for (const r of rows) {
    const list = out.get(r.postId) ?? []
    list.push({ kind: r.kind, refId: r.refId })
    out.set(r.postId, list)
  }
  return out
}

/** Nøkkelen i etikett-oppslaget. Ett sted, så visning og validering ikke kan skille lag. */
export function targetKey(target: PostTarget): string {
  return `${target.kind}:${target.refId}`
}

/**
 * De gyldige målrettingene, med norske navn: stemmegruppene som faktisk har en
 * stemme i besetningen, og prosjektene. Brukes både av velgeren i skjemaet og av
 * valideringen på serveren — en målretting UI-et ikke kunne tilby, skal serveren
 * heller ikke godta.
 */
export async function targetOptions(): Promise<{
  sections: Array<{ refId: string; label: string; memberCount: number }>
  projects: Array<{ refId: string; label: string; memberCount: number }>
}> {
  const [sectionRows, projectRows, directory] = await Promise.all([
    db().selectDistinct({ section: parts.section }).from(parts),
    db()
      .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
      .from(projects)
      .orderBy(sql`coalesce(${projects.eventDate}, '') desc`),
    memberDirectory(),
  ])
  const active = directory.filter((m) => m.isActive)

  return {
    // 'score' (dirigent/partitur) er ikke en stemmegruppe å sende beskjed til.
    sections: sectionRows
      .map((r) => r.section)
      .filter((section) => section !== 'score')
      .map((section) => ({
        refId: section,
        label: SECTION_LABELS[section as SectionId] ?? section,
        memberCount: active.filter((m) => m.sectionIds.includes(section)).length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'nb')),
    projects: projectRows.map((p) => ({
      refId: p.id,
      label: p.eventDate ? `${p.name} (${p.eventDate})` : p.name,
      memberCount: active.filter((m) => m.projectIds.includes(p.id)).length,
    })),
  }
}

/** `section:perc` → «Slagverk», `project:<id>` → prosjektnavnet. Til merkelapper. */
export async function targetLabels(targets: readonly PostTarget[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (targets.length === 0) return out
  for (const t of targets) {
    if (t.kind === 'section') out.set(targetKey(t), SECTION_LABELS[t.refId as SectionId] ?? t.refId)
  }
  const projectIds = targets.filter((t) => t.kind === 'project').map((t) => t.refId)
  if (projectIds.length > 0) {
    const rows = await db()
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, projectIds))
    for (const r of rows) out.set(`project:${r.id}`, r.name)
  }
  return out
}

/**
 * Avviser en målretting som ikke finnes. Kalles FØR innlegget lagres — klienten
 * er like betrodd som alltid: ingenting. En ukjent stemmegruppe eller et slettet
 * prosjekt ville gitt en beskjed ingen kan lese, og det er en feil å si fra om,
 * ikke en tom liste å publisere.
 */
export async function assertValidTargets(targets: readonly PostTarget[]): Promise<void> {
  if (targets.length === 0) return
  if (targets.length > MAX_POST_TARGETS) throw new Error(`Du kan målrette mot maks ${MAX_POST_TARGETS} grupper`)
  const options = await targetOptions()
  const valid = new Set([
    ...options.sections.map((s) => `section:${s.refId}`),
    ...options.projects.map((p) => `project:${p.refId}`),
  ])
  if (targets.some((t) => !valid.has(targetKey(t)))) {
    throw new Error('Ukjent stemmegruppe eller prosjekt i målrettingen')
  }
}

/**
 * SQL-betingelsen «denne beskjeden er ikke målrettet, eller den treffer meg».
 *
 * Finnes for hub-en, som filtrerer i SQL og henter et fast lite antall rader:
 * ble filtreringen gjort i JS etterpå, ville «de tre siste beskjedene» blitt to
 * eller null for den som ikke er i målgruppen. Veggen filtrerer i stedet i
 * server-koden etter at radene er hentet — begge deler er server-side, som er
 * det kravet handler om.
 *
 * `posts.publish`-holdere sender ikke denne betingelsen i det hele tatt; de ser
 * alt uansett (`canReadPost`).
 */
export function targetsAllowReader(reader: PostReader) {
  const untargeted = notExists(
    db()
      .select({ one: sql`1` })
      .from(postTargets)
      .where(eq(postTargets.postId, posts.id)),
  )
  const mine = [
    ...(reader.sectionIds.length > 0
      ? [and(eq(postTargets.kind, 'section'), inArray(postTargets.refId, [...reader.sectionIds]))]
      : []),
    ...(reader.projectIds.length > 0
      ? [and(eq(postTargets.kind, 'project'), inArray(postTargets.refId, [...reader.projectIds]))]
      : []),
  ]
  if (mine.length === 0) return untargeted
  return or(
    untargeted,
    exists(
      db()
        .select({ one: sql`1` })
        .from(postTargets)
        .where(and(eq(postTargets.postId, posts.id), or(...mine))),
    ),
  )
}
