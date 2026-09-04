import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, db } from '../db'
import { socialEvents, socialSignups, user } from '../db/schema'
import { newId } from '../lib/id'
import {
  SOCIAL_COMMENT_MAX,
  SOCIAL_DESCRIPTION_MAX,
  SOCIAL_LOCATION_MAX,
  SOCIAL_STATUSES,
  SOCIAL_TITLE_MAX,
  type SocialCounts,
  type SocialSignupState,
  type SocialStatus,
  canEditSocialEvent,
  normalizeSocialComment,
  sanitizeSocialInput,
  signupState,
  socialCounts,
  splitByCapacity,
  spotsLeft,
} from '../lib/social'
import { type Me, requireMe } from './access'

/**
 * Sosiale arrangement med påmelding (#31): pub etter øving, julebord,
 * fjelltur, dugnad, brettspillkveld.
 *
 * **Hvem kan hva.** Å OPPRETTE krever bare `requireMe()` — altså et aktivt
 * medlem, ingen rettighet. Det er samme valg som veggen (#28) tok: skal
 * plattformen erstatte Facebook-gruppen, må terskelen for å foreslå en fjelltur
 * være like lav der som der. Å REDIGERE eller avlyse er arrangørens eget, pluss
 * moderasjon via `members.manage` (`canEditSocialEvent` i `src/lib/social.ts`).
 * Å SVARE er alltid ens eget svar: `userId` er ikke en parameter i
 * `setMySignup` i det hele tatt, så ingen kan melde på noen andre.
 *
 * **Deltakerlista er åpen for alle medlemmer.** Det er ikke en forglemmelse
 * mot innsynsregelen i oppmøte (#82/#24): der er spørsmålet hvem som IKKE kom
 * på øvelsen, her er det hvem du møter på julebordet. Et sosialt arrangement
 * uten en synlig gjesteliste er en invitasjon uten selskap.
 *
 * **Kun serverfunksjoner og typer eksporteres herfra** — en levende eksport
 * ville dratt `cloudflare:workers` (via `db`) inn i klientbygget, som i
 * `post-images.ts` og `event-meta.ts`. Reglene bor i `src/lib/social.ts`, og
 * lista som `/kalender` og hub-en deler i `social-feed.ts`.
 */

const idSchema = z.string().min(1).max(64)

const draftSchema = z.object({
  // Feltene kuttes uansett i `sanitizeSocialInput`; taket her er bare et vern
  // mot at noen sender inn en megabyte.
  title: z.string().max(SOCIAL_TITLE_MAX * 4),
  description: z.string().max(SOCIAL_DESCRIPTION_MAX * 4).nullable().optional(),
  location: z.string().max(SOCIAL_LOCATION_MAX * 4).nullable().optional(),
  startDate: z.string().max(20),
  startTime: z.string().max(10),
  deadlineDate: z.string().max(20).nullable().optional(),
  capacity: z.string().max(10).nullable().optional(),
})

// ---------- Lesing ----------

/** Et medlem i deltakerlista. Ingen stemme, ingen rolle — dette er ikke besetningen. */
export type SocialParticipant = {
  userId: string
  name: string
  comment: string | null
}

export type SocialEventDetail = {
  id: string
  title: string
  description: string | null
  location: string | null
  /** Epoch-ms. */
  startsAt: number
  signupDeadline: number | null
  capacity: number | null
  cancelled: boolean
  hostUserId: string | null
  hostName: string | null
  canEdit: boolean
  state: SocialSignupState
  counts: SocialCounts
  /** Ledige plasser, eller `null` uten maks antall. */
  spotsLeft: number | null
  my: { status: SocialStatus; comment: string | null } | null
  /** 1-basert plass i køen når du står på venteliste, ellers `null`. */
  myWaitlistPosition: number | null
  going: SocialParticipant[]
  waitlist: SocialParticipant[]
  unsure: SocialParticipant[]
  notAttending: SocialParticipant[]
}

