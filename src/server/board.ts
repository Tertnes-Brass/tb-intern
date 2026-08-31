import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gt, isNull, like, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  boardChannelReads,
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
  GENERAL_CHANNEL,
  channelProjectId,
  groupTasks,
  projectChannel,
  sortBoardProjects,
  sortTasks,
} from '../lib/board'
import { newId } from '../lib/id'
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
 * En kanalnøkkel er enten fellesekanalen eller en tråd for et styreprosjekt som
 * FINNES. Uten denne sjekken kunne hvem som helst med `board.manage` skrevet i
 * en oppdiktet kanal ingen andre ser.
 */
async function assertChannelExists(channel: string): Promise<void> {
  if (channel === GENERAL_CHANNEL) return
  const boardProjectId = channelProjectId(channel)
  if (!boardProjectId) throw new Error('Ukjent kanal')
  const found = (
    await db().select({ id: boardProjects.id }).from(boardProjects).where(eq(boardProjects.id, boardProjectId)).limit(1)
  )[0]
  if (!found) throw new Error('Ukjent kanal')
}

/** Hvor mye historikk en kanal laster ved åpning. Styret er lite; dette holder. */
const CHAT_PAGE_SIZE = 200

/**
 * Kanallista med uleste. Fellesekanalen først, deretter prosjekttrådene for
 * aktive prosjekter i alfabetisk rekkefølge.
 */
export const listChannels = createServerFn().handler(async () => {
  const me = await requirePermission(BOARD_PERMISSION)
  const d = db()

  const [projectRows, reads, unreadRows] = await Promise.all([
    d
      .select({ id: boardProjects.id, title: boardProjects.title })
      .from(boardProjects)
      .where(eq(boardProjects.status, 'active'))
      .orderBy(asc(boardProjects.title)),
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
  const readAt = new Map(reads.map((r) => [r.channel, r.lastReadAt.getTime()]))

  const channels = [
    { channel: GENERAL_CHANNEL, title: 'Styret', boardProjectId: null as string | null },
    ...projectRows.map((p) => ({ channel: projectChannel(p.id), title: p.title, boardProjectId: p.id })),
  ].map((c) => ({
    ...c,
    unread: unreadByChannel.get(c.channel) ?? 0,
    lastMessageAt: lastByChannel.get(c.channel) ?? readAt.get(c.channel) ?? null,
  }))

  return { channels, totalUnread: channels.reduce((sum, c) => sum + c.unread, 0), meId: me.id }
})

/** Samlet ulest-teller til områdemenyen. Holdes bevisst liten. */
export const getChatUnread = createServerFn().handler(async () => {
  const me = await requirePermission(BOARD_PERMISSION)
  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(boardMessages)
    .leftJoin(
      boardChannelReads,
      and(eq(boardChannelReads.channel, boardMessages.channel), eq(boardChannelReads.userId, me.id)),
    )
    .where(
      and(
        ne(boardMessages.authorId, me.id),
        or(isNull(boardChannelReads.lastReadAt), gt(boardMessages.createdAt, boardChannelReads.lastReadAt)),
      ),
    )
  return { unread: rows[0]?.n ?? 0 }
})

/**
 * Meldingene i en kanal. `after` (epoch-ms) gjør pollingen billig: klienten ber
 * bare om det som har kommet siden sist, og får en tom liste når ingenting har
 * skjedd. Uten `after` lastes den siste sida med historikk.
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
      })
      .from(boardMessages)
      .leftJoin(user, eq(boardMessages.authorId, user.id))
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

    const messages = rows
      .map((m) => ({ ...m, createdAt: m.createdAt.getTime() }))
      .sort((a, b) => a.createdAt - b.createdAt)
    return { messages, meId: me.id, serverTime: Date.now() }
  })

export const postMessage = createServerFn({ method: 'POST' })
  .validator(
    z.object({ channel: z.string().min(1).max(120), body: z.string().min(1, 'Skriv noe først').max(4000) }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    await assertChannelExists(data.channel)
    const id = newId()
    const createdAt = new Date()
    await db()
      .insert(boardMessages)
      .values({ id, channel: data.channel, authorId: me.id, body: data.body.trim(), createdAt })
    return { id, createdAt: createdAt.getTime() }
  })

export const deleteMessage = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    // Styret er lite: man rydder i sitt eget, ingen moderering utover det.
    await db()
      .delete(boardMessages)
      .where(and(eq(boardMessages.id, data.id), eq(boardMessages.authorId, me.id)))
    return { ok: true }
  })

/** Merker kanalen som lest til og med `at` (epoch-ms, som regel serverens tid). */
export const markChannelRead = createServerFn({ method: 'POST' })
  .validator(z.object({ channel: z.string().min(1).max(120), at: z.number().int().nonnegative().optional() }))
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
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
