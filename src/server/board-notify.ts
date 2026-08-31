import { env } from 'cloudflare:workers'
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { boardProjects, boardTasks, notificationPreferences, settings, user } from '../db/schema'
import { type SortableTask, overdueByAssignee, shouldRunReminders, wantsTaskEmail } from '../lib/board'
import { toOsloDate } from '../lib/format'
import { overdueTasksEmail, sendEmail, taskAssignedEmail } from './email'

/**
 * Varsling om styreoppgaver: delegering (med én gang) og forfalte frister (én
 * gang per dag). Egen modul fordi den har *levende* eksport som rører
 * `cloudflare:workers` (BETTER_AUTH_URL) — den importeres kun fra serverkode og
 * fra worker-entryen, aldri fra en rutekomponent. Samme deling som
 * `board-files.ts`.
 *
 * Begge e-postene styres av det samme valget: `notification_preferences.board_tasks`
 * ('all' | 'off'), satt på `/min-profil`. Ingen rad = 'all'.
 */

/** Nøkkelen i `settings` som holder ISO-datoen påminnelsene sist kjørte (norsk tid). */
export const REMINDER_SETTINGS_KEY = 'board.reminders.lastRunDate'

/** Samme puljestørrelse som veggen bruker — vær grei mot e-postbindingen. */
const EMAIL_BATCH = 5

