import { env } from 'cloudflare:workers'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import {
  boardComments,
  boardMeetings,
  boardMessages,
  boardProjects,
  boardTasks,
  invitations,
  parts,
  postComments,
  postReactions,
  posts,
  projectWorks,
  projects,
  rolePermissions,
  roles,
  seasons,
  settings,
  shareLinks,
  user,
  workFiles,
  workLinks,
  works,
} from '../db/schema'
import { findRoleNameCollision, roleNameCollisionMessage } from '../lib/roles'
import { BRASS_BAND_PARTS } from '../lib/taxonomy'
import { newId, sha256Hex } from '../lib/id'
import { youTubeSearchUrl } from '../lib/youtube'
import { generateDemoPartPdf } from './pdf'
import {
  DEMO_SHARE_EXPIRES,
  DEMO_SHARE_PART_IDS,
  DEMO_SHARE_RECIPIENT,
  DEMO_SHARE_TOKEN,
  SEED_BOARD_MEETINGS,
  SEED_BOARD_MESSAGES,
  SEED_BOARD_PROJECTS,
  SEED_BOARD_TASKS,
  SEED_MEMBERS,
  SEED_POSTS,
  SEED_POST_COMMENTS,
  SEED_POST_REACTIONS,
  SEED_PROJECTS,
  SEED_ROLES,
  SEED_ROLE_PERMISSIONS,
  SEED_SEASONS,
  SEED_WORKS,
} from './seed-data'

export { DEMO_SHARE_TOKEN }

const now = () => new Date()

export async function isSeeded(): Promise<boolean> {
  const row = await db().select({ id: works.id }).from(works).limit(1)
  return row.length > 0
}

/** Seeder besetning + roller (alltid), og — kun i dev — demoinnhold + invitasjoner. */
export async function seedBaseConfig(): Promise<void> {
  const d = db()
  // Roller + rettigheter. Migrasjonene setter inn enkeltroller (0008 la inn
  // «Styremedlem»), så «er tabellen tom?» er ikke lenger et gyldig spørsmål —
  // en fersk installasjon ville da fått board og ingenting annet. Vi legger
  // derfor inn hver systemrolle som mangler, og seeder standardrettighetene
  // KUN for roller vi nettopp opprettet: rettigheter en admin har fjernet i
  // rollematrisen skal aldri komme tilbake av seg selv.
  //
  // Navnekollisjon er en egen sak (#78): `board` ble lagt inn av 0008 selv om
  // det allerede fantes en brukeropprettet rolle som HET «Styremedlem», og
  // resultatet var to rader ingen kunne skille i rollematrisen. Vi oppretter
  // derfor ikke en systemrolle blindt — finnes navnet fra før, hoppes rollen
  // over og kollisjonen logges med begge ID-ene, slik at en admin kan gi den
  // gamle rollen nytt navn (eller slå dem sammen) før neste seeding. Å
  // opprette duplikaten er verre enn å vente på avklaringen.
  const existingRoles = await d.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
  const existingRoleIds = new Set(existingRoles.map((r) => r.id))
  const missingRoles = SEED_ROLES.filter((r) => {
    if (existingRoleIds.has(r.id)) return false
    const collision = findRoleNameCollision(r.name, existingRoles)
    if (!collision) return true
    console.warn(`[seed] Hopper over systemrollen «${r.name}» (${r.id}): ${roleNameCollisionMessage(collision)}`)
    return false
  })
  if (missingRoles.length > 0) {
    await d
      .insert(roles)
      .values(missingRoles.map((r) => ({ ...r })))
      .onConflictDoNothing()
    const newRoleIds = new Set<string>(missingRoles.map((r) => r.id))
    const newPermissions = SEED_ROLE_PERMISSIONS.filter((p) => newRoleIds.has(p.roleId))
    if (newPermissions.length > 0) {
      await d.insert(rolePermissions).values(newPermissions).onConflictDoNothing()
    }
  }
  // Besetning: legg til manglende standardstemmer og synkroniser bare feltene
  // taxonomy eier. Behold eventuelle lokalt redigerte navn og aliaser.
  for (const batch of chunkArray(BRASS_BAND_PARTS, 10)) {
    for (const p of batch) {
      await d
        .insert(parts)
        .values({
          id: p.id,
          sortOrder: p.sortOrder,
          nameNo: p.nameNo,
          nameEn: p.nameEn,
          aliases: JSON.stringify(p.aliases),
          section: p.section,
        })
        .onConflictDoUpdate({
          target: parts.id,
          set: { sortOrder: p.sortOrder, section: p.section },
        })
    }
  }
}

