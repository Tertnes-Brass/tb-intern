import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { db } from '../db'
import { leaderChannelReads, leaderChannels, leaderMessages, parts, sectionLeaders, user } from '../db/schema'
import {
  type ChannelKind,
  type ChannelSummary,
  type ChatMessage,
  GENERAL_CHANNEL,
  channelNameError,
  channelNameKey,
  customChannel,
  normalizeChannelName,
  parseChannel,
  replyReference,
  sortChannels,
  totalUnread,
} from '../lib/board'
import { isGroupLeader } from '../lib/gruppeledere'
import { newId } from '../lib/id'
import { SECTION_LABELS, type SectionId } from '../lib/taxonomy'
import { type Me, requireMe } from './access'

/**
 * Gruppelederområdet (`/gruppeledere`, #81): oversikten over hvem som leder hva,
 * og gruppeledernes egen chat.
 *
 * To ting skiller dette fra styreområdet, og begge er bevisste:
 *
 * 1. **Guarden er leiarbindingen** (justert 2. sept 2026, se
 *    src/lib/gruppeledere.ts). `requireGroupLeader()` krever minst én aktiv rad i
 *    `section_leaders`. En admin uten leiarbinding leder ingen gruppe og får
 *    ikke tilgang — se `isGroupLeader` i `src/lib/gruppeledere.ts`. Fordi
 *    `leadsPartIds` leses ferskt i `currentUser()` ved hvert kall, faller
 *    tilgangen bort i samme øyeblikk bindingen fjernes i `/medlemmer`.
 * 2. **Tabellene er egne.** `leader_channels`/`leader_messages`/
 *    `leader_channel_reads` speiler styrets tabeller, men deler ingen rad med
 *    dem. Ingen spørring her rører `board_*`, så en glemt WHERE kan ikke
 *    eksponere styredata. Kanalnøkkelformatet deles (ren logikk i
 *    `src/lib/board.ts`), nøkkelrommene gjør ikke.
 *
 * ALT her — også lesing — går gjennom guarden. `beforeLoad` på ruta er
 * kosmetikk, som ellers i kodebasen.
 */

/** Fellesekanalens navn i dette området. Styret kaller sin «Styret». */
const GENERAL_CHANNEL_TITLE = 'Gruppelederne'

/**
 * Krever en aktiv gruppeleder. Kaster som `requirePermission` gjør — feilen
 * vises som melding i UI-et, og ruta har allerede sendt uvedkommende til `/`.
 *
 * Bevisst IKKE eksportert: rutene importerer serverfunksjonene under herfra, og
 * en levende eksport i denne modulen ville holdt hele modulkroppen i live i
 * klientbygget — og dermed dratt `./access` og `@tanstack/react-start/server`
 * med seg (samme fellen som `post-images.ts` ble skilt ut for). Guarden brukes
 * kun av handlerne her, som strippes fra klienten, og reglen den håndhever er
 * uansett den delte, rene `isGroupLeader`.
 */
async function requireGroupLeader(): Promise<Me> {
  const me = await requireMe()
  if (!isGroupLeader(me)) {
    throw new Error('Gruppelederområdet er for dem som leder en stemmegruppe')
  }
  return me
}

// ---------- Oversikt ----------

export type GroupLeaderRow = {
  userId: string
  name: string
  /** Stemmene hen er bundet til, i besetningens rekkefølge. */
  parts: Array<{ id: string; nameNo: string; section: string }>
  /** Seksjonene stemmene hører til, som lesbare navn uten duplikater. */
  sections: string[]
  isMe: boolean
}

/** Seksjons-id → navnet i taksonomien, med id-en som fallback for egne seksjoner. */
function sectionLabel(section: string): string {
  return SECTION_LABELS[section as SectionId] ?? section
}

/**
 * Hvem som er gruppeleder, og hvilke stemmer/seksjoner de leder. Rådataene er
 * `section_leaders ⨝ user ⨝ parts` — bindingen, ikke rettigheten. Det er med
 * vilje: lista svarer på «hvem har ansvar for hvilken gruppe», og en leder som
 * midlertidig mangler rettigheten er fortsatt den man skal snakke med om
 * 2. kornett. Guarden avgjør hvem som slipper INN; denne lista avgjør hva de ser.
 *
 * Selve stemmetildelingen gjøres i `/medlemmer`; her er den bare lesing.
 */
