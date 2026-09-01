import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gt, inArray, isNull, like, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { db } from '../db'
import {
  boardChannelReads,
  boardChannels,
  boardComments,
  boardDocuments,
  boardMeetings,
  boardMessages,
  boardProjects,
  boardTasks,
  memberProfiles,
  projects,
  rolePermissions,
  user,
} from '../db/schema'
import {
  BOARD_PROJECT_STATUSES,
  BOARD_TASK_STATUSES,
  type BoardProjectStatus,
  type BoardTaskStatus,
  type ChannelKind,
  type ChannelSummary,
  type ChatMessage,
  GENERAL_CHANNEL,
  channelNameError,
  channelNameKey,
  customChannel,
  groupTasks,
  normalizeChannelName,
  parseChannel,
  projectChannel,
  replyReference,
  sortBoardProjects,
  sortChannels,
  sortTasks,
  totalUnread,
} from '../lib/board'
import { newId } from '../lib/id'
import {
  type MentionUser,
  mentionMarker,
  mentionRejection,
  parseMentions,
  rankMentionCandidates,
} from '../lib/mentions'
import { type Me, requirePermission } from './access'
import { deleteBoardObject } from './board-files'
import { notifyTaskAssigned } from './board-notify'

/**
 * Styreområdet (`/styre`): oppgaver, møter, kommentarer og dokumenter.
 *
 * ALT her er gated på `board.manage` — også lesing. Styrearbeid er ikke
 * medlemsinnhold, og gaten ligger her på serveren, aldri bare i `beforeLoad`.
 * Dokumentbytene strømmes fra en egen gated rute
 * (`src/routes/api/board-files/$documentId.ts`), aldri gjennom note-gaten.
 */

export const BOARD_PERMISSION = 'board.manage'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ugyldig dato')

/** Datoen i dag slik den ser ut i Norge — samme grunnlag som «forfalt». */
function todayOslo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Oslo',
  }).format(new Date())
}

export type BoardTaskRow = {
  id: string
  title: string
  status: BoardTaskStatus
  dueDate: string | null
  createdAt: number
  completedAt: number | null
  assigneeUserId: string | null
  assigneeName: string | null
  meetingId: string | null
  meetingTitle: string | null
  projectId: string | null
  projectName: string | null
  boardProjectId: string | null
  boardProjectTitle: string | null
  commentCount: number
}

const taskColumns = {
  id: boardTasks.id,
  title: boardTasks.title,
  status: boardTasks.status,
  dueDate: boardTasks.dueDate,
  createdAt: boardTasks.createdAt,
  completedAt: boardTasks.completedAt,
  assigneeUserId: boardTasks.assigneeUserId,
  assigneeName: user.name,
  meetingId: boardTasks.meetingId,
  meetingTitle: boardMeetings.title,
  projectId: boardTasks.projectId,
  projectName: projects.name,
  boardProjectId: boardTasks.boardProjectId,
  boardProjectTitle: boardProjects.title,
  commentCount: sql<number>`(select count(*) from board_comments bc where bc.task_id = ${boardTasks.id})`,
}

/** Timestamp-kolonner er `Date` i Drizzle; klienten får epoch-ms. */
function toTaskRow(row: {
  id: string
  title: string
  status: string
  dueDate: string | null
  createdAt: Date
  completedAt: Date | null
  assigneeUserId: string | null
  assigneeName: string | null
  meetingId: string | null
  meetingTitle: string | null
  projectId: string | null
  projectName: string | null
  boardProjectId: string | null
  boardProjectTitle: string | null
  commentCount: number
}): BoardTaskRow {
  return {
    ...row,
    status: row.status as BoardTaskStatus,
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime() ?? null,
  }
}

// ---------- Oppgaver ----------

export const listTasks = createServerFn()
  .validator(
    z
      .object({
        status: z.enum(BOARD_TASK_STATUSES).optional(),
        /** Kun oppgaver jeg er ansvarlig for. */
        mine: z.boolean().optional(),
        meetingId: z.string().optional(),
        boardProjectId: z.string().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()

    const rows = await d
      .select(taskColumns)
      .from(boardTasks)
      .leftJoin(user, eq(boardTasks.assigneeUserId, user.id))
      .leftJoin(boardMeetings, eq(boardTasks.meetingId, boardMeetings.id))
      .leftJoin(projects, eq(boardTasks.projectId, projects.id))
      .leftJoin(boardProjects, eq(boardTasks.boardProjectId, boardProjects.id))
      .where(
        and(
          data?.status ? eq(boardTasks.status, data.status) : undefined,
          data?.mine ? eq(boardTasks.assigneeUserId, me.id) : undefined,
          data?.meetingId ? eq(boardTasks.meetingId, data.meetingId) : undefined,
          data?.boardProjectId ? eq(boardTasks.boardProjectId, data.boardProjectId) : undefined,
        ),
      )

    // Rekkefølgen avgjøres i den rene, testede modulen — «åpne først på frist,
    // ferdige sist» er ikke én ORDER BY uten å duplisere NULL-håndteringen.
    const tasks = rows.map(toTaskRow)
    const today = todayOslo()
    // Prosjektvelgeren i filteret skal vise alle aktive styreprosjekter, ikke
    // bare dem som tilfeldigvis har en oppgave i det gjeldende utvalget.
    const projectOptions = await d
      .select({ id: boardProjects.id, title: boardProjects.title })
      .from(boardProjects)
      .where(eq(boardProjects.status, 'active'))
      .orderBy(asc(boardProjects.title))
    return { ...groupTasks(tasks, today), count: tasks.length, today, meId: me.id, projectOptions }
  })

export const getTask = createServerFn()
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()

    const row = (
      await d
        .select({ ...taskColumns, description: boardTasks.description })
        .from(boardTasks)
        .leftJoin(user, eq(boardTasks.assigneeUserId, user.id))
        .leftJoin(boardMeetings, eq(boardTasks.meetingId, boardMeetings.id))
        .leftJoin(projects, eq(boardTasks.projectId, projects.id))
        .leftJoin(boardProjects, eq(boardTasks.boardProjectId, boardProjects.id))
        .where(eq(boardTasks.id, data.id))
        .limit(1)
    )[0]
    if (!row) throw new Error('Fant ikke oppgaven')

    const [comments, assignees, meetings, boardProjectOptions] = await Promise.all([
      d
        .select({
          id: boardComments.id,
          body: boardComments.body,
          createdAt: boardComments.createdAt,
          authorId: boardComments.authorId,
          authorName: user.name,
        })
        .from(boardComments)
        .leftJoin(user, eq(boardComments.authorId, user.id))
        .where(eq(boardComments.taskId, data.id))
        .orderBy(asc(boardComments.createdAt)),
      listAssignableMembers(),
      listMeetingOptions(),
      listBoardProjectOptions(),
    ])

    return {
      task: { ...toTaskRow(row), description: row.description },
      comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.getTime() })),
      assignees,
      meetings,
      boardProjects: boardProjectOptions,
      today: todayOslo(),
      meId: me.id,
    }
  })

