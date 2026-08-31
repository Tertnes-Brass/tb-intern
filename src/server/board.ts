import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  boardComments,
  boardDocuments,
  boardMeetings,
  boardTasks,
  memberProfiles,
  projects,
  rolePermissions,
  user,
} from '../db/schema'
import { BOARD_TASK_STATUSES, type BoardTaskStatus, groupTasks, sortTasks } from '../lib/board'
import { newId } from '../lib/id'
import { requirePermission } from './access'
import { deleteBoardObject } from './board-files'

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
      .where(
        and(
          data?.status ? eq(boardTasks.status, data.status) : undefined,
          data?.mine ? eq(boardTasks.assigneeUserId, me.id) : undefined,
          data?.meetingId ? eq(boardTasks.meetingId, data.meetingId) : undefined,
        ),
      )

    // Rekkefølgen avgjøres i den rene, testede modulen — «åpne først på frist,
    // ferdige sist» er ikke én ORDER BY uten å duplisere NULL-håndteringen.
    const tasks = rows.map(toTaskRow)
    const today = todayOslo()
    return { ...groupTasks(tasks, today), count: tasks.length, today, meId: me.id }
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
        .where(eq(boardTasks.id, data.id))
        .limit(1)
    )[0]
    if (!row) throw new Error('Fant ikke oppgaven')

    const [comments, assignees, meetings] = await Promise.all([
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
    ])

    return {
      task: { ...toTaskRow(row), description: row.description },
      comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.getTime() })),
      assignees,
      meetings,
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
      meetingId: z.string().nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requirePermission(BOARD_PERMISSION)
    const ts = new Date()
    const id = newId()
    await db().insert(boardTasks).values({
      id,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      status: 'open',
      assigneeUserId: data.assigneeUserId || null,
      dueDate: data.dueDate || null,
      projectId: data.projectId || null,
      meetingId: data.meetingId || null,
      createdBy: me.id,
      createdAt: ts,
      updatedAt: ts,
    })
    return { id }
  })

export const updateTask = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1, 'Tittel er påkrevd').max(200).optional(),
      description: z.string().max(4000).nullable().optional(),
      dueDate: isoDate.nullable().optional(),
      assigneeUserId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      meetingId: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission(BOARD_PERMISSION)
    const { id, ...patch } = data
    await db()
      .update(boardTasks)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
        ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId || null } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId || null } : {}),
        ...(patch.meetingId !== undefined ? { meetingId: patch.meetingId || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(boardTasks.id, id))
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

    const [taskRows, documents] = await Promise.all([
      d
        .select(taskColumns)
        .from(boardTasks)
        .leftJoin(user, eq(boardTasks.assigneeUserId, user.id))
        .leftJoin(boardMeetings, eq(boardTasks.meetingId, boardMeetings.id))
        .leftJoin(projects, eq(boardTasks.projectId, projects.id))
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
    ])

    return {
      meeting: {
        id: meeting.id,
        date: meeting.date,
        title: meeting.title,
        notes: meeting.notes,
      },
      tasks: sortTasks(taskRows.map(toTaskRow)),
      documents: documents.map((doc) => ({ ...doc, createdAt: doc.createdAt.getTime() })),
      today: todayOslo(),
      meId: me.id,
    }
  })

export const createMeeting = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1, 'Tittel er påkrevd').max(200),
      date: isoDate,
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
      // Notatene er ren tekst med avsnitt — trimmes i endene, aldri i midten.
      notes: z.string().max(20_000).nullable().optional(),
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
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
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