export const getLeaderOverview = createServerFn().handler(async () => {
  const me = await requireGroupLeader()

  const rows = await db()
    .select({
      userId: sectionLeaders.userId,
      name: user.name,
      partId: parts.id,
      partName: parts.nameNo,
      section: parts.section,
      sortOrder: parts.sortOrder,
    })
    .from(sectionLeaders)
    .innerJoin(user, eq(sectionLeaders.userId, user.id))
    .innerJoin(parts, eq(sectionLeaders.partId, parts.id))
    .orderBy(asc(parts.sortOrder))

  const byUser = new Map<string, GroupLeaderRow & { minSort: number }>()
  for (const row of rows) {
    const leader = byUser.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      parts: [],
      sections: [],
      isMe: row.userId === me.id,
      minSort: row.sortOrder,
    }
    leader.parts.push({ id: row.partId, nameNo: row.partName, section: row.section })
    const label = sectionLabel(row.section)
    if (!leader.sections.includes(label)) leader.sections.push(label)
    byUser.set(row.userId, leader)
  }

  // Rekkefølgen følger besetningen (kornetter før tuba), ikke alfabetet — det er
  // slik en gruppeleder leter etter kollegaen sin. Navnet avgjør uavgjort, så
  // lista står stille mellom lastinger.
  const leaders: GroupLeaderRow[] = [...byUser.values()]
    .sort((a, b) => a.minSort - b.minSort || a.name.localeCompare(b.name, 'nb'))
    .map(({ minSort: _minSort, ...leader }) => leader)
  return { leaders, meId: me.id }
})

// ---------- Chat ----------

/**
 * Kanalene i området: fellesekanalen (som hos styret uten rad noe sted) og de
 * egendefinerte i `leader_channels`. Arkiverte blir med — de skal kunne leses,
 * bare ikke skrives i. Ingen prosjekttråder: gruppelederne har ingen prosjekter
 * i modellen, og en tom kanaltype ville bare vært støy.
 */
async function loadChannels(): Promise<
  Array<{ channel: string; title: string; kind: ChannelKind; archived: boolean }>
> {
  const customRows = await db()
    .select({ id: leaderChannels.id, name: leaderChannels.name, archivedAt: leaderChannels.archivedAt })
    .from(leaderChannels)
    .where(eq(leaderChannels.kind, 'custom'))

  return sortChannels([
    { channel: GENERAL_CHANNEL, title: GENERAL_CHANNEL_TITLE, kind: 'general' as ChannelKind, archived: false },
    ...customRows.map((c) => ({
      channel: customChannel(c.id),
      title: c.name,
      kind: 'custom' as ChannelKind,
      archived: c.archivedAt !== null,
    })),
  ])
}

/**
 * En kanalnøkkel er fellesekanalen eller en egendefinert kanal som FINNES her.
 * Uten sjekken kunne en gruppeleder skrevet i en oppdiktet kanal ingen andre
 * ser — og en `project:`-nøkkel, som ikke finnes i dette området, avvises av
 * samme grunn.
 *
 * `write: true` krever i tillegg at kanalen ikke er arkivert. Arkivering er en
 * myk stenging: historikken skal fortsatt kunne leses, men samtalen er over.
 */
async function assertChannelExists(channel: string, opts: { write?: boolean } = {}): Promise<void> {
  const parsed = parseChannel(channel)
  if (!parsed) throw new Error('Ukjent kanal')
  if (parsed.kind === 'general') return
  if (parsed.kind !== 'custom') throw new Error('Ukjent kanal')

  const row = (
    await db()
      .select({ id: leaderChannels.id, archivedAt: leaderChannels.archivedAt })
      .from(leaderChannels)
      .where(and(eq(leaderChannels.id, parsed.id), eq(leaderChannels.kind, 'custom')))
      .limit(1)
  )[0]
  if (!row) throw new Error('Ukjent kanal')
  if (opts.write && row.archivedAt) throw new Error('Kanalen er arkivert')
}

/** Hvor mye historikk en kanal laster ved åpning. Samme tall som styrechatten. */
const CHAT_PAGE_SIZE = 200