/**
 * Medlemmene som kan settes som ansvarlig. Styremedlemmer og administratorer
 * først — det er de som faktisk gjør styrearbeidet — men hele lista er med, så
 * en oppgave kan legges på dirigenten eller arkivaren når det er dem det gjelder.
 */
async function listAssignableMembers(): Promise<Array<{ id: string; name: string; isBoard: boolean }>> {
  const rows = await db()
    .select({
      id: user.id,
      name: user.name,
      roleId: memberProfiles.roleId,
      isActive: memberProfiles.isActive,
    })
    .from(memberProfiles)
    .innerJoin(user, eq(memberProfiles.authUserId, user.id))

  // Hvilke roller som faktisk har styretilgang leses fra rollematrisen, ikke
  // hardkodet — en egendefinert rolle med `board.manage` skal også telle.
  const boardRoles = new Set(
    (
      await db()
        .select({ roleId: rolePermissions.roleId })
        .from(rolePermissions)
        .where(or(eq(rolePermissions.permission, BOARD_PERMISSION), eq(rolePermissions.permission, '*')))
    ).map((r) => r.roleId),
  )

  return rows
    .filter((r) => r.isActive)
    .map((r) => ({ id: r.id, name: r.name, isBoard: boardRoles.has(r.roleId) }))
    .sort((a, b) => Number(b.isBoard) - Number(a.isBoard) || a.name.localeCompare(b.name, 'nb'))
}

async function listMeetingOptions(): Promise<Array<{ id: string; title: string; date: string }>> {
  return db()
    .select({ id: boardMeetings.id, title: boardMeetings.title, date: boardMeetings.date })
    .from(boardMeetings)
    .orderBy(desc(boardMeetings.date))
    .limit(50)
}

export const createTask = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1, 'Tittel er påkrevd').max(200),
      description: z.string().max(4000).optional(),
      dueDate: isoDate.nullish(),
      assigneeUserId: z.string().nullish(),
      projectId: z.string().nullish(),
      boardProjectId: z.string().nullish(),
      meetingId: z.string().nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const ts = new Date()
    const id = newId()
    const title = data.title.trim()
    await db().insert(boardTasks).values({
      id,
      title,
      description: data.description?.trim() || null,
      status: 'open',
      assigneeUserId: data.assigneeUserId || null,
      dueDate: data.dueDate || null,
      projectId: data.projectId || null,
      boardProjectId: data.boardProjectId || null,
      meetingId: data.meetingId || null,
      createdBy: me.id,
      createdAt: ts,
      updatedAt: ts,
    })
    if (data.assigneeUserId) {
      await notifyAssignee({
        taskId: id,
        title,
        dueDate: data.dueDate ?? null,
        boardProjectId: data.boardProjectId ?? null,
        assigneeUserId: data.assigneeUserId,
        me,
      })
    }
    return { id }
  })

/** Slår opp prosjektnavnet og varsler. Aldri i veien for selve lagringen. */
async function notifyAssignee(input: {
  taskId: string
  title: string
  dueDate: string | null
  boardProjectId: string | null
  assigneeUserId: string
  me: Me
}): Promise<void> {
  const projectTitle = input.boardProjectId
    ? ((
        await db()
          .select({ title: boardProjects.title })
          .from(boardProjects)
          .where(eq(boardProjects.id, input.boardProjectId))
          .limit(1)
      )[0]?.title ?? null)
    : null
  await notifyTaskAssigned({
    taskId: input.taskId,
    title: input.title,
    dueDate: input.dueDate,
    projectTitle,
    assigneeUserId: input.assigneeUserId,
    assignedBy: { id: input.me.id, name: input.me.name },
  })
}

