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

export type ChatMessage = {
  id: string
  authorId: string | null
  authorName: string | null
  body: string
  /** Epoch-ms. */
  createdAt: number
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