function baseUrl(): string {
  return (env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
}

/**
 * Sier fra til den som har fått en styreoppgave. Kalles etter at lagringen er
 * ferdig, og svelger alle feil: en e-post som ikke går ut skal aldri gjøre at
 * oppgaven ikke ble delegert.
 */
export async function notifyTaskAssigned(input: {
  taskId: string
  title: string
  dueDate: string | null
  projectTitle: string | null
  assigneeUserId: string
  assignedBy: { id: string; name: string }
}): Promise<void> {
  // Man varsler ikke seg selv om noe man nettopp gjorde.
  if (input.assigneeUserId === input.assignedBy.id) return

  try {
    const recipient = (
      await db()
        .select({
          email: user.email,
          name: user.name,
          pref: notificationPreferences.boardTasks,
        })
        .from(user)
        .leftJoin(notificationPreferences, eq(notificationPreferences.userId, user.id))
        .where(eq(user.id, input.assigneeUserId))
        .limit(1)
    )[0]
    if (!recipient?.email) return
    // Ingen rad = alle varsler. Valget dekker både denne e-posten og den
    // daglige påminnelsen om forfalte oppgaver.
    if (!wantsTaskEmail(recipient.pref)) return

    const mail = taskAssignedEmail({
      title: input.title,
      dueDate: input.dueDate,
      projectTitle: input.projectTitle,
      url: `${baseUrl()}/styre/${input.taskId}`,
      assignedByName: input.assignedBy.name,
    })
    await sendEmail({ to: recipient.email, ...mail })
  } catch (err) {
    console.warn('[board] kunne ikke varsle om delegering:', err)
  }
}

// ---------- Daglig påminnelse om forfalte oppgaver ----------

export type ReminderRun = {
  /** Falsk når dagens kjøring allerede var tatt av noen andre. */
  ran: boolean
  /** Antall mottakere det faktisk ble forsøkt sendt til. */
  recipients: number
  sent: number
  /** Kun skrevet til konsollen (ingen e-postbinding) — aldri det samme som sendt. */
  logged: number
  failed: number
}

type OverdueRow = SortableTask & {
  assigneeUserId: string | null
  projectTitle: string | null
  email: string | null
  pref: string | null
}

/**
 * Tar dagens kjøring, eller lar være. Skrivingen skjer FØR utsendingen, som et
 * compare-and-set: to samtidige kall (cron som kjører om igjen, eller to
 * isolates) kan aldri begge få `true`, og dobbelt e-post er verre enn en
 * påminnelse som uteblir en dag.
 */
async function claimRun(today: string): Promise<boolean> {
  const d = db()
  const current =
    (await d.select({ value: settings.value }).from(settings).where(eq(settings.key, REMINDER_SETTINGS_KEY)).limit(1))[0]
      ?.value ?? null
  if (!shouldRunReminders(current, today)) return false

  if (current === null) {
    // Første gang: den som får raden opprettet, eier dagen.
    const inserted = await d
      .insert(settings)
      .values({ key: REMINDER_SETTINGS_KEY, value: today })
      .onConflictDoNothing()
      .run()
    return rowsChanged(inserted) === 1
  }

  const updated = await d
    .update(settings)
    .set({ value: today })
    .where(and(eq(settings.key, REMINDER_SETTINGS_KEY), ne(settings.value, today)))
    .run()
  return rowsChanged(updated) === 1
}

/** D1 rapporterer antall endrede rader i `meta`; drizzle sender resultatet videre urørt. */
function rowsChanged(result: unknown): number {
  const meta = (result as { meta?: { changes?: number; rows_written?: number } } | null)?.meta
  return meta?.changes ?? meta?.rows_written ?? 0
}

/**
 * Sender én e-post per ansvarlig med de oppgavene hens som har passert fristen.
 * Kjøres av `scheduled`-handleren i `src/worker.ts` (cron `0 7 * * *`, altså
 * 07:00 UTC ≈ 09:00 norsk tid), og maks én gang per kalenderdag uansett hvor
 * mange ganger den kalles — se `claimRun`.
 *
 * Svelger alle feil: en e-post som ikke går ut skal aldri velte kjøringen.
 */
export async function runOverdueReminders(now: Date = new Date()): Promise<ReminderRun> {
  const empty: ReminderRun = { ran: false, recipients: 0, sent: 0, logged: 0, failed: 0 }
  try {
    const today = toOsloDate(now.getTime())
    if (!today) return empty
    if (!(await claimRun(today))) return empty

    const rows = await db()
      .select({
        id: boardTasks.id,
        title: boardTasks.title,
        status: boardTasks.status,
        dueDate: boardTasks.dueDate,
        createdAt: boardTasks.createdAt,
        completedAt: boardTasks.completedAt,
        assigneeUserId: boardTasks.assigneeUserId,
        projectTitle: boardProjects.title,
        email: user.email,
        pref: notificationPreferences.boardTasks,
      })
      .from(boardTasks)
      // Uten ansvarlig finnes det ingen å minne på.
      .innerJoin(user, eq(boardTasks.assigneeUserId, user.id))
      .leftJoin(boardProjects, eq(boardTasks.boardProjectId, boardProjects.id))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, boardTasks.assigneeUserId))
      .where(
        and(ne(boardTasks.status, 'done'), isNotNull(boardTasks.dueDate), lt(boardTasks.dueDate, today)),
      )

    // SQL-filteret over er bare en innsnevring; hva som *er* forfalt avgjøres av
    // den rene, testede regelen i src/lib/board.ts — én sannhet for e-post og skjerm.
    const tasks: OverdueRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      dueDate: r.dueDate,
      createdAt: r.createdAt.getTime(),
      completedAt: r.completedAt?.getTime() ?? null,
      assigneeUserId: r.assigneeUserId,
      projectTitle: r.projectTitle,
      email: r.email,
      pref: r.pref,
    }))

    const base = baseUrl()
    const mails = overdueByAssignee(tasks, today)
      .map((group) => {
        const first = group.tasks[0]!
        if (!first.email) return null
        if (!wantsTaskEmail(first.pref)) return null
        return {
          to: first.email,
          ...overdueTasksEmail({
            tasks: group.tasks.map((t) => ({
              title: t.title,
              dueDate: t.dueDate!,
              url: `${base}/styre/${t.id}`,
              projectTitle: t.projectTitle,
            })),
            count: group.tasks.length,
          }),
        }
      })
      .filter((mail): mail is { to: string; subject: string; html: string; text: string } => mail !== null)

    const result: ReminderRun = { ran: true, recipients: mails.length, sent: 0, logged: 0, failed: 0 }
    for (let i = 0; i < mails.length; i += EMAIL_BATCH) {
      const settled = await Promise.allSettled(mails.slice(i, i + EMAIL_BATCH).map((mail) => sendEmail(mail)))
      for (const res of settled) {
        // Samme skille som veggen: «logget» er konsoll-logg i dev, ikke en sendt e-post.
        if (res.status !== 'fulfilled') result.failed += 1
        else if (res.value.ok) result.sent += 1
        else if (res.value.fallback) result.logged += 1
        else result.failed += 1
      }
    }
    if (result.recipients > 0) {
      console.log(
        `[board] påminnelser ${today}: ${result.sent} sendt, ${result.logged} logget, ${result.failed} feilet`,
      )
    }
    return result
  } catch (err) {
    console.warn('[board] kunne ikke sende påminnelser om forfalte oppgaver:', err)
    return empty
  }
}