export const updateTask = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1, 'Tittel er påkrevd').max(200).optional(),
      description: z.string().max(4000).nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      assigneeUserId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      boardProjectId: z.string().nullable().optional(),
      meetingId: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()
    const { id, ...patch } = data

    // Leses FØR oppdateringen: delegering skal bare varsles når ansvarlig
    // faktisk endrer seg, ikke hver gang noen retter en skrivefeil i tittelen.
    const before = (
      await d
        .select({
          assigneeUserId: boardTasks.assigneeUserId,
          title: boardTasks.title,
          dueDate: boardTasks.dueDate,
          boardProjectId: boardTasks.boardProjectId,
        })
        .from(boardTasks)
        .where(eq(boardTasks.id, id))
        .limit(1)
    )[0]
    if (!before) throw new Error('Fant ikke oppgaven')

    await d
      .update(boardTasks)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
        ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId || null } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId || null } : {}),
        ...(patch.boardProjectId !== undefined ? { boardProjectId: patch.boardProjectId || null } : {}),
        ...(patch.meetingId !== undefined ? { meetingId: patch.meetingId || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(boardTasks.id, id))

    const nextAssignee = patch.assigneeUserId === undefined ? before.assigneeUserId : patch.assigneeUserId || null
    if (nextAssignee && nextAssignee !== before.assigneeUserId) {
      await notifyAssignee({
        taskId: id,
        title: patch.title?.trim() || before.title,
        dueDate: patch.dueDate === undefined ? before.dueDate : patch.dueDate || null,
        boardProjectId:
          patch.boardProjectId === undefined ? before.boardProjectId : patch.boardProjectId || null,
        assigneeUserId: nextAssignee,
        me,
      })
    }
    return { ok: true }
  })

export const setTaskStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), status: z.enum(BOARD_TASK_STATUSES) }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const ts = new Date()
    await db()
      .update(boardTasks)
      .set({
        status: data.status,
        // Fullføringstidspunktet er ferskvare: åpnes oppgaven igjen, skal det
        // bort, ellers ville den ligget feil i «ferdig»-rekkefølgen senere.
        completedAt: data.status === 'done' ? ts : null,
        updatedAt: ts,
      })
      .where(eq(boardTasks.id, data.id))
    return { ok: true }
  })

export const deleteTask = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    // Kommentarene henger på oppgaven med ON DELETE CASCADE.
    await db().delete(boardTasks).where(eq(boardTasks.id, data.id))
    return { ok: true }
  })

/** Prosjektsøk for koblingen oppgave → konsert. Egen gate, ikke `projects.manage`. */
export const searchProjectsForTask = createServerFn()
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const q = data.q?.trim()
    const rows = await db()
      .select({ id: projects.id, name: projects.name, eventDate: projects.eventDate })
      .from(projects)
      .where(q ? or(like(projects.name, `%${q}%`), like(projects.venue, `%${q}%`)) : undefined)
      .orderBy(desc(projects.eventDate))
      .limit(10)
    return { projects: rows }
  })

// ---------- Kommentarer ----------

export const addComment = createServerFn({ method: 'POST' })
  .validator(z.object({ taskId: z.string(), body: z.string().min(1, 'Skriv noe først').max(4000) }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const task = (
      await db().select({ id: boardTasks.id }).from(boardTasks).where(eq(boardTasks.id, data.taskId)).limit(1)
    )[0]
    if (!task) throw new Error('Fant ikke oppgaven')
    const id = newId()
    await db()
      .insert(boardComments)
      .values({ id, taskId: data.taskId, authorId: me.id, body: data.body.trim(), createdAt: new Date() })
    return { id }
  })

export const deleteComment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    await db().delete(boardComments).where(eq(boardComments.id, data.id))
    return { ok: true }
  })

// ---------- Møter ----------

export const listMeetings = createServerFn().handler(async () => {
  await requirePermission(BOARD_PERMISSION)
  const d = db()
  const rows = await d
    .select({
      id: boardMeetings.id,
      date: boardMeetings.date,
      title: boardMeetings.title,
      notes: boardMeetings.notes,
      agenda: boardMeetings.agenda,
      decisions: boardMeetings.decisions,
      taskCount: sql<number>`(select count(*) from board_tasks bt where bt.meeting_id = ${boardMeetings.id})`,
      openTaskCount: sql<number>`(select count(*) from board_tasks bt where bt.meeting_id = ${boardMeetings.id} and bt.status <> 'done')`,
      documentCount: sql<number>`(select count(*) from board_documents bd where bd.meeting_id = ${boardMeetings.id})`,
    })
    .from(boardMeetings)
    .orderBy(desc(boardMeetings.date))

  return {
    meetings: rows.map((m) => ({
      id: m.id,
      date: m.date,
      title: m.title,
      hasNotes: Boolean(m.notes?.trim()),
      hasAgenda: Boolean(m.agenda?.trim()),
      hasDecisions: Boolean(m.decisions?.trim()),
      taskCount: m.taskCount,
      openTaskCount: m.openTaskCount,
      documentCount: m.documentCount,
    })),
    today: todayOslo(),
  }
})

export const getMeeting = createServerFn()
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()
    const meeting = (await d.select().from(boardMeetings).where(eq(boardMeetings.id, data.id)).limit(1))[0]
    if (!meeting) throw new Error('Fant ikke møtet')

    const [taskRows, documents, boardProjectOptions] = await Promise.all([
      d
        .select(taskColumns)
        .from(boardTasks)
        .leftJoin(user, eq(boardTasks.assigneeUserId, user.id))
        .leftJoin(boardMeetings, eq(boardTasks.meetingId, boardMeetings.id))
        .leftJoin(projects, eq(boardTasks.projectId, projects.id))
        .leftJoin(boardProjects, eq(boardTasks.boardProjectId, boardProjects.id))
        .where(eq(boardTasks.meetingId, data.id)),
      d
        .select({
          id: boardDocuments.id,
          title: boardDocuments.title,
          fileName: boardDocuments.fileName,
          size: boardDocuments.size,
          createdAt: boardDocuments.createdAt,
          uploadedByName: user.name,
        })
        .from(boardDocuments)
        .leftJoin(user, eq(boardDocuments.uploadedBy, user.id))
        .where(eq(boardDocuments.meetingId, data.id))
        .orderBy(desc(boardDocuments.createdAt)),
      listBoardProjectOptions(),
    ])

    return {
      meeting: {
        id: meeting.id,
        date: meeting.date,
        title: meeting.title,
        agenda: meeting.agenda,
        notes: meeting.notes,
        decisions: meeting.decisions,
      },
      tasks: sortTasks(taskRows.map(toTaskRow)),
      documents: documents.map((doc) => ({ ...doc, createdAt: doc.createdAt.getTime() })),
      boardProjects: boardProjectOptions,
      today: todayOslo(),
      meId: me.id,
    }
  })

