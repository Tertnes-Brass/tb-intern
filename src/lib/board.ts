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
