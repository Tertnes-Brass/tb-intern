import { env } from 'cloudflare:workers'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  memberProfiles,
  notificationPreferences,
  projectChanges,
  projectNotifications,
  projectWorks,
  projects,
  user,
} from '../db/schema'
import { newId } from '../lib/id'
import {
  type ProjectChange,
  type ProjectNotificationChoice,
  type ProjectNotifyResult,
  type ProjectRecipient,
  projectKindLabel,
  projectRecipientsFor,
  summarizeProjectChanges,
} from '../lib/project-notify'
import { projectPublishedEmail, projectUpdateEmail, sendEmail } from './email'

/**
 * Varsling om prosjekter (#18 + #51): e-posten når et prosjekt publiseres, og
 * e-posten om at noe er endret i et prosjekt som allerede er publisert.
 *
 * Egen modul fordi den har *levende* eksport som rører `cloudflare:workers`
 * (`BETTER_AUTH_URL` og e-postbindingen). Den importeres kun fra serverkode —
 * `src/server/projects.ts` — og ALDRI fra en rutekomponent; ellers ville
 * `cloudflare:workers` havnet i klientbygget. Samme deling som `board-notify.ts`
 * og `post-images.ts`.
 *
 * Tre regler går igjen, og de er de samme som på veggen:
 *
 * 1. **Utsending velter aldri handlingen.** Prosjektet er publisert, verket er
 *    lagt til, endringen er lagret — en e-post som feiler skal ikke rulle noe av
 *    det tilbake. Feil logges, og loggraden er sporet.
 * 2. **Puljer på fem.** Cloudflare Email Sending tar imot én melding om gangen.
 * 3. **`logged` er ikke «sendt».** Utfallet skrives som det er i
 *    `project_notifications`, og `projectNotifyMessage` presenterer det ærlig.
 */

/** Cloudflare Email Sending tar imot én melding om gangen; ~40 medlemmer i puljer på fem. */
const EMAIL_BATCH = 5
/** Loggrader skrives i litt større puljer — samme D1, men ingen nettverkskall. */
const LOG_BATCH = 20

type Outcome = 'sent' | 'logged' | 'failed'

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** URL-er bygges fra `BETTER_AUTH_URL`, aldri fra request-origin (AGENTS.md). */
function origin(): string {
  return new URL(env.BETTER_AUTH_URL).origin
}

function projectUrl(projectId: string): string {
  return `${origin()}/noter/prosjekter/${projectId}`
}

function myNotesUrl(): string {
  return `${origin()}/noter`
}

// ---------- Endringslogg (#51) ----------

/**
 * Skriver én rad i `project_changes` — grunnlaget for at endringsvarselet kan
 * samle alt siden sist i ÉN e-post.
 *
 * **Bare for publiserte prosjekter.** Et utkast er ikke synlig for noen, så det
 * finnes ingen endring å varsle om: publiseringen er nullpunktet. Uten regelen
 * ville det første endringsvarselet inneholdt hele oppbyggingen av programmet,
 * som medlemmene aldri har sett noe annet enn resultatet av.
 *
 * Svelger alle feil med vilje. Endringsloggen er et hjelpemiddel for varsling —
 * at den ikke lot seg skrive skal aldri gjøre at verket ikke ble lagt til.
 */
export async function recordProjectChange(input: {
  projectId: string
  kind: string
  subject?: string | null
  detail?: string | null
  actorUserId: string | null
}): Promise<void> {
  try {
    const d = db()
    const project = (
      await d
        .select({ isPublished: projects.isPublished })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1)
    )[0]
    if (!project?.isPublished) return

    await d.insert(projectChanges).values({
      id: newId(),
      projectId: input.projectId,
      kind: input.kind,
      subject: input.subject?.trim() || null,
      detail: input.detail?.trim() || null,
      actorUserId: input.actorUserId,
      createdAt: new Date(),
    })
  } catch (err) {
    console.error('[prosjektvarsling] kunne ikke loggføre endringen:', err)
  }
}

// ---------- Mottakere ----------

/**
 * Alle medlemmer med det varslingen trenger å vite: aktiv-status og e-post,
 * pluss varslingsvalget. Ingen rettighetsoppslag — et prosjektvarsel har ingen
 * målgruppe-inndeling, det går til korpset.
 */
async function candidates(): Promise<{
  members: ProjectRecipient[]
  prefs: Map<string, ProjectNotificationChoice>
}> {
  const d = db()
  const [memberRows, prefRows] = await Promise.all([
    d
      .select({
        userId: memberProfiles.authUserId,
        isActive: memberProfiles.isActive,
        email: user.email,
      })
      .from(memberProfiles)
      .innerJoin(user, eq(memberProfiles.authUserId, user.id))
      .orderBy(asc(user.name)),
    d
      .select({ userId: notificationPreferences.userId, projects: notificationPreferences.projects })
      .from(notificationPreferences),
  ])

  return {
    members: memberRows.map((m) => ({ userId: m.userId, email: m.email, isActive: m.isActive })),
    prefs: new Map(prefRows.map((p) => [p.userId, p.projects])),
  }
}