export const createMeeting = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1, 'Tittel er påkrevd').max(200),
      date: isoDate,
      agenda: z.string().max(20_000).optional(),
      notes: z.string().max(20_000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const ts = new Date()
    const id = newId()
    await db().insert(boardMeetings).values({
      id,
      date: data.date,
      title: data.title.trim(),
      agenda: data.agenda?.trim() || null,
      notes: data.notes?.trim() || null,
      createdBy: me.id,
      createdAt: ts,
      updatedAt: ts,
    })
    return { id }
  })

export const updateMeeting = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1, 'Tittel er påkrevd').max(200).optional(),
      date: isoDate.optional(),
      // Agenda, notater og vedtak er ren tekst med avsnitt — trimmes i endene,
      // aldri i midten.
      agenda: z.string().max(20_000).nullable().optional(),
      notes: z.string().max(20_000).nullable().optional(),
      decisions: z.string().max(20_000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const { id, ...patch } = data
    await db()
      .update(boardMeetings)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.agenda !== undefined ? { agenda: patch.agenda?.trim() || null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        ...(patch.decisions !== undefined ? { decisions: patch.decisions?.trim() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(boardMeetings.id, id))
    return { ok: true }
  })

export const deleteMeeting = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    // Oppgaver og dokumenter mister koblingen (ON DELETE SET NULL), men
    // overlever møtet — arbeidet er ikke over selv om møtet slettes.
    await db().delete(boardMeetings).where(eq(boardMeetings.id, data.id))
    return { ok: true }
  })

// ---------- Dokumenter ----------

export const listDocuments = createServerFn().handler(async () => {
  await requirePermission(BOARD_PERMISSION)
  const rows = await db()
    .select({
      id: boardDocuments.id,
      title: boardDocuments.title,
      fileName: boardDocuments.fileName,
      size: boardDocuments.size,
      contentType: boardDocuments.contentType,
      createdAt: boardDocuments.createdAt,
      meetingId: boardDocuments.meetingId,
      meetingTitle: boardMeetings.title,
      uploadedByName: user.name,
    })
    .from(boardDocuments)
    .leftJoin(boardMeetings, eq(boardDocuments.meetingId, boardMeetings.id))
    .leftJoin(user, eq(boardDocuments.uploadedBy, user.id))
    .orderBy(desc(boardDocuments.createdAt))

  return {
    documents: rows.map((doc) => ({ ...doc, createdAt: doc.createdAt.getTime() })),
    meetings: await listMeetingOptions(),
  }
})

/**
 * Retter tittelen på et opplastet dokument, og kobler det til et møte (eller
 * løsner det). Selve filen røres ikke — den lastes opp én gang og byttes ikke.
 */
export const updateDocument = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1, 'Tittel er påkrevd').max(200).optional(),
      meetingId: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    await db()
      .update(boardDocuments)
      .set({
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.meetingId !== undefined ? { meetingId: data.meetingId || null } : {}),
      })
      .where(eq(boardDocuments.id, data.id))
    return { ok: true }
  })

export const deleteDocument = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const d = db()
    const doc = (
      await d.select({ r2Key: boardDocuments.r2Key }).from(boardDocuments).where(eq(boardDocuments.id, data.id)).limit(1)
    )[0]
    if (!doc) return { ok: true }
    await d.delete(boardDocuments).where(eq(boardDocuments.id, data.id))
    // Metadata er fasit: forsvinner raden, skal ikke bytene bli liggende igjen.
    await deleteBoardObject(doc.r2Key)
    return { ok: true }
  })

// ---------- Styreprosjekter ----------

/** Aktive styreprosjekter til velgere. Ferdige og arkiverte skal ikke tilbys. */
async function listBoardProjectOptions(): Promise<Array<{ id: string; title: string }>> {
  return db()
    .select({ id: boardProjects.id, title: boardProjects.title })
    .from(boardProjects)
    .where(eq(boardProjects.status, 'active'))
    .orderBy(asc(boardProjects.title))
}

const boardProjectColumns = {
  id: boardProjects.id,
  title: boardProjects.title,
  goal: boardProjects.goal,
  status: boardProjects.status,
  dueDate: boardProjects.dueDate,
  ownerUserId: boardProjects.ownerUserId,
  ownerName: user.name,
  linkedProjectId: boardProjects.linkedProjectId,
  linkedProjectName: projects.name,
  createdAt: boardProjects.createdAt,
  completedAt: boardProjects.completedAt,
  totalTasks: sql<number>`(select count(*) from board_tasks bt where bt.board_project_id = ${boardProjects.id})`,
  doneTasks: sql<number>`(select count(*) from board_tasks bt where bt.board_project_id = ${boardProjects.id} and bt.status = 'done')`,
}

type BoardProjectQueryRow = {
  id: string
  title: string
  goal: string | null
  status: string
  dueDate: string | null
  ownerUserId: string | null
  ownerName: string | null
  linkedProjectId: string | null
  linkedProjectName: string | null
  createdAt: Date
  completedAt: Date | null
  totalTasks: number
  doneTasks: number
}

function toBoardProjectRow(row: BoardProjectQueryRow) {
  return {
    ...row,
    status: row.status as BoardProjectStatus,
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime() ?? null,
  }
}

