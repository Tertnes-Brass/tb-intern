import { chatPlainText } from './chat-format'
import { type MentionUser, mentionPlainText } from './mentions'

/**
 * Ren hjelpelogikk for styreområdet (`/styre`): rekkefølgen på oppgavelista,
 * hva som teller som forfalt, og delingen mellom åpne og ferdige oppgaver.
 * Ingen server- eller DOM-avhengigheter, slik at reglene kan testes uten
 * database — samme mønster som `project-list.ts` og `hub.ts`.
 */

export const BOARD_TASK_STATUSES = ['open', 'in_progress', 'done'] as const
export type BoardTaskStatus = (typeof BOARD_TASK_STATUSES)[number]

export const BOARD_TASK_STATUS_LABEL: Record<BoardTaskStatus, string> = {
  open: 'Åpen',
  in_progress: 'Pågår',
  done: 'Ferdig',
}

/** Oppgave redusert til feltene sorteringen og grupperingen faktisk bruker. */
export type SortableTask = {
  id: string
  status: BoardTaskStatus
  /** ISO-dato, eller null når ingen frist er satt. */
  dueDate: string | null
  title: string
  /** Epoch-ms. Brukes som siste utslagsgiver så rekkefølgen er stabil. */
  createdAt: number
  /** Epoch-ms, satt når status er `done`. */
  completedAt: number | null
}

/**
 * En oppgave er forfalt når den har en frist som er passert og den ikke er
 * ferdig. Sammenlikningen skjer på rene ISO-datoer i norsk tid (`today` kommer
 * fra `toOsloDate`), så «i dag» aldri regnes som forfalt.
 */
export function isOverdue(task: Pick<SortableTask, 'status' | 'dueDate'>, today: string): boolean {
  if (task.status === 'done') return false
  if (!task.dueDate) return false
  return task.dueDate < today
}

/** Åpne før pågående; ferdige helt til slutt. */
const STATUS_RANK: Record<BoardTaskStatus, number> = { open: 0, in_progress: 1, done: 2 }

/**
 * Rekkefølgen i oppgavelista: ikke-ferdige først sortert på frist (tidligst
 * først, uten frist sist), deretter ferdige med sist fullførte øverst.
 * Sorteringen er ikke uttrykkbar som én `ORDER BY` uten å duplisere
 * NULL-håndteringen, og den skal kunne testes — derfor bor den her.
 */
export function sortTasks<T extends SortableTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rank !== 0) return rank

    if (a.status === 'done' && b.status === 'done') {
      // Sist fullførte øverst; mangler tidspunktet, faller vi tilbake på når
      // oppgaven ble laget.
      const byDone = (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)
      if (byDone !== 0) return byDone
      return a.title.localeCompare(b.title, 'nb')
    }

    // Uten frist er oppgaven ikke mindre viktig, men den har ingen plass i
    // fristrekkefølgen — den legges bakerst blant sine egne.
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return a.createdAt - b.createdAt || a.title.localeCompare(b.title, 'nb')
  })
}

export type GroupedTasks<T> = {
  /** Status `open`, i sortert rekkefølge. */
  open: T[]
  /** Status `in_progress`, i sortert rekkefølge. */
  inProgress: T[]
  /** Status `done`, sist fullførte først. */
  done: T[]
  /** Antall åpne/pågående oppgaver som har passert fristen. */
  overdueCount: number
}

/**
 * Deler den sorterte lista i de tre bolkene skjermen viser. Ferdige slås
 * sammen nederst; de er historikk, ikke arbeid.
 */
export function groupTasks<T extends SortableTask>(tasks: T[], today: string): GroupedTasks<T> {
  const sorted = sortTasks(tasks)
  return {
    open: sorted.filter((t) => t.status === 'open'),
    inProgress: sorted.filter((t) => t.status === 'in_progress'),
    done: sorted.filter((t) => t.status === 'done'),
    overdueCount: sorted.filter((t) => isOverdue(t, today)).length,
  }
}