/**
 * Demoinnhold for LOKAL utvikling: verk, prosjekter, genererte PDF-er, og
 * invitasjoner for demomedlemmene (så man kan logge inn som dem via magisk
 * lenke i dev). Oppretter IKKE brukere — de lages ved første innlogging.
 */
export async function seedDemoData(): Promise<{ ok: boolean; alreadySeeded?: boolean }> {
  await seedBaseConfig()

  const d = db()
  const ts = now()

  // Sørg for at dev-login virker også når databasen allerede har verk fra en
  // eldre/ufullstendig seed. Eksisterende invitasjoner skal ikke overskrives.
  for (const member of SEED_MEMBERS) {
    await d
      .insert(invitations)
      .values({
        email: member.email.toLowerCase(),
        name: member.name,
        roleId: member.roleId,
        partIds: JSON.stringify(member.partIds),
        invitedBy: null,
        createdAt: ts,
      })
      .onConflictDoNothing()
  }

  // Veggen fylles på hver gang: demobrukerne opprettes først ved innlogging,
  // så forfattere, kommentarer og likes kobles på etter hvert som kontoene
  // finnes. Funksjonen er idempotent.
  await seedWallDemo()

  if (await isSeeded()) {
    // Styredemoen fyller sine egne tabeller, så lokale databaser som ble seedet
    // før /styre fantes skal også få innhold.
    await seedBoardDemoData()
    return { ok: true, alreadySeeded: true }
  }

  // Verk
  const seedWorks = SEED_WORKS.map((sw) => ({ ...sw, id: newId() }))
  for (const batch of chunkArray(seedWorks, 5)) {
    await d.insert(works).values(
      batch.map((sw) => ({
        id: sw.id,
        title: sw.title,
        composer: sw.composer,
        arranger: sw.arranger,
        publisher: sw.publisher,
        genre: sw.genre,
        grade: sw.grade,
        durationSec: sw.durationSec,
        acquiredYear: sw.acquiredYear,
        physicalLocation: sw.physicalLocation,
        notes: sw.notes,
        status: 'active' as const,
        createdAt: ts,
        updatedAt: ts,
      })),
    )
  }
  await d.insert(workLinks).values(
    seedWorks.map((sw) => ({
      id: newId(),
      workId: sw.id,
      kind: 'other',
      url: youTubeSearchUrl(`${sw.title} brass band ${sw.composer ?? ''}`),
      label: 'Finn innspilling på YouTube',
    })),
  )

  // Sesonger + prosjekter
  const seasonRows = SEED_SEASONS.map((s) => ({ ...s, id: newId() }))
  await d.insert(seasons).values(seasonRows)
  const seasonId = new Map(seasonRows.map((s) => [s.name, s.id]))
  const workIdByTitle = new Map(seedWorks.map((sw) => [sw.title, sw.id]))

  for (const sp of SEED_PROJECTS) {
    const projectId = newId()
    await d.insert(projects).values({
      id: projectId,
      seasonId: seasonId.get(sp.seasonName)!,
      name: sp.name,
      kind: sp.kind,
      eventDate: sp.eventDate,
      venue: sp.venue,
      description: sp.description,
      isPublished: sp.isPublished,
      percussionNotes: sp.percussionNotes ?? null,
      createdAt: ts,
    })
    await d.insert(projectWorks).values(
      sp.repertoire.map(([title, position, note, percussionSetup]) => ({
        projectId,
        workId: workIdByTitle.get(title)!,
        position,
        note,
        percussionSetup: percussionSetup ?? null,
      })),
    )
    if (sp.name === 'Sommerkonsert') {
      await d.insert(shareLinks).values({
        id: newId(),
        projectId,
        tokenHash: await sha256Hex(DEMO_SHARE_TOKEN),
        recipientName: DEMO_SHARE_RECIPIENT,
        partIds: JSON.stringify(DEMO_SHARE_PART_IDS),
        expiresAt: new Date(Date.parse(DEMO_SHARE_EXPIRES)),
        createdBy: null,
        createdAt: ts,
      })
    }
  }

  // Genererte demo-PDF-er (uploadedBy = null; ingen bruker ennå)
  const fileRows: Array<typeof workFiles.$inferInsert> = []
  for (const sw of seedWorks) {
    const composerLine = [sw.composer, sw.arranger ? `arr. ${sw.arranger}` : null].filter(Boolean).join(' · ')
    for (const part of BRASS_BAND_PARTS) {
      const isScore = part.id === 'score'
      const bytes = await generateDemoPartPdf({
        title: sw.title,
        composerLine: composerLine || 'Ukjent',
        partLabel: part.nameEn,
        tempoText: sw.tempoText,
        pages: isScore ? 4 : 2,
      })
      const fileId = newId()
      const r2Key = `works/${sw.id}/${fileId}.pdf`
      await env.FILES.put(r2Key, bytes)
      fileRows.push({
        id: fileId,
        workId: sw.id,
        kind: isScore ? 'score' : 'part',
        partId: part.id,
        label: null,
        r2Key,
        fileName: `${sw.title} - ${part.nameEn}.pdf`,
        fileSize: bytes.byteLength,
        pageCount: isScore ? 4 : 2,
        uploadedBy: null,
        uploadedAt: ts,
      })
    }
  }
  for (const batch of chunkArray(fileRows, 8)) {
    await d.insert(workFiles).values(batch)
  }

  // Etter prosjektene: en styreoppgave kobles til Sommerkonserten.
  await seedBoardDemoData()

  await d.insert(settings).values([{ key: 'bandName', value: 'Tertnes Brass' }])
  return { ok: true }
}