export const listBoardProjects = createServerFn().handler(async () => {
  const me = await requirePermission(BOARD_PERMISSION)
  const rows = await db()
    .select(boardProjectColumns)
    .from(boardProjects)
    .leftJoin(user, eq(boardProjects.ownerUserId, user.id))
    .leftJoin(projects, eq(boardProjects.linkedProjectId, projects.id))

  // Rekkefølgen (aktive på frist, så ferdige, så arkiverte) er ren, testet
  // logikk — ikke en ORDER BY som må gjette på NULL-er.
  return { projects: sortBoardProjects(rows.map(toBoardProjectRow)), today: todayOslo(), meId: me.id }
})

export const getBoardProject = createServerFn()
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()

    const row = (
      await d
        .select(boardProjectColumns)
        .from(boardProjects)
        .leftJoin(user, eq(boardProjects.ownerUserId, user.id))
        .leftJoin(projects, eq(boardProjects.linkedProjectId, projects.id))
        .where(eq(boardProjects.id, data.id))
        .limit(1)
    )[0]
    if (!row) throw new Error('Fant ikke styreprosjektet')

    const [taskRows, assignees] = await Promise.all([
      d
        .select(taskColumns)
        .from(boardTasks)
        .leftJoin(user, eq(boardTasks.assigneeUserId, user.id))
        .leftJoin(boardMeetings, eq(boardTasks.meetingId, boardMeetings.id))
        .leftJoin(projects, eq(boardTasks.projectId, projects.id))
        .leftJoin(boardProjects, eq(boardTasks.boardProjectId, boardProjects.id))
        .where(eq(boardTasks.boardProjectId, data.id)),
      listAssignableMembers(),
    ])

    const today = todayOslo()
    return {
      project: toBoardProjectRow(row),
      ...groupTasks(taskRows.map(toTaskRow), today),
      assignees,
      channel: projectChannel(data.id),
      today,
      meId: me.id,
    }
  })

export const createBoardProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1, 'Tittel er påkrevd').max(200),
      goal: z.string().max(4000).optional(),
      dueDate: isoDate.nullish(),
      ownerUserId: z.string().nullish(),
      linkedProjectId: z.string().nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const ts = new Date()
    const id = newId()
    await db().insert(boardProjects).values({
      id,
      title: data.title.trim(),
      goal: data.goal?.trim() || null,
      status: 'active',
      dueDate: data.dueDate || null,
      ownerUserId: data.ownerUserId || null,
      linkedProjectId: data.linkedProjectId || null,
      createdBy: me.id,
      createdAt: ts,
      updatedAt: ts,
    })
    return { id }
  })

export const updateBoardProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1, 'Tittel er påkrevd').max(200).optional(),
      goal: z.string().max(4000).nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      linkedProjectId: z.string().nullable().optional(),
      status: z.enum(BOARD_PROJECT_STATUSES).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const { id, ...patch } = data
    const ts = new Date()
    await db()
      .update(boardProjects)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.goal !== undefined ? { goal: patch.goal?.trim() || null } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
        ...(patch.ownerUserId !== undefined ? { ownerUserId: patch.ownerUserId || null } : {}),
        ...(patch.linkedProjectId !== undefined ? { linkedProjectId: patch.linkedProjectId || null } : {}),
        // Som for oppgaver: fullføringstidspunktet nullstilles når prosjektet
        // åpnes igjen. Arkivering er ikke fullføring — den rører det ikke.
        ...(patch.status !== undefined
          ? {
              status: patch.status,
              ...(patch.status === 'done' ? { completedAt: ts } : {}),
              ...(patch.status === 'active' ? { completedAt: null } : {}),
            }
          : {}),
        updatedAt: ts,
      })
      .where(eq(boardProjects.id, id))
    return { ok: true }
  })

export const deleteBoardProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const d = db()
    // Oppgavene overlever prosjektet (ON DELETE SET NULL) og havner tilbake i
    // den vanlige lista. Tråden derimot hører til prosjektet og går med.
    await d.delete(boardMessages).where(eq(boardMessages.channel, projectChannel(data.id)))
    await d.delete(boardProjects).where(eq(boardProjects.id, data.id))
    return { ok: true }
  })

// ---------- Chat ----------

/**
 * Kanalene styret kan se, i lista si egen rekkefølge. Tre typer med hver sin
 * eier: fellesekanalen (ingen rad noe sted), prosjekttrådene (lever så lenge
 * styreprosjektet er aktivt) og de egendefinerte kanalene i `board_channels`.
 * Arkiverte kanaler blir med — de skal kunne leses, bare ikke skrives i.
 */
async function loadChannels(): Promise<
  Array<{ channel: string; title: string; kind: ChannelKind; archived: boolean }>
> {
  const d = db()
  const [projectRows, customRows] = await Promise.all([
    d
      .select({ id: boardProjects.id, title: boardProjects.title })
      .from(boardProjects)
      .where(eq(boardProjects.status, 'active')),
    d
      .select({ id: boardChannels.id, name: boardChannels.name, archivedAt: boardChannels.archivedAt })
      .from(boardChannels)
      .where(eq(boardChannels.kind, 'custom')),
  ])

  return sortChannels([
    { channel: GENERAL_CHANNEL, title: 'Styret', kind: 'general' as ChannelKind, archived: false },
    ...projectRows.map((p) => ({
      channel: projectChannel(p.id),
      title: p.title,
      kind: 'project' as ChannelKind,
      archived: false,
    })),
    ...customRows.map((c) => ({
      channel: customChannel(c.id),
      title: c.name,
      kind: 'custom' as ChannelKind,
      archived: c.archivedAt !== null,
    })),
  ])
}