/** «I dag», «I går», «om 3 dager» … til fristmerket på en oppgave. */
export function dueLabel(dueDate: string | null, today: string): string {
  if (!dueDate) return ''
  if (dueDate === today) return 'I dag'
  const days = Math.round(
    (new Date(`${dueDate}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
  )
  if (days === 1) return 'I morgen'
  if (days === -1) return 'I går'
  if (days > 1) return `om ${days} dager`
  return `${-days} dager på overtid`
}

// ---------- Styreprosjekter ----------

export const BOARD_PROJECT_STATUSES = ['active', 'done', 'archived'] as const
export type BoardProjectStatus = (typeof BOARD_PROJECT_STATUSES)[number]

export const BOARD_PROJECT_STATUS_LABEL: Record<BoardProjectStatus, string> = {
  active: 'Aktivt',
  done: 'Ferdig',
  archived: 'Arkivert',
}

export type SortableBoardProject = {
  id: string
  title: string
  status: BoardProjectStatus
  dueDate: string | null
  createdAt: number
  doneTasks: number
  totalTasks: number
}

export type BoardProjectProgress = {
  done: number
  total: number
  /** 0–100, avrundet. Uten oppgaver er den 0 — ikke 100. */
  percent: number
  label: string
}

/**
 * Fremdrift som «n av m oppgaver ferdig». Uten oppgaver er prosjektet ikke
 * ferdig, det er ikke begynt — derfor 0 %, og en egen tekst i stedet for «0 av
 * 0», som ser ut som en feil.
 */
export function projectProgress(done: number, total: number): BoardProjectProgress {
  const safeTotal = Math.max(0, total)
  const safeDone = Math.min(Math.max(0, done), safeTotal)
  return {
    done: safeDone,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeDone / safeTotal) * 100),
    label: safeTotal === 0 ? 'Ingen oppgaver ennå' : `${safeDone} av ${safeTotal} oppgaver ferdig`,
  }
}

/**
 * Et prosjekt er forfalt når fristen er passert og det verken er ferdig eller
 * arkivert — samme regel som for oppgaver, men med to sluttstatuser.
 */
export function isProjectOverdue(
  project: Pick<SortableBoardProject, 'status' | 'dueDate'>,
  today: string,
): boolean {
  if (project.status !== 'active') return false
  if (!project.dueDate) return false
  return project.dueDate < today
}

const PROJECT_STATUS_RANK: Record<BoardProjectStatus, number> = { active: 0, done: 1, archived: 2 }

/**
 * Aktive først på frist (uten frist bakerst), så ferdige, så arkiverte. Ferdige
 * og arkiverte sorteres nyest først — de er historikk man leter i, ikke arbeid.
 */
export function sortBoardProjects<T extends SortableBoardProject>(projectsIn: T[]): T[] {
  return [...projectsIn].sort((a, b) => {
    const rank = PROJECT_STATUS_RANK[a.status] - PROJECT_STATUS_RANK[b.status]
    if (rank !== 0) return rank
    if (a.status !== 'active') {
      return b.createdAt - a.createdAt || a.title.localeCompare(b.title, 'nb')
    }
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return a.createdAt - b.createdAt || a.title.localeCompare(b.title, 'nb')
  })
}

// ---------- Chat ----------

/** Fellesekanalen. Prosjekttråder heter `project:<boardProjectId>`. */
export const GENERAL_CHANNEL = 'general'

/** Kanalnøkkelen for et styreprosjekt. Én sannhetskilde for formatet. */
export function projectChannel(boardProjectId: string): string {
  return `project:${boardProjectId}`
}

/** `project:abc` → `abc`. Alt annet (inkl. fellesekanalen) → null. */
export function channelProjectId(channel: string): string | null {
  return channel.startsWith('project:') ? channel.slice('project:'.length) || null : null
}

/** Kanalnøkkelen for en egendefinert kanal (`board_channels`-raden). */
export function customChannel(channelId: string): string {
  return `custom:${channelId}`
}

/** `custom:abc` → `abc`. Alt annet → null. */
export function channelCustomId(channel: string): string | null {
  return channel.startsWith('custom:') ? channel.slice('custom:'.length) || null : null
}

export type ChannelKind = 'general' | 'project' | 'custom'

/** Kanalnøkkelen tolket: hva slags kanal er dette, og hvem eier den? */
export type ParsedChannel =
  | { kind: 'general'; id: null }
  | { kind: 'project'; id: string }
  | { kind: 'custom'; id: string }

/**
 * Leser en kanalnøkkel. `null` betyr «ikke en gyldig nøkkel» — serveren skal
 * avvise den før den treffer databasen, og dette er den ene regelen begge
 * områdene (styret nå, #81 senere) kan dele uten å dele data.
 */
export function parseChannel(channel: string): ParsedChannel | null {
  if (channel === GENERAL_CHANNEL) return { kind: 'general', id: null }
  const projectId = channelProjectId(channel)
  if (projectId) return { kind: 'project', id: projectId }
  const customId = channelCustomId(channel)
  if (customId) return { kind: 'custom', id: customId }
  return null
}

/** Lengste kanalnavn. Kort nok til å stå i kanallista uten å bli kuttet. */
export const CHANNEL_NAME_MAX = 60

/** Kanalnavn slik det lagres: trimmet, med enkle mellomrom. */
export function normalizeChannelName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

/**
 * Nøkkelen to kanalnavn sammenliknes på. «Uniformer 2027» og «uniformer  2027»
 * er samme kanal for et menneske, og da skal de være det for oss også.
 */
export function channelNameKey(name: string): string {
  return normalizeChannelName(name).toLocaleLowerCase('nb')
}

/** Er navnet brukbart? Tom tekst og for lange navn avvises begge steder. */
export function channelNameError(name: string): string | null {
  const normalized = normalizeChannelName(name)
  if (!normalized) return 'Kanalen må ha et navn'
  if (normalized.length > CHANNEL_NAME_MAX) return `Navnet kan være maks ${CHANNEL_NAME_MAX} tegn`
  return null
}

/** En kanal slik kanallista viser den, uavhengig av hvem som eier dataene. */
export type ChannelSummary = {
  channel: string
  title: string
  kind: ChannelKind
  archived: boolean
  unread: number
  /** Epoch-ms, eller null når kanalen aldri har hatt en melding. */
  lastMessageAt: number | null
  /**
   * Er du OMTALT i en av de uleste? Chatten sender ingen e-post, så dette er
   * eneste måten «noen har spurt deg om noe» skiller seg fra «det er skrevet
   * noe». Utelatt = nei.
   */
  mentionsMe?: boolean
}

/**
 * Prikken på en kanal i lista: tallet, hjelpeteksten og om noen har nevnt deg.
 * `null` betyr ingen prikk — arkiverte kanaler teller aldri (samme regel som
 * `totalUnread`: en prikk man ikke kan lese bort er en prikk ingen stoler på).
 */
export function unreadBadge(channel: {
  unread: number
  archived: boolean
  mentionsMe?: boolean
}): { count: string; label: string; mentioned: boolean } | null {
  if (channel.archived || channel.unread <= 0) return null
  const mentioned = channel.mentionsMe === true
  const messages = channel.unread === 1 ? '1 ulest melding' : `${channel.unread} uleste meldinger`
  return {
    count: channel.unread > 9 ? '9+' : String(channel.unread),
    label: mentioned ? `${messages}, du er nevnt` : messages,
    mentioned,
  }
}

const CHANNEL_KIND_RANK: Record<ChannelKind, number> = { general: 0, project: 1, custom: 2 }

/**
 * Rekkefølgen i kanallista: «Styret» først, så prosjekttrådene, så de
 * egendefinerte — og arkiverte helt til slutt uansett type. Innenfor hver bolk
 * alfabetisk, så lista ikke hopper rundt når noen skriver noe.
 */
export function sortChannels<T extends Pick<ChannelSummary, 'title' | 'kind' | 'archived'>>(channels: T[]): T[] {
  return [...channels].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1
    const kind = CHANNEL_KIND_RANK[a.kind] - CHANNEL_KIND_RANK[b.kind]
    if (kind !== 0) return kind
    return a.title.localeCompare(b.title, 'nb')
  })
}

/**
 * Samlet ulest-teller til områdemenyen. Arkiverte kanaler holdes utenfor: en
 * teller man ikke kan nullstille ved å lese noe, er en teller ingen stoler på.
 */
export function totalUnread(channels: Array<Pick<ChannelSummary, 'archived' | 'unread'>>): number {
  return channels.reduce((sum, c) => (c.archived ? sum : sum + c.unread), 0)
}

/** Lengden på utdraget i en svarreferanse. */
export const REPLY_EXCERPT_MAX = 80

/**
 * Meldingen komprimert til én linje, slik den står i en svarreferanse.
 * Linjeskift blir mellomrom — referansen er ett strekk tekst, ikke et sitat.
 */
export function replyExcerpt(body: string, max = REPLY_EXCERPT_MAX): string {
  const oneLine = body.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  // Kutt på siste ordgrense innenfor grensen, men ikke gjør utdraget til et
  // fragment: uten mellomrom i nærheten kutter vi rått.
  const hard = oneLine.slice(0, max)
  const lastSpace = hard.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard).trimEnd()}…`
}

/**
 * Svarreferansen slik serveren sender den. `deleted` betyr at originalen er
 * borte — svaret skal fortsatt vise at det ER et svar, ellers henger det i
 * løse luften.
 */
export type ChatReply =
  | { deleted: true }
  | { deleted: false; id: string; authorName: string | null; excerpt: string }

/**
 * Svarreferansen ut av en rad fra `listMessages`: originalen når den finnes,
 * «slettet» når `replyToDeleted` er satt, ellers ingen referanse. Ren funksjon
 * fordi den er regelen for hva et svar til en borte melding SKAL vise — og
 * fordi den da kan testes uten database.
 *
 * Utdraget lages av teksten uten backticks og med navn i stedet for
 * omtale-markører: referansen skal leses, ikke vise syntaks — og ingen skal
 * møte `@[u:kd9…]` i en svarreferanse.
 */
export function replyReference(
  row: {
    replyToDeleted: boolean
    replyId: string | null
    replyBody: string | null
    replyAuthorName: string | null
  },
  mentions: Iterable<MentionUser> = [],
): ChatReply | null {
  if (row.replyId) {
    return {
      deleted: false,
      id: row.replyId,
      authorName: row.replyAuthorName,
      excerpt: replyExcerpt(mentionPlainText(chatPlainText(row.replyBody ?? ''), mentions)),
    }
  }
  return row.replyToDeleted ? { deleted: true } : null
}

export type ChatMessage = {
  id: string
  authorId: string | null
  authorName: string | null
  body: string
  /** Epoch-ms. */
  createdAt: number
  /** Meldingen dette er et svar på, eller null når det ikke er et svar. */
  replyTo?: ChatReply | null
}

export type ChatDay<T> = {
  /** ISO-dato i norsk tid — nøkkelen dagen grupperes på. */
  date: string
  messages: T[]
}

/**
 * Grupperer meldinger på dag slik de skal vises, med en dagsskillelinje
 * mellom. `dateOf` gjør tidssonen til kallerens ansvar: serveren og klienten
 * skal begge bruke norsk tid, ikke maskinens.
 */
export function groupMessagesByDay<T extends { createdAt: number }>(
  messages: T[],
  dateOf: (ms: number) => string,
): Array<ChatDay<T>> {
  const days: Array<ChatDay<T>> = []
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    const date = dateOf(message.createdAt)
    const last = days[days.length - 1]
    if (last && last.date === date) last.messages.push(message)
    else days.push({ date, messages: [message] })
  }
  return days
}

/**
 * Uleste i en kanal: meldinger etter `lastReadAt` som noen andre skrev. Egne
 * meldinger teller aldri — man har lest det man selv nettopp sendte. Uten en
 * lest-rad er alt fra andre ulest.
 */
export function unreadCount(
  messages: Array<{ authorId: string | null; createdAt: number }>,
  lastReadAt: number | null,
  meId: string,
): number {
  return messages.filter((m) => m.authorId !== meId && m.createdAt > (lastReadAt ?? 0)).length
}

/** «3 åpne oppgaver, 1 forfalt» til Styre-kortet på hub-en. */
export function boardAreaNote(input: { openTasks: number; overdue: number }): string | null {
  const { openTasks, overdue } = input
  if (openTasks === 0) return overdue > 0 ? `${overdue} forfalt` : null
  const tasks = openTasks === 1 ? '1 åpen oppgave' : `${openTasks} åpne oppgaver`
  return overdue > 0 ? `${tasks}, ${overdue} forfalt` : tasks
}

// ---------- Varsling om styreoppgaver ----------

/**
 * Varslingsvalget for styreoppgaver: e-post om delegering OG den daglige
 * påminnelsen om forfalte oppgaver, ett valg for begge. Ingen rad i
 * `notification_preferences` = `all`, som er standarden.
 */
export const BOARD_TASK_NOTIFICATION_CHOICES = ['all', 'off'] as const
export type BoardTaskNotificationChoice = (typeof BOARD_TASK_NOTIFICATION_CHOICES)[number]

/** Vil mottakeren ha e-post om styreoppgaver? Manglende valg = ja. */
export function wantsTaskEmail(pref: BoardTaskNotificationChoice | string | null | undefined): boolean {
  return pref !== 'off'
}

/** Én ansvarlig og de forfalte oppgavene hens, i fristrekkefølge. */
export type OverdueGroup<T> = {
  assigneeUserId: string
  tasks: T[]
}

/**
 * Grupperer forfalte oppgaver per ansvarlig — grunnlaget for at hver person får
 * ÉN e-post med alt sitt, ikke én e-post per oppgave. Oppgaver uten ansvarlig
 * faller ut: en påminnelse må ha noen å gå til. «Forfalt» er samme regel som i
 * lista (`isOverdue`), slik at e-posten og skjermen aldri er uenige.
 */
export function overdueByAssignee<T extends SortableTask & { assigneeUserId: string | null }>(
  tasks: T[],
  today: string,
): Array<OverdueGroup<T>> {
  const groups = new Map<string, T[]>()
  for (const task of sortTasks(tasks)) {
    if (!task.assigneeUserId) continue
    if (!isOverdue(task, today)) continue
    const list = groups.get(task.assigneeUserId)
    if (list) list.push(task)
    else groups.set(task.assigneeUserId, [task])
  }
  return [...groups].map(([assigneeUserId, list]) => ({ assigneeUserId, tasks: list }))
}

/**
 * Skal påminnelsene kjøre nå? Maks én gang per kalenderdag (norsk tid).
 * `lastRunDate` er ISO-datoen fra `settings`-raden `board.reminders.lastRunDate`;
 * null = aldri kjørt. En dato fra framtiden (klokken flyttet, eller en rad satt
 * for hånd) blokkerer ikke i det uendelige — vi kjører når datoen er ulik dagens.
 */
export function shouldRunReminders(lastRunDate: string | null | undefined, today: string): boolean {
  return (lastRunDate ?? '') !== today
}