/** Kanallista med uleste. Fellesekanalen først, arkiverte nederst. */
export const listChannels = createServerFn().handler(async () => {
  const me = await requireGroupLeader()
  const d = db()

  const [all, reads, unreadRows] = await Promise.all([
    loadChannels(),
    d.select().from(leaderChannelReads).where(eq(leaderChannelReads.userId, me.id)),
    // Uleste telles i SQL fordi alternativet er å hente HVER melding i hver
    // kanal bare for å telle dem. Regelen er den samme som `unreadCount` i
    // `lib/board.ts`, som klienten bruker til «nye meldinger»-skillet.
    d
      .select({
        channel: leaderMessages.channel,
        n: sql<number>`count(*)`,
        lastAt: sql<number>`max(${leaderMessages.createdAt})`,
      })
      .from(leaderMessages)
      .leftJoin(
        leaderChannelReads,
        and(eq(leaderChannelReads.channel, leaderMessages.channel), eq(leaderChannelReads.userId, me.id)),
      )
      .where(
        and(
          ne(leaderMessages.authorId, me.id),
          or(isNull(leaderChannelReads.lastReadAt), gt(leaderMessages.createdAt, leaderChannelReads.lastReadAt)),
        ),
      )
      .groupBy(leaderMessages.channel),
  ])

  const unreadByChannel = new Map(unreadRows.map((r) => [r.channel, r.n]))
  const lastByChannel = new Map(unreadRows.map((r) => [r.channel, r.lastAt]))
  const readAt = new Map(reads.map((r) => [r.channel, r.lastReadAt.getTime()]))

  const channels: ChannelSummary[] = all.map((c) => ({
    channel: c.channel,
    title: c.title,
    kind: c.kind,
    archived: c.archived,
    unread: unreadByChannel.get(c.channel) ?? 0,
    lastMessageAt: lastByChannel.get(c.channel) ?? readAt.get(c.channel) ?? null,
  }))

  return { channels, totalUnread: totalUnread(channels), meId: me.id }
})

/**
 * Samlet ulest-teller til områdemenyen. Bare kanaler som faktisk står i
 * kanallista teller: en prikk man ikke kan bli kvitt ved å lese noe — fordi
 * kanalen er arkivert — er en prikk ingen stoler på.
 */
export const getChatUnread = createServerFn().handler(async () => {
  const me = await requireGroupLeader()
  const open = (await loadChannels()).filter((c) => !c.archived).map((c) => c.channel)
  if (open.length === 0) return { unread: 0 }

  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(leaderMessages)
    .leftJoin(
      leaderChannelReads,
      and(eq(leaderChannelReads.channel, leaderMessages.channel), eq(leaderChannelReads.userId, me.id)),
    )
    .where(
      and(
        inArray(leaderMessages.channel, open),
        ne(leaderMessages.authorId, me.id),
        or(isNull(leaderChannelReads.lastReadAt), gt(leaderMessages.createdAt, leaderChannelReads.lastReadAt)),
      ),
    )
  return { unread: rows[0]?.n ?? 0 }
})

// ---------- Egendefinerte kanaler ----------

/** Navnet er ledig når ingen AKTIV kanal i dette området heter det samme. */
async function assertChannelNameFree(name: string, exceptId?: string): Promise<void> {
  const key = channelNameKey(name)
  const taken = await db()
    .select({ id: leaderChannels.id, name: leaderChannels.name })
    .from(leaderChannels)
    .where(and(eq(leaderChannels.kind, 'custom'), isNull(leaderChannels.archivedAt)))
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
    const me = await requireGroupLeader()
    const name = validChannelName(data.name)
    await assertChannelNameFree(name)
    const id = newId()
    await db().insert(leaderChannels).values({
      id,
      kind: 'custom',
      name,
      createdBy: me.id,
      createdAt: new Date(),
      archivedAt: null,
    })
    return { id, channel: customChannel(id) }
  })

export const renameChannel = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), name: channelName }))
  .handler(async ({ data }) => {
    await requireGroupLeader()
    const name = validChannelName(data.name)
    await assertChannelNameFree(name, data.id)
    await db()
      .update(leaderChannels)
      .set({ name })
      .where(and(eq(leaderChannels.id, data.id), eq(leaderChannels.kind, 'custom')))
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
    await requireGroupLeader()
    const row = (
      await db()
        .select({ id: leaderChannels.id, name: leaderChannels.name })
        .from(leaderChannels)
        .where(and(eq(leaderChannels.id, data.id), eq(leaderChannels.kind, 'custom')))
        .limit(1)
    )[0]
    if (!row) throw new Error('Ukjent kanal')
    if (!data.archived) await assertChannelNameFree(row.name, row.id)

    await db()
      .update(leaderChannels)
      .set({ archivedAt: data.archived ? new Date() : null })
      .where(eq(leaderChannels.id, data.id))
    return { ok: true }
  })

// ---------- Meldinger ----------

/** Meldingen et svar peker på — eller «slettet», når originalen er borte. */
const replyMessage = alias(leaderMessages, 'reply_message')
const replyAuthor = alias(user, 'reply_author')

/**
 * Meldingene i en kanal. `after` (epoch-ms) gjør pollingen billig: klienten ber
 * bare om det som har kommet siden sist, og får en tom liste når ingenting har
 * skjedd. Uten `after` lastes den siste sida med historikk.
 *
 * Avsendernavnet kommer fra `user`-raden via `author_id`, som består selv om
 * leiarbindingen forsvinner: historikken skal fortsatt kunne leses som en
 * samtale mellom navngitte folk.
 */