/**
 * Demoinnhold for veggen (#28), kun i dev. Idempotent: innlegg, kommentarer og
 * likes har faste id-er, og forfatterne kobles på når demobrukeren finnes.
 * Likes krever en faktisk bruker (PK-en er (post, bruker)), så de hoppes over
 * til kontoen er opprettet ved første innlogging.
 */
export async function seedWallDemo(): Promise<void> {
  const d = db()
  const ts = now()
  const userIdByEmail = new Map(
    (await d.select({ id: user.id, email: user.email }).from(user)).map((u) => [u.email.toLowerCase(), u.id]),
  )
  const at = (daysAgo: number | null, hoursAfter = 0) =>
    daysAgo === null ? null : new Date(ts.getTime() - daysAgo * 86_400_000 + hoursAfter * 3_600_000)

  for (const sp of SEED_POSTS) {
    const publishedAt = at(sp.publishedDaysAgo)
    const authorId = userIdByEmail.get(sp.authorEmail) ?? null
    await d
      .insert(posts)
      .values({
        id: sp.id,
        title: sp.title,
        body: sp.body,
        format: sp.format ?? 'plain_text',
        audience: sp.audience,
        importance: sp.importance,
        official: sp.official,
        authorId,
        publishedAt,
        createdAt: publishedAt ?? ts,
        updatedAt: publishedAt ?? ts,
      })
      .onConflictDoNothing()
    // Forfatteren kobles på ved en senere kjøring hvis kontoen ikke fantes da
    // innlegget ble seedet.
    if (authorId) {
      await d
        .update(posts)
        .set({ authorId })
        .where(and(eq(posts.id, sp.id), isNull(posts.authorId)))
    }
  }

  const postById = new Map(SEED_POSTS.map((sp) => [sp.id, sp]))
  for (const sc of SEED_POST_COMMENTS) {
    const authorId = userIdByEmail.get(sc.authorEmail) ?? null
    const parent = postById.get(sc.postId)
    const createdAt = at(parent?.publishedDaysAgo ?? 1, sc.hoursAfter) ?? ts
    await d
      .insert(postComments)
      .values({ id: sc.id, postId: sc.postId, authorId, body: sc.body, createdAt, updatedAt: createdAt })
      .onConflictDoNothing()
    if (authorId) {
      await d
        .update(postComments)
        .set({ authorId })
        .where(and(eq(postComments.id, sc.id), isNull(postComments.authorId)))
    }
  }

  for (const sr of SEED_POST_REACTIONS) {
    const userId = userIdByEmail.get(sr.authorEmail)
    if (!userId) continue
    await d
      .insert(postReactions)
      .values({ postId: sr.postId, userId, kind: 'like', createdAt: ts })
      .onConflictDoNothing()
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** ISO-dato N dager fra i dag, i lokal tid. */
function isoDayFromToday(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

/**
 * Demoinnhold for styreområdet: to møter (ett med agenda, notater og vedtak),
 * to styreprosjekter med egne oppgaver og chat-tråder, fem løse oppgaver (én
 * forfalt, én ferdig), et par kommentarer og noen meldinger i fellesekanalen.
 * Datoene er relative til i dag, så «forfalt» faktisk er forfalt uansett når
 * demoen kjøres. Ingen dokumenter — de ville krevd R2-objekter uten å vise noe
 * seeding ikke allerede viser.
 */
async function seedBoardDemoData(): Promise<void> {
  const d = db()
  const ts = now()
  // Hver bolk har sin egen vakt. Da får en lokal database som ble seedet før
  // prosjektene og chatten fantes også dem, uten at møtene dupliseres.
  const hasMeetings = (await d.select({ id: boardMeetings.id }).from(boardMeetings).limit(1)).length > 0
  const hasProjects = (await d.select({ id: boardProjects.id }).from(boardProjects).limit(1)).length > 0
  const hasGeneralChat =
    (await d.select({ id: boardMessages.id }).from(boardMessages).where(eq(boardMessages.channel, 'general')).limit(1))
      .length > 0

  const meetingIdByTitle = new Map<string, string>()
  for (const m of hasMeetings ? [] : SEED_BOARD_MEETINGS) {
    const id = newId()
    meetingIdByTitle.set(m.title, id)
    await d.insert(boardMeetings).values({
      id,
      date: isoDayFromToday(m.dayOffset),
      title: m.title,
      agenda: m.agenda,
      notes: m.notes,
      decisions: m.decisions,
      createdBy: null,
      createdAt: ts,
      updatedAt: ts,
    })
  }

  // Styreprosjekter med egne oppgaver og en chat-tråd hver.
  const boardProjectIdByTitle = new Map<string, string>()
  for (const bp of hasProjects ? [] : SEED_BOARD_PROJECTS) {
    const linked = bp.linkedProjectName
      ? (await d.select({ id: projects.id }).from(projects).where(eq(projects.name, bp.linkedProjectName)).limit(1))[0]
      : undefined
    const id = newId()
    boardProjectIdByTitle.set(bp.title, id)
    await d.insert(boardProjects).values({
      id,
      title: bp.title,
      goal: bp.goal,
      status: 'active',
      dueDate: bp.dueDayOffset === null ? null : isoDayFromToday(bp.dueDayOffset),
      ownerUserId: null,
      linkedProjectId: linked?.id ?? null,
      createdBy: null,
      createdAt: ts,
      updatedAt: ts,
    })
    for (const t of bp.tasks) {
      await d.insert(boardTasks).values({
        id: newId(),
        title: t.title,
        description: null,
        status: t.status,
        assigneeUserId: null,
        dueDate: t.dueDayOffset === null ? null : isoDayFromToday(t.dueDayOffset),
        projectId: null,
        boardProjectId: id,
        meetingId: null,
        createdBy: null,
        createdAt: ts,
        updatedAt: ts,
        completedAt: t.status === 'done' ? ts : null,
      })
    }
    // Meldingene får hvert sitt minutt, ellers står de i tilfeldig rekkefølge.
    for (const [i, body] of bp.messages.entries()) {
      await d.insert(boardMessages).values({
        id: newId(),
        channel: `project:${id}`,
        authorId: null,
        body,
        createdAt: new Date(ts.getTime() - (bp.messages.length - i) * 60_000),
      })
    }
  }

  for (const [i, body] of hasGeneralChat ? [] : SEED_BOARD_MESSAGES.entries()) {
    await d.insert(boardMessages).values({
      id: newId(),
      channel: 'general',
      authorId: null,
      body,
      createdAt: new Date(ts.getTime() - (SEED_BOARD_MESSAGES.length - i) * 3_600_000),
    })
  }

  for (const t of hasMeetings ? [] : SEED_BOARD_TASKS) {
    const project = t.projectName
      ? (await d.select({ id: projects.id }).from(projects).where(eq(projects.name, t.projectName)).limit(1))[0]
      : undefined
    const id = newId()
    await d.insert(boardTasks).values({
      id,
      title: t.title,
      description: t.description,
      status: t.status,
      // Demomedlemmene er ikke opprettet som brukere før de logger inn, så
      // oppgavene står uten ansvarlig til noen tar dem.
      assigneeUserId: null,
      dueDate: t.dueDayOffset === null ? null : isoDayFromToday(t.dueDayOffset),
      projectId: project?.id ?? null,
      boardProjectId: t.boardProjectTitle ? (boardProjectIdByTitle.get(t.boardProjectTitle) ?? null) : null,
      meetingId: t.meetingTitle ? (meetingIdByTitle.get(t.meetingTitle) ?? null) : null,
      createdBy: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: t.status === 'done' ? ts : null,
    })
    for (const body of t.comments) {
      await d.insert(boardComments).values({ id: newId(), taskId: id, authorId: null, body, createdAt: ts })
    }
  }
}