export const getSocialEvent = createServerFn()
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }): Promise<SocialEventDetail> => {
    const me = await requireMe()
    const d = db()

    const event = await loadEvent(d, data.id)
    if (!event) throw new Error('Arrangementet finnes ikke')

    const [hostRows, signupRows] = await Promise.all([
      event.hostUserId
        ? d.select({ name: user.name }).from(user).where(eq(user.id, event.hostUserId)).limit(1)
        : Promise.resolve([]),
      d
        .select({
          userId: socialSignups.userId,
          status: socialSignups.status,
          comment: socialSignups.comment,
          attendingSince: socialSignups.attendingSince,
          name: user.name,
        })
        .from(socialSignups)
        .leftJoin(user, eq(socialSignups.userId, user.id))
        .where(eq(socialSignups.socialEventId, event.id))
        .orderBy(asc(socialSignups.attendingSince)),
    ])

    const rows = signupRows.map((r) => ({
      userId: r.userId,
      status: r.status,
      comment: r.comment,
      attendingSince: r.attendingSince?.getTime() ?? null,
      name: r.name ?? 'Ukjent medlem',
    }))

    const counts = socialCounts(rows, event.capacity)
    const { going, waitlist } = splitByCapacity(
      rows.filter((r) => r.status === 'attending'),
      event.capacity,
    )
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'nb')
    const toParticipant = (r: (typeof rows)[number]): SocialParticipant => ({
      userId: r.userId,
      name: r.name,
      comment: r.comment,
    })
    const mine = rows.find((r) => r.userId === me.id) ?? null
    const myWaitlistIndex = waitlist.findIndex((r) => r.userId === me.id)

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt.getTime(),
      signupDeadline: event.signupDeadline?.getTime() ?? null,
      capacity: event.capacity,
      cancelled: event.cancelledAt !== null,
      hostUserId: event.hostUserId,
      hostName: hostRows[0]?.name ?? null,
      canEdit: canEditSocialEvent(me, event),
      state: signupState(timingOf(event), Date.now()),
      counts,
      spotsLeft: spotsLeft(counts, event.capacity),
      my: mine ? { status: mine.status, comment: mine.comment } : null,
      myWaitlistPosition: myWaitlistIndex === -1 ? null : myWaitlistIndex + 1,
      // Påmeldte og venteliste står i KØ-rekkefølge (det er hele poenget med
      // en venteliste); de to andre listene er alfabetiske.
      going: going.map(toParticipant),
      waitlist: waitlist.map(toParticipant),
      unsure: rows.filter((r) => r.status === 'unsure').sort(byName).map(toParticipant),
      notAttending: rows.filter((r) => r.status === 'not_attending').sort(byName).map(toParticipant),
    }
  })

// ---------- Opprettelse og redigering ----------

/**
 * Alle aktive medlemmer kan opprette. `requireMe()` avviser deaktiverte
 * profiler, og arrangøren settes til den som er innlogget — aldri til en
 * `hostUserId` fra klienten.
 */
export const createSocialEvent = createServerFn({ method: 'POST' })
  .validator(draftSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const me = await requireMe()
    const value = sanitizeSocialInput(data)
    const now = new Date()
    const id = newId()
    await db()
      .insert(socialEvents)
      .values({
        id,
        title: value.title,
        description: value.description,
        location: value.location,
        startsAt: new Date(value.startsAt),
        signupDeadline: value.signupDeadline === null ? null : new Date(value.signupDeadline),
        capacity: value.capacity,
        hostUserId: me.id,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      })
    return { id }
  })

/**
 * Arrangøren eller en moderator. Maks antall kan settes ned selv om flere
 * allerede har svart «kommer» — de som ikke lenger får plass havner nederst på
 * ventelista, i den rekkefølgen de svarte. Ingen mister svaret sitt, og ingen
 * rad røres: fordelingen regnes ved lesing (`splitByCapacity`).
 */
export const updateSocialEvent = createServerFn({ method: 'POST' })
  .validator(draftSchema.extend({ id: idSchema }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const me = await requireMe()
    const d = db()
    const event = await requireEditable(d, data.id, me)
    const value = sanitizeSocialInput(data)
    await d
      .update(socialEvents)
      .set({
        title: value.title,
        description: value.description,
        location: value.location,
        startsAt: new Date(value.startsAt),
        signupDeadline: value.signupDeadline === null ? null : new Date(value.signupDeadline),
        capacity: value.capacity,
        updatedAt: new Date(),
      })
      .where(eq(socialEvents.id, event.id))
    return { ok: true }
  })

