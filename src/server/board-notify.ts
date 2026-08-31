import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { user } from '../db/schema'
import { sendEmail, taskAssignedEmail } from './email'

/**
 * Varsling om delegering. Egen modul fordi den har et *levende* eksport som
 * rører `cloudflare:workers` (BETTER_AUTH_URL) — den importeres kun fra
 * serverkode, aldri fra en rutekomponent. Samme deling som `board-files.ts`.
 */

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

  // TODO(varsling): når varslingspreferanser finnes, sjekk her om mottakeren
  // vil ha e-post om delegering før vi sender. Ingen preferansetabell her —
  // den bygges i en egen gren.
  try {
    const recipient = (
      await db()
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, input.assigneeUserId))
        .limit(1)
    )[0]
    if (!recipient?.email) return

    const base = (env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
    const mail = taskAssignedEmail({
      title: input.title,
      dueDate: input.dueDate,
      projectTitle: input.projectTitle,
      url: `${base}/styre/${input.taskId}`,
      assignedByName: input.assignedBy.name,
    })
    await sendEmail({ to: recipient.email, ...mail })
  } catch (err) {
    console.warn('[board] kunne ikke varsle om delegering:', err)
  }
}