/**
 * En kanalnøkkel er fellesekanalen, en tråd for et styreprosjekt som FINNES,
 * eller en egendefinert kanal som finnes. Uten denne sjekken kunne hvem som
 * helst med `board.manage` skrevet i en oppdiktet kanal ingen andre ser.
 *
 * `write: true` krever i tillegg at kanalen ikke er arkivert. Arkivering er en
 * myk stenging: historikken skal fortsatt kunne leses, men samtalen er over.
 */
async function assertChannelExists(channel: string, opts: { write?: boolean } = {}): Promise<void> {
  const parsed = parseChannel(channel)
  if (!parsed) throw new Error('Ukjent kanal')
  if (parsed.kind === 'general') return

  if (parsed.kind === 'project') {
    const found = (
      await db().select({ id: boardProjects.id }).from(boardProjects).where(eq(boardProjects.id, parsed.id)).limit(1)
    )[0]
    if (!found) throw new Error('Ukjent kanal')
    return
  }

  const row = (
    await db()
      .select({ id: boardChannels.id, archivedAt: boardChannels.archivedAt })
      .from(boardChannels)
      .where(and(eq(boardChannels.id, parsed.id), eq(boardChannels.kind, 'custom')))
      .limit(1)
  )[0]
  if (!row) throw new Error('Ukjent kanal')
  if (opts.write && row.archivedAt) throw new Error('Kanalen er arkivert')
}

/** Hvor mye historikk en kanal laster ved åpning. Styret er lite; dette holder. */
const CHAT_PAGE_SIZE = 200

/**
 * Kanallista med uleste. Fellesekanalen først, deretter prosjekttrådene for
 * aktive prosjekter, så de egendefinerte kanalene — arkiverte nederst.
 */
export const listChannels = createServerFn().handler(async () => {
  const me = await requirePermission(BOARD_PERMISSION)
  const d = db()

  const [all, reads, unreadRows] = await Promise.all([
    loadChannels(),
    d.select().from(boardChannelReads).where(eq(boardChannelReads.userId, me.id)),
    // Uleste telles i SQL fordi alternativet er å hente HVER melding i hver
    // kanal bare for å telle dem. Regelen er den samme som `unreadCount` i
    // `lib/board.ts` (andres meldinger etter lastReadAt), som klienten bruker
    // til «nye meldinger»-skillet i den åpne kanalen — endres den ene, må den
    // andre endres med.
    d
      .select({
        channel: boardMessages.channel,
        n: sql<number>`count(*)`,
        lastAt: sql<number>`max(${boardMessages.createdAt})`,
        // «Gjelder de uleste MEG?» Chatten sender ingen e-post, så dette er den
        // eneste forskjellen mellom «noen har skrevet» og «noen har spurt deg».
        // Én ekstra kolonne i en spørring som uansett går — ikke en ny runde.
        mine: sql<number>`sum(case when instr(${boardMessages.body}, ${mentionMarker(me.id)}) > 0 then 1 else 0 end)`,
      })
      .from(boardMessages)
      .leftJoin(
        boardChannelReads,
        and(eq(boardChannelReads.channel, boardMessages.channel), eq(boardChannelReads.userId, me.id)),
      )
      .where(
        and(
          ne(boardMessages.authorId, me.id),
          or(
            isNull(boardChannelReads.lastReadAt),
            gt(boardMessages.createdAt, boardChannelReads.lastReadAt),
          ),
        ),
      )
      .groupBy(boardMessages.channel),
  ])

  const unreadByChannel = new Map(unreadRows.map((r) => [r.channel, r.n]))
  const lastByChannel = new Map(unreadRows.map((r) => [r.channel, r.lastAt]))
  const mentionsByChannel = new Map(unreadRows.map((r) => [r.channel, r.mine]))
  const readAt = new Map(reads.map((r) => [r.channel, r.lastReadAt.getTime()]))

  const channels: ChannelSummary[] = all.map((c) => ({
    channel: c.channel,
    title: c.title,
    kind: c.kind,
    archived: c.archived,
    unread: unreadByChannel.get(c.channel) ?? 0,
    lastMessageAt: lastByChannel.get(c.channel) ?? readAt.get(c.channel) ?? null,
    mentionsMe: (mentionsByChannel.get(c.channel) ?? 0) > 0,
  }))

  return { channels, totalUnread: totalUnread(channels), meId: me.id }
})

/**
 * Samlet ulest-teller til områdemenyen. Bare kanaler som faktisk står i
 * kanallista teller: en prikk man ikke kan bli kvitt ved å lese noe — fordi
 * kanalen er arkivert eller prosjektet lagt bort — er en prikk ingen stoler på.
 */
export const getChatUnread = createServerFn().handler(async () => {
  const me = await requirePermission(BOARD_PERMISSION)
  const open = (await loadChannels()).filter((c) => !c.archived).map((c) => c.channel)
  if (open.length === 0) return { unread: 0 }

  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(boardMessages)
    .leftJoin(
      boardChannelReads,
      and(eq(boardChannelReads.channel, boardMessages.channel), eq(boardChannelReads.userId, me.id)),
    )
    .where(
      and(
        inArray(boardMessages.channel, open),
        ne(boardMessages.authorId, me.id),
        or(isNull(boardChannelReads.lastReadAt), gt(boardMessages.createdAt, boardChannelReads.lastReadAt)),
      ),
    )
  return { unread: rows[0]?.n ?? 0 }
})

// ---------- Egendefinerte kanaler ----------