/**
 * Avlysning er MYK og kan angres: raden blir stående merket «Avlyst», med
 * påmeldingene i behold. Den som har svart «kommer» skal kunne se hva som ble
 * avlyst — ikke oppdage at arrangementet forsvant fra kalenderen uten et ord.
 * Derfor finnes det ingen sletting her i det hele tatt.
 */
export const setSocialCancelled = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, cancelled: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const me = await requireMe()
    const d = db()
    const event = await requireEditable(d, data.id, me)
    await d
      .update(socialEvents)
      .set({ cancelledAt: data.cancelled ? new Date() : null, updatedAt: new Date() })
      .where(eq(socialEvents.id, event.id))
    return { ok: true }
  })

// ---------- Påmelding ----------

/**
 * Medlemmets eget svar. Kommer / kommer ikke / usikker, med en valgfri
 * kommentar (kosthold, skyss). Siste svar vinner, én rad per medlem per
 * arrangement.
 *
 * `attendingSince` — ventelistens sorteringsnøkkel — settes KUN når svaret går
 * fra noe annet til «kommer», og nullstilles ellers. En som retter kommentaren
 * sin beholder derfor plassen i køen, mens en som melder avbud og ombestemmer
 * seg stiller bakerst. Det er den eneste tolkningen som er rettferdig begge
 * veier, og den er låst av en test i `social.test.ts`.
 *
 * Hva som er lov akkurat nå avgjøres av `signupState`, som er den SAMME
 * funksjonen skjermen bruker til å tegne knappene. Et rått kall møter altså
 * nøyaktig den regelen brukeren ser.
 */
export const setMySignup = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: idSchema,
      status: z.enum(SOCIAL_STATUSES).nullable(),
      comment: z.string().max(SOCIAL_COMMENT_MAX * 4).nullable().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const me = await requireMe()
    const d = db()
    const event = await loadEvent(d, data.id)
    if (!event) throw new Error('Arrangementet finnes ikke')

    const state = signupState(timingOf(event), Date.now())
    if (data.status === null) {
      if (!state.canClear) throw new Error(state.message)
    } else if (!state.allowed.includes(data.status)) {
      throw new Error(state.message)
    }

    const existing = (
      await d
        .select({ status: socialSignups.status, attendingSince: socialSignups.attendingSince })
        .from(socialSignups)
        .where(and(eq(socialSignups.socialEventId, event.id), eq(socialSignups.userId, me.id)))
        .limit(1)
    )[0]

    if (data.status === null) {
      await d
        .delete(socialSignups)
        .where(and(eq(socialSignups.socialEventId, event.id), eq(socialSignups.userId, me.id)))
      return { ok: true }
    }

    const now = new Date()
    const attendingSince =
      data.status !== 'attending'
        ? null
        : existing?.status === 'attending'
          ? (existing.attendingSince ?? now)
          : now
    const comment = normalizeSocialComment(data.comment)

    await d
      .insert(socialSignups)
      .values({
        socialEventId: event.id,
        userId: me.id,
        status: data.status,
        comment,
        attendingSince,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [socialSignups.socialEventId, socialSignups.userId],
        set: { status: data.status, comment, attendingSince, updatedAt: now },
      })
    return { ok: true }
  })

// ---------- Felles ----------

type SocialEventRow = typeof socialEvents.$inferSelect

async function loadEvent(d: Db, id: string): Promise<SocialEventRow | null> {
  const rows = await d.select().from(socialEvents).where(eq(socialEvents.id, id)).limit(1)
  return rows[0] ?? null
}

/** Tidsfeltene `signupState` trenger, som epoch-ms. */
function timingOf(event: SocialEventRow) {
  return {
    startsAt: event.startsAt.getTime(),
    signupDeadline: event.signupDeadline?.getTime() ?? null,
    cancelledAt: event.cancelledAt?.getTime() ?? null,
  }
}

/**
 * Finner arrangementet og krever skriverett på det. «Finnes ikke» og «ikke din»
 * svarer med hver sin melding med vilje: et sosialt arrangement er synlig for
 * alle medlemmer uansett, så det finnes ingen skjult tilværelse å røpe.
 */
async function requireEditable(d: Db, id: string, me: Me): Promise<SocialEventRow> {
  const event = await loadEvent(d, id)
  if (!event) throw new Error('Arrangementet finnes ikke')
  if (!canEditSocialEvent(me, event)) {
    throw new Error('Bare arrangøren kan endre dette arrangementet')
  }
  return event
}