export const listMessages = createServerFn()
  .validator(z.object({ channel: z.string().min(1).max(120), after: z.number().int().nonnegative().optional() }))
  .handler(async ({ data }) => {
    const me = await requireGroupLeader()
    await assertChannelExists(data.channel)
    const d = db()

    const rows = await d
      .select({
        id: leaderMessages.id,
        authorId: leaderMessages.authorId,
        authorName: user.name,
        body: leaderMessages.body,
        createdAt: leaderMessages.createdAt,
        replyToDeleted: leaderMessages.replyToDeleted,
        replyId: replyMessage.id,
        replyBody: replyMessage.body,
        replyAuthorName: replyAuthor.name,
      })
      .from(leaderMessages)
      .leftJoin(user, eq(leaderMessages.authorId, user.id))
      .leftJoin(replyMessage, eq(leaderMessages.replyToId, replyMessage.id))
      .leftJoin(replyAuthor, eq(replyMessage.authorId, replyAuthor.id))
      .where(
        and(
          eq(leaderMessages.channel, data.channel),
          data.after !== undefined ? gt(leaderMessages.createdAt, new Date(data.after)) : undefined,
        ),
      )
      // Nyeste først i SQL + limit gir de SISTE meldingene; klienten viser dem
      // kronologisk (groupMessagesByDay sorterer selv).
      .orderBy(desc(leaderMessages.createdAt))
      .limit(CHAT_PAGE_SIZE)

    const messages: ChatMessage[] = rows
      .map((m) => ({
        id: m.id,
        authorId: m.authorId,
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt.getTime(),
        replyTo: replyReference(m),
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
    return { messages, meId: me.id, serverTime: Date.now() }
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
    const me = await requireGroupLeader()
    await assertChannelExists(data.channel, { write: true })
    const d = db()

    let replyToId: string | null = null
    let replyToDeleted = false
    if (data.replyToId) {
      const original = (
        await d
          .select({ id: leaderMessages.id, channel: leaderMessages.channel })
          .from(leaderMessages)
          .where(eq(leaderMessages.id, data.replyToId))
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
    await d.insert(leaderMessages).values({
      id,
      channel: data.channel,
      authorId: me.id,
      body: data.body.trim(),
      replyToId,
      replyToDeleted,
      createdAt,
    })
    return { id, createdAt: createdAt.getTime() }
  })

export const deleteMessage = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireGroupLeader()
    const d = db()
    // Gruppelederne er få: man rydder i sitt eget, ingen moderering utover det.
    const mine = (
      await d
        .select({ id: leaderMessages.id })
        .from(leaderMessages)
        .where(and(eq(leaderMessages.id, data.id), eq(leaderMessages.authorId, me.id)))
        .limit(1)
    )[0]
    if (!mine) return { ok: true }

    // Svarene på meldingen merkes FØR den forsvinner. Fremmednøkkelen
    // nullstiller `reply_to_id` av seg selv, og uten merket ville svaret sett
    // ut som en vanlig melding i stedet for et svar på noe som er borte.
    await d
      .update(leaderMessages)
      .set({ replyToId: null, replyToDeleted: true })
      .where(eq(leaderMessages.replyToId, data.id))
    await d.delete(leaderMessages).where(eq(leaderMessages.id, data.id))
    return { ok: true }
  })

/** Merker kanalen som lest til og med `at` (epoch-ms, som regel serverens tid). */
export const markChannelRead = createServerFn({ method: 'POST' })
  .validator(z.object({ channel: z.string().min(1).max(120), at: z.number().int().nonnegative().optional() }))
  .handler(async ({ data }) => {
    const me = await requireGroupLeader()
    // Lesing, ikke skriving: en arkivert kanal skal kunne leses ferdig.
    await assertChannelExists(data.channel)
    const lastReadAt = new Date(data.at ?? Date.now())
    await db()
      .insert(leaderChannelReads)
      .values({ userId: me.id, channel: data.channel, lastReadAt })
      .onConflictDoUpdate({
        target: [leaderChannelReads.userId, leaderChannelReads.channel],
        // Markøren skal bare gå framover: en treg fane som melder inn en gammel
        // tidsstempel skal ikke gjøre leste meldinger uleste igjen.
        set: { lastReadAt: sql`max(${leaderChannelReads.lastReadAt}, ${lastReadAt.getTime()})` },
      })
    return { ok: true }
  })
