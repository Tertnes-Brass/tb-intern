import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type BoardTaskStatus, dueLabel, isOverdue } from '../lib/board'
import { formatDateShort } from '../lib/format'
import { Button, Stamp } from './ui'

/** Feltene lista trenger — samme form som `BoardTaskRow` i `server/board.ts`. */
export type BoardTaskListItem = {
  id: string
  title: string
  status: BoardTaskStatus
  dueDate: string | null
  assigneeName: string | null
  meetingId: string | null
  meetingTitle: string | null
  projectId: string | null
  projectName: string | null
  boardProjectId: string | null
  boardProjectTitle: string | null
  commentCount: number
}

/**
 * Avkrysningsboksen i lista. Ferdig ↔ åpen, i ett trykk — primærhandlingen i
 * området skal ikke kreve at man åpner oppgaven først.
 */
function TaskCheckbox({
  status,
  busy,
  onToggle,
}: {
  status: BoardTaskStatus
  busy: boolean
  onToggle: () => void
}) {
  const done = status === 'done'
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={done}
      aria-label={done ? 'Merk som ikke ferdig' : 'Merk som ferdig'}
      className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 cursor-pointer place-items-center rounded-[7px] border transition-colors disabled:opacity-50 ${
        done
          ? 'border-brass bg-brass text-paper-raised dark:text-paper'
          : 'border-line-strong text-transparent hover:border-brass hover:text-brass/40'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden>
        <path
          d="M2 7l3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export function BoardTaskRowItem({
  task,
  today,
  onToggle,
  hideMeeting,
  hideBoardProject,
}: {
  task: BoardTaskListItem
  today: string
  onToggle: (status: BoardTaskStatus) => Promise<void>
  /** På møtesiden er møtenavnet allerede overskriften. */
  hideMeeting?: boolean
  /** På prosjektsiden er prosjektnavnet allerede overskriften. */
  hideBoardProject?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const overdue = isOverdue(task, today)
  const done = task.status === 'done'

  const toggle = async () => {
    setBusy(true)
    try {
      await onToggle(done ? 'open' : 'done')
    } finally {
      setBusy(false)
    }
  }

  const meta: string[] = []
  if (task.assigneeName) meta.push(task.assigneeName)
  if (task.projectName) meta.push(task.projectName)
  if (!hideMeeting && task.meetingTitle) meta.push(task.meetingTitle)
  if (task.commentCount > 0) {
    meta.push(task.commentCount === 1 ? '1 kommentar' : `${task.commentCount} kommentarer`)
  }

  return (
    <li className="hairline-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <TaskCheckbox status={task.status} busy={busy} onToggle={toggle} />
      <Link
        to="/styre/$taskId"
        params={{ taskId: task.id }}
        className="link-quiet min-w-0 flex-1"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-[0.95rem] font-medium leading-snug ${done ? 'text-ink-faint line-through' : 'text-ink'}`}>
            {task.title}
          </span>
          {!hideBoardProject && task.boardProjectTitle && (
            <Stamp tone="brass">{task.boardProjectTitle}</Stamp>
          )}
        </span>
        {meta.length > 0 && (
          <span className="mt-0.5 block truncate text-xs text-ink-soft">{meta.join(' · ')}</span>
        )}
      </Link>
      {task.dueDate && !done && (
        <span
          className={`shrink-0 whitespace-nowrap font-mono text-[0.62rem] uppercase tracking-[0.12em] ${
            overdue ? 'text-danger' : 'text-ink-faint'
          }`}
          title={dueLabel(task.dueDate, today)}
        >
          {overdue ? 'Forfalt · ' : ''}
          {formatDateShort(task.dueDate)}
        </span>
      )}
      {task.status === 'in_progress' && (
        <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-brass">Pågår</span>
      )}
    </li>
  )
}

/**
 * Hurtig-opprett: tittel + Enter. Primærhandlingen i området skal kunne gjøres
 * fra første skjerm uten å åpne et skjema (designprinsipper §3 pkt 4).
 */
export function QuickAddTask({
  onCreate,
  placeholder = 'Ny oppgave — skriv og trykk Enter',
}: {
  onCreate: (title: string) => Promise<void>
  placeholder?: string
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = title.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await onCreate(value)
      setTitle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        className="field-input flex-1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        aria-label="Ny oppgave"
      />
      <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
        Legg til
      </Button>
    </form>
  )
}
