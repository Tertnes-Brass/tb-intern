import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { account, notificationPreferences, parts, userParts } from '../db/schema'
import { BOARD_TASK_NOTIFICATION_CHOICES, type BoardTaskNotificationChoice } from '../lib/board'
import { MENTION_NOTIFICATION_CHOICES, type MentionNotificationChoice } from '../lib/mentions'
import { type PostNotificationChoice } from '../lib/posts'
import { PROJECT_NOTIFICATION_CHOICES, type ProjectNotificationChoice } from '../lib/project-notify'
import { hasPermission, requireMe } from './access'
import { memberDetailsSchema, readMemberDetails, saveMemberDetails } from './member-details'

export const getMyProfile = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()
  const [details, myParts, allParts, credentialRows, notificationRows] = await Promise.all([
    readMemberDetails(me.id),
    // Hovedstemmen kommer fra stemmetildelingen — profilen viser den, den lager
    // ingen egen kopi av den. `isPrimary` er sannheten om hva som er hovedstemme.
    d
      .select({
        id: parts.id,
        name: parts.nameNo,
        isPrimary: userParts.isPrimary,
        sortOrder: parts.sortOrder,
      })
      .from(userParts)
      .innerJoin(parts, eq(userParts.partId, parts.id))
      .where(eq(userParts.userId, me.id)),
    d
      .select({ id: parts.id, name: parts.nameNo, section: parts.section, parentId: parts.parentId })
      .from(parts)
      .orderBy(asc(parts.sortOrder)),
    d
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, me.id), eq(account.providerId, 'credential')))
      .limit(1),
    d
      .select({
        posts: notificationPreferences.posts,
        boardTasks: notificationPreferences.boardTasks,
        mentions: notificationPreferences.mentions,
        projects: notificationPreferences.projects,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, me.id))
      .limit(1),
  ])

  return {
    name: me.name,
    email: me.email,
    phone: details.phone ?? '',
    interests: details.interests,
    interestsNote: details.interestsNote ?? '',
    otherInstruments: details.otherInstruments ?? '',
    secondaryParts: details.secondaryParts,
    roleNames: me.roles.map((r) => r.name),
    // Hovedstemmen først, deretter øvrige tildelte stemmer i besetningsrekkefølge.
    parts: myParts
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
      .map((part) => ({ id: part.id, name: part.name, isPrimary: part.isPrimary })),
    // Hele besetningen, til bistemme-velgeren. Egne stemmer filtreres bort i UI-et
    // og på nytt server-side i `cleanSecondaryParts` ved lagring.
    allParts,
    hasPassword: credentialRows.length > 0,
    // Ingen rad = alle beskjeder. Standarden er å bli varslet.
    notifyPosts: (notificationRows[0]?.posts ?? 'all') as PostNotificationChoice,
    notifyBoardTasks: (notificationRows[0]?.boardTasks ?? 'all') as BoardTaskNotificationChoice,
    // Omtaler (#83): standarden er på. Blir du spurt om noe direkte, skal du få
    // vite det uten å ha gjort et valg først.
    notifyMentions: (notificationRows[0]?.mentions ?? 'all') as MentionNotificationChoice,
    // Prosjekter (#18 + #51): standarden er på. Et nytt prosjekt og en endring i
    // repertoaret er noe et medlem trenger å vite for å møte forberedt.
    notifyProjects: (notificationRows[0]?.projects ?? 'all') as ProjectNotificationChoice,
    // Valget for styreoppgaver angår bare dem som faktisk får slike oppgaver.
    // Avgjøres her, server-side — UI-et skal aldri utlede rettigheter selv.
    canManageBoard: hasPermission(me, 'board.manage'),
  }
})

/**
 * Varslingsvalget for beskjeder (#28). Raden opprettes først når medlemmet
 * faktisk velger noe; fravær av rad betyr «alle beskjeder».
 */
export const updateMyPostNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ posts: z.enum(['all', 'important', 'off']) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, posts: data.posts })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { posts: data.posts } })
    return { ok: true }
  })

/**
 * Varslingsvalget for styreoppgaver: dekker BÅDE e-posten når noen delegerer en
 * oppgave til deg og den daglige påminnelsen om forfalte frister. Ingen egen
 * rettighetssjekk: har du ikke styreoppgaver, betyr valget ingenting for deg.
 */
export const updateMyBoardTaskNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ boardTasks: z.enum(BOARD_TASK_NOTIFICATION_CHOICES) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, boardTasks: data.boardTasks })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { boardTasks: data.boardTasks },
      })
    return { ok: true }
  })

/**
 * Varslingsvalget for omtaler (#83). Eget valg fordi en direkte omtale er noe
 * annet enn en beskjed til hele korpset: den som har skrudd av beskjedvarslene
 * vil som regel fortsatt vite at noen har spurt hen om noe.
 */
export const updateMyMentionNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ mentions: z.enum(MENTION_NOTIFICATION_CHOICES) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, mentions: data.mentions })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { mentions: data.mentions } })
    return { ok: true }
  })

/**
 * Varslingsvalget for prosjekter (#18 + #51). Dekker BÅDE e-posten når et
 * prosjekt publiseres og oppdateringsvarselet om repertoar og tidsplan — ett
 * valg, av samme grunn som `board_tasks` dekker to e-poster: de kommer fra samme
 * sted og handler om det samme.
 */
export const updateMyProjectNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ projects: z.enum(PROJECT_NOTIFICATION_CHOICES) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, projects: data.projects })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { projects: data.projects } })
    return { ok: true }
  })

/**
 * Selvbetjening for kontaktinfo (#14) og de utvidede profilfeltene (#25).
 * Medlemmet skriver alltid til SIN EGEN rad — `targetUserId` er `me.id`, aldri
 * noe fra payloaden, så et rått kall kan ikke redigere en annens profil.
 *
 * Stemmetildeling er bevisst IKKE med: stemme = tilgang til noter, og den
 * settes fortsatt bare av medlemsansvarlig/seksjonsleder (`updateMemberParts`).
 * Bistemmene her gir ingen filtilgang.
 */
export const updateMyProfileDetails = createServerFn({ method: 'POST' })
  .validator(memberDetailsSchema)
  .handler(async ({ data }) => {
    const me = await requireMe()
    const { changedFields } = await saveMemberDetails({
      targetUserId: me.id,
      actorUserId: me.id,
      action: 'member.profile_updated',
      input: data,
    })
    return { ok: true, changed: changedFields.length > 0 }
  })