/** Navnet er ledig når ingen AKTIV egendefinert kanal heter det samme. */
async function assertChannelNameFree(name: string, exceptId?: string): Promise<void> {
  const key = channelNameKey(name)
  const taken = await db()
    .select({ id: boardChannels.id, name: boardChannels.name })
    .from(boardChannels)
    .where(and(eq(boardChannels.kind, 'custom'), isNull(boardChannels.archivedAt)))
  if (taken.some((c) => c.id !== exceptId && channelNameKey(c.name) === key)) {
    throw new Error(`Det finnes allerede en kanal som heter «${normalizeChannelName(name)}»`)
  }
}

const channelName = z.string().min(1, 'Kanalen må ha et navn').max(200)

/** Validerer navnet med samme regel som klienten viser. */
function validChannelName(name: string): string {
  const error = channelNameError(name)
  if (error) throw new Error(error)
  return normalizeChannelName(name)
}

export const createChannel = createServerFn({ method: 'POST' })
  .validator(z.object({ name: channelName }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const name = validChannelName(data.name)
    await assertChannelNameFree(name)
    const id = newId()
    await db().insert(boardChannels).values({
      id,
      kind: 'custom',
      name,
      boardProjectId: null,
      createdBy: me.id,
      createdAt: new Date(),
      archivedAt: null,
    })
    return { id, channel: customChannel(id) }
  })

export const renameChannel = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), name: channelName }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const name = validChannelName(data.name)
    await assertChannelNameFree(name, data.id)
    await db()
      .update(boardChannels)
      .set({ name })
      .where(and(eq(boardChannels.id, data.id), eq(boardChannels.kind, 'custom')))
    return { ok: true }
  })

/**
 * Arkivering og gjenoppretting. Meldingene blir liggende — arkivering er å
 * rydde kanalen bort fra samtalen, ikke å slette den. En kanal som gjenopprettes
 * må fortsatt ha et ledig navn, ellers ville to like kanaler stått side om side.
 */
export const setChannelArchived = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), archived: z.boolean() }))
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const row = (
      await db()
        .select({ id: boardChannels.id, name: boardChannels.name })
        .from(boardChannels)
        .where(and(eq(boardChannels.id, data.id), eq(boardChannels.kind, 'custom')))
        .limit(1)
    )[0]
    if (!row) throw new Error('Ukjent kanal')
    if (!data.archived) await assertChannelNameFree(row.name, row.id)

    await db()
      .update(boardChannels)
      .set({ archivedAt: data.archived ? new Date() : null })
      .where(eq(boardChannels.id, data.id))
    return { ok: true }
  })

// ---------- Meldinger ----------

/** Meldingen et svar peker på — eller «slettet», når originalen er borte. */
const replyMessage = alias(boardMessages, 'reply_message')
const replyAuthor = alias(user, 'reply_author')

// ---------- Omtaler i styrechatten ----------

/** Antall forslag lista viser om gangen. Samme tall som på veggen. */
const MENTION_SUGGESTIONS = 8

/** ÉN feilmelding for alle avslag — se `MENTION_DENIED` i src/server/posts.ts. */
const MENTION_DENIED = 'Du kan bare omtale aktive medlemmer som har tilgang til styreområdet'

/**
 * Hvem kan omtales i styrechatten? Aktive medlemmer som selv kommer inn i
 * området — altså de som har `board.manage` (eller `*`) gjennom rollen sin.
 * Samme spørsmål som guarden stiller, stilt om alle medlemmene på én gang.
 *
 * Spørringen bor her og ikke i en delt modul med gruppelederne: de to områdene
 * har hver sin regel for hvem som hører til, og en felles «hent medlemmer med
 * tilgang»-funksjon ville før eller siden fått en parameter som gjorde det mulig
 * å spørre om feil område.
 */
async function mentionableMembers(): Promise<MentionUser[]> {
  const d = db()
  const [memberRows, permRows] = await Promise.all([
    d
      .select({
        userId: memberProfiles.authUserId,
        name: user.name,
        roleId: memberProfiles.roleId,
        isActive: memberProfiles.isActive,
      })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .orderBy(asc(user.name)),
    d.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions),
  ])
  const boardRoles = new Set(
    permRows.filter((p) => p.permission === '*' || p.permission === BOARD_PERMISSION).map((p) => p.roleId),
  )
  return memberRows
    .filter((m) => m.isActive && boardRoles.has(m.roleId))
    .map((m) => ({ id: m.userId, name: m.name }))
}

/**
 * Forslagslista bak `@` i styrechatten. Gated på `board.manage`, og returnerer
 * KUN `{ id, name }` — en autofullføring skal ikke kunne brukes til å hente ut
 * e-post, rolle eller stemme.
 */
export const searchMentionableMembers = createServerFn({ method: 'POST' })
  .validator(z.object({ query: z.string().max(60).default('') }))
  .handler(async ({ data }): Promise<MentionUser[]> => {
    await requirePermission(BOARD_PERMISSION)
    return rankMentionCandidates(await mentionableMembers(), data.query, MENTION_SUGGESTIONS)
  })

/** Dagens navn på alle omtalte i en side med meldinger (inkl. svarreferansene). */
async function mentionNamesFor(bodies: Array<string | null>): Promise<MentionUser[]> {
  const ids = new Set<string>()
  for (const body of bodies) {
    if (body) for (const id of parseMentions(body)) ids.add(id)
  }
  if (ids.size === 0) return []
  return db()
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...ids]))
}

/**
 * Meldingene i en kanal. `after` (epoch-ms) gjør pollingen billig: klienten ber
 * bare om det som har kommet siden sist, og får en tom liste når ingenting har
 * skjedd. Uten `after` lastes den siste sida med historikk.
 *
 * Lesing gates på at kanalen finnes (også for egendefinerte kanaler) — men
 * ikke på at den er aktiv: en arkivert kanal skal kunne leses.
 */