/** Utfallene som allerede står i loggen for denne varseltypen. */
async function alreadyNotified(projectId: string, kind: 'published' | 'update'): Promise<Map<string, Outcome>> {
  const rows = await db()
    .select({ userId: projectNotifications.userId, outcome: projectNotifications.outcome })
    .from(projectNotifications)
    .where(and(eq(projectNotifications.projectId, projectId), eq(projectNotifications.kind, kind)))
  return new Map(rows.map((r) => [r.userId, r.outcome]))
}

/**
 * Tidspunktet forrige ENDRINGSVARSEL gikk ut. Nullpunktet for «hva er nytt».
 *
 * Publiseringsvarselet teller bevisst ikke: det beskriver ikke endringer, og kan
 * derfor ikke stå i stedet for et endringsvarsel. Har det aldri gått ut et
 * endringsvarsel, er nullpunktet publiseringen selv — for `project_changes` får
 * ingen rader før prosjektet er publisert.
 */
async function lastUpdateAt(projectId: string): Promise<Date | null> {
  const rows = await db()
    .select({ sentAt: projectNotifications.sentAt })
    .from(projectNotifications)
    .where(and(eq(projectNotifications.projectId, projectId), eq(projectNotifications.kind, 'update')))
    .orderBy(desc(projectNotifications.sentAt))
    .limit(1)
  return rows[0]?.sentAt ?? null
}

/**
 * Endringene som ikke er varslet om ennå, eldste først.
 *
 * Radene slettes ALDRI etter en utsending — filtreringen skjer på tidspunkt.
 * Historikken er noen få rader per prosjekt, og uten den ville spørsmålet «hva
 * ble det egentlig varslet om 3. november?» vært ubesvarlig i ettertid. Det er
 * nettopp sporbarheten #51 ber om.
 */
async function unnotifiedChanges(projectId: string): Promise<ProjectChange[]> {
  const since = await lastUpdateAt(projectId)
  const rows = await db()
    .select({ kind: projectChanges.kind, subject: projectChanges.subject, detail: projectChanges.detail })
    .from(projectChanges)
    .where(
      since
        ? and(eq(projectChanges.projectId, projectId), gt(projectChanges.createdAt, since))
        : eq(projectChanges.projectId, projectId),
    )
    .orderBy(asc(projectChanges.createdAt))
  return rows
}

// ---------- Statusen prosjektsiden viser ----------

export type ProjectNotifyState = {
  /** Leveringen av publiseringsvarselet. `pending` = mottakere uten rad. */
  published: { sent: number; logged: number; failed: number; pending: number }
  /** Antall mottakere som ville fått et endringsvarsel nå. */
  updateRecipients: number
  /** Når forrige endringsvarsel gikk ut. Null = ingen ennå. */
  lastUpdateAt: number | null
  /** Endringene siden forrige varsel, ferdig formulert og samlet. */
  changeLines: string[]
  /** Endringer som ikke fikk plass i lista. */
  moreChanges: number
  /** Antall endringer summeringen bygger på — tallet «N endringer siden …» viser. */
  changeCount: number
}

/**
 * Alt den som har `projects.manage` trenger for å bestemme seg: hvem som har
 * fått publiseringsvarselet, hvem som mangler det, og hva et endringsvarsel
 * ville sagt akkurat nå. Leseren skal se NØYAKTIG det samme som mottakerne får
 * — ellers er «send oppdateringsvarsel» en knapp man trykker i blinde.
 */
export async function projectNotifyState(projectId: string): Promise<ProjectNotifyState> {
  const [{ members, prefs }, log, changes, since] = await Promise.all([
    candidates(),
    alreadyNotified(projectId, 'published'),
    unnotifiedChanges(projectId),
    lastUpdateAt(projectId),
  ])
  const recipients = projectRecipientsFor(members, prefs)
  const published = { sent: 0, logged: 0, failed: 0, pending: 0 }
  for (const outcome of log.values()) published[outcome] += 1
  published.pending = recipients.filter((r) => !log.has(r.userId)).length

  const summary = summarizeProjectChanges(changes)
  return {
    published,
    updateRecipients: recipients.length,
    lastUpdateAt: since?.getTime() ?? null,
    changeLines: summary.lines,
    moreChanges: summary.more,
    changeCount: summary.total,
  }
}

// ---------- Utsending ----------

/** Sender én ferdig e-post til en liste mottakere og skriver utfallene i loggen. */
async function dispatch(
  projectId: string,
  kind: 'published' | 'update',
  recipients: ProjectRecipient[],
  mail: { subject: string; html: string; text: string },
  skipped: number,
): Promise<ProjectNotifyResult> {
  const result: ProjectNotifyResult = { sent: 0, logged: 0, failed: 0, skipped }
  if (recipients.length === 0) return result

  const outcomes: Array<{ userId: string; outcome: Outcome }> = []
  for (const batch of chunk(recipients, EMAIL_BATCH)) {
    const settled = await Promise.allSettled(
      batch.map((r) => sendEmail({ to: r.email!, subject: mail.subject, html: mail.html, text: mail.text })),
    )
    settled.forEach((res, i) => {
      const outcome: Outcome =
        res.status !== 'fulfilled' ? 'failed' : res.value.ok ? 'sent' : res.value.fallback ? 'logged' : 'failed'
      result[outcome] += 1
      outcomes.push({ userId: batch[i]!.userId, outcome })
    })
  }

  const sentAt = new Date()
  for (const batch of chunk(outcomes, LOG_BATCH)) {
    const rows = batch.map((o) => ({ projectId, userId: o.userId, kind, sentAt, outcome: o.outcome }))
    const insert = db().insert(projectNotifications).values(rows)
    // De to typene skriver BEVISST ulikt, og det er hele forskjellen mellom dem:
    //
    // - `published`: raden ER sperren mot dobbeltsending. Finnes den, skal den
    //   stå urørt — vi kommer bare hit for mottakere uten rad, så en konflikt er
    //   et kappløp, og da er den eksisterende raden svaret.
    // - `update`: gjentakende av natur. Nytt tidspunkt og nytt utfall hver runde;
    //   det er `sent_at` som definerer hva «siden forrige varsel» betyr.
    await (kind === 'published'
      ? insert.onConflictDoNothing()
      : insert.onConflictDoUpdate({
          target: [projectNotifications.projectId, projectNotifications.userId, projectNotifications.kind],
          set: { sentAt, outcome: sql`excluded.outcome` },
        }))
  }
  return result
}

/**
 * Publiseringsvarselet (#18) — og «send på nytt», som er nøyaktig det samme
 * kallet. Idempotensen ligger i loggen, ikke i en flagg-kolonne: e-posten går
 * KUN til mottakere som mangler en `published`-rad. Avpubliser og publiser på
 * nytt så mange ganger du vil; ingen får den to ganger.
 */
export async function notifyProjectPublished(projectId: string): Promise<ProjectNotifyResult> {
  const d = db()
  const project = (await d.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
  if (!project) throw new Error('Fant ikke prosjektet')
  // Et utkast varsler aldri. Publiseringen er hele premisset for e-posten.
  if (!project.isPublished) return { sent: 0, logged: 0, failed: 0, skipped: 0 }

  const [{ members, prefs }, log, workCount] = await Promise.all([
    candidates(),
    alreadyNotified(projectId, 'published'),
    d
      .select({ n: sql<number>`count(*)` })
      .from(projectWorks)
      .where(eq(projectWorks.projectId, projectId))
      .then((rows) => rows[0]?.n ?? 0),
  ])

  const recipients = projectRecipientsFor(members, prefs)
  const pending = recipients.filter((r) => !log.has(r.userId))
  const mail = projectPublishedEmail({
    name: project.name,
    kindLabel: projectKindLabel(project.kind),
    eventDate: project.eventDate,
    venue: project.venue,
    workCount,
    url: projectUrl(projectId),
    myNotesUrl: myNotesUrl(),
  })
  return dispatch(projectId, 'published', pending, mail, recipients.length - pending.length)
}

/**
 * Endringsvarselet (#51). Går til ALLE som skal ha prosjektvarsler — ikke bare
 * dem uten rad: en endring er ny hver gang, og det er `sent_at` som flyttes.
 *
 * Sender ingenting når det ikke er noe å si. En «varsle»-knapp som sender en tom
 * e-post er verre enn en knapp som ikke gjør noe.
 */
export async function notifyProjectUpdate(projectId: string): Promise<ProjectNotifyResult & { changes: number }> {
  const project = (await db().select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
  if (!project) throw new Error('Fant ikke prosjektet')
  if (!project.isPublished) throw new Error('Prosjektet er ikke publisert — det er ingen å varsle ennå')

  const changes = await unnotifiedChanges(projectId)
  const summary = summarizeProjectChanges(changes)
  if (summary.lines.length === 0) {
    return { sent: 0, logged: 0, failed: 0, skipped: 0, changes: 0 }
  }

  const { members, prefs } = await candidates()
  const recipients = projectRecipientsFor(members, prefs)
  const mail = projectUpdateEmail({
    name: project.name,
    eventDate: project.eventDate,
    lines: summary.lines,
    more: summary.more,
    url: projectUrl(projectId),
    myNotesUrl: myNotesUrl(),
  })
  const result = await dispatch(projectId, 'update', recipients, mail, 0)
  return { ...result, changes: summary.total }
}