export const listMessages = createServerFn()
  .validator(z.object({ channel: z.string().min(1).max(120), after: z.number().int().nonnegative().optional() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    await assertChannelExists(data.channel)
    const d = db()

    const rows = await d
      .select({
        id: boardMessages.id,
        authorId: boardMessages.authorId,
        authorName: user.name,
        body: boardMessages.body,
        createdAt: boardMessages.createdAt,
        replyToDeleted: boardMessages.replyToDeleted,
        replyId: replyMessage.id,
        replyBody: replyMessage.body,
        replyAuthorName: replyAuthor.name,
      })
      .from(boardMessages)
      .leftJoin(user, eq(boardMessages.authorId, user.id))
      .leftJoin(replyMessage, eq(boardMessages.replyToId, replyMessage.id))
      .leftJoin(replyAuthor, eq(replyMessage.authorId, replyAuthor.id))
      .where(
        and(
          eq(boardMessages.channel, data.channel),
          data.after !== undefined ? gt(boardMessages.createdAt, new Date(data.after)) : undefined,
        ),
      )
      // Nyeste først i SQL + limit gir de SISTE meldingene; klienten viser dem
      // kronologisk (groupMessagesByDay sorterer selv).
      .orderBy(desc(boardMessages.createdAt))
      .limit(CHAT_PAGE_SIZE)

    // Omtalene løses til DAGENS navn her, ikke ved lagring. Meldinger har ingen
    // koblingstabell (de kan verken redigeres eller varsles på e-post), så
    // navnene sendes som ett oppslag for hele sida — klienten slår opp selv når
    // den rendrer chip-ene.
    const mentions = await mentionNamesFor(rows.flatMap((m) => [m.body, m.replyBody]))

    const messages: ChatMessage[] = rows
      .map((m) => ({
        id: m.id,
        authorId: m.authorId,
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt.getTime(),
        replyTo: replyReference(m, mentions),
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
    return {
      messages,
      meId: me.id,
      serverTime: Date.now(),
      mentionNames: Object.fromEntries(mentions.map((m) => [m.id, m.name])),
    }
  })

export const postMessage = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      channel: z.string().min(1).max(120),
      body: z.string().min(1, 'Skriv noe først').max(4000),
      /** Meldingen det svares på. Må ligge i samme kanal — ingen kryssvar. */
      replyToId: z.string().nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    await assertChannelExists(data.channel, { write: true })
    const d = db()

    // Omtalene valideres FØR meldingen lagres: en markør kan bare peke på noen
    // som selv har tilgang til området. Klienten setter markørene, og er derfor
    // like betrodd som alt annet fra en nettleser — ingenting.
    const mentionIds = parseMentions(data.body)
    if (mentionIds.length > 0) {
      const allowed = new Set((await mentionableMembers()).map((m) => m.id))
      const error = mentionRejection(mentionIds, allowed, MENTION_DENIED)
      if (error) throw new Error(error)
    }

    let replyToId: string | null = null
    let replyToDeleted = false
    if (data.replyToId) {
      const original = (
        await d
          .select({ id: boardMessages.id, channel: boardMessages.channel })
          .from(boardMessages)
          .where(eq(boardMessages.id, data.replyToId))
          .limit(1)
      )[0]
      if (original && original.channel !== data.channel) throw new Error('Meldingen hører til en annen kanal')
      // Ble originalen slettet mens svaret ble skrevet, går svaret likevel
      // inn — som et svar på noe som er borte. Å kaste bort teksten ville
      // vært verre enn å vise «Meldingen er slettet».
      replyToId = original?.id ?? null
      replyToDeleted = !original
    }

    const id = newId()
    const createdAt = new Date()
    await d
      .insert(boardMessages)
      .values({ id, channel: data.channel, authorId: me.id, body: data.body.trim(), replyToId, replyToDeleted, createdAt })
    return { id, createdAt: createdAt.getTime() }
  })

export const deleteMessage = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const d = db()
    // Styret er lite: man rydder i sitt eget, ingen moderering utover det.
    const mine = (
      await d
        .select({ id: boardMessages.id })
        .from(boardMessages)
        .where(and(eq(boardMessages.id, data.id), eq(boardMessages.authorId, me.id)))
        .limit(1)
    )[0]
    if (!mine) return { ok: true }

    // Svarene på meldingen merkes FØR den forsvinner. Fremmednøkkelen
    // nullstiller `reply_to_id` av seg selv, og uten merket ville svaret sett
    // ut som en vanlig melding i stedet for et svar på noe som er borte.
    await d
      .update(boardMessages)
      .set({ replyToId: null, replyToDeleted: true })
      .where(eq(boardMessages.replyToId, data.id))
    await d.delete(boardMessages).where(eq(boardMessages.id, data.id))
    return { ok: true }
  })

/** Merker kanalen som lest til og med `at` (epoch-ms, som regel serverens tid). */
export const markChannelRead = createServerFn({ method: 'POST' })
  .validator(z.object({ channel: z.string().min(1).max(120), at: z.number().int().nonnegative().optional() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    // Lesing, ikke skriving: en arkivert kanal skal kunne leses ferdig.
    await assertChannelExists(data.channel)
    const lastReadAt = new Date(data.at ?? Date.now())
    await db()
      .insert(boardChannelReads)
      .values({ userId: me.id, channel: data.channel, lastReadAt })
      .onConflictDoUpdate({
        target: [boardChannelReads.userId, boardChannelReads.channel],
        // Markøren skal bare gå framover: en treg fane som melder inn en gammel
        // tidsstempel skal ikke gjøre leste meldinger uleste igjen.
        set: { lastReadAt: sql`max(${boardChannelReads.lastReadAt}, ${lastReadAt.getTime()})` },
      })
    return { ok: true }
  })
