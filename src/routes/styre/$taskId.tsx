import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { BOARD_TASK_STATUSES, BOARD_TASK_STATUS_LABEL, type BoardTaskStatus, dueLabel, isOverdue } from '../../lib/board'
import { formatDate, formatDateTime } from '../../lib/format'
import {
  addComment,
  deleteComment,
  deleteTask,
  getTask,
  searchProjectsForTask,
  setTaskStatus,
  updateTask,
} from '../../server/board'

export const Route = createFileRoute('/styre/$taskId')({
  loader: ({ params }) => getTask({ data: { id: params.taskId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne oppgaven">{error.message}</EmptyState>,
  component: BoardTaskPage,
})

function BoardTaskPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const task = data.task

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [assignee, setAssignee] = useState(task.assigneeUserId ?? '')
  const [due, setDue] = useState(task.dueDate ?? '')
  const [meetingId, setMeetingId] = useState(task.meetingId ?? '')
  const [projectId, setProjectId] = useState(task.projectId)
  const [projectName, setProjectName] = useState(task.projectName)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)

  // Etter en invalidate kan serveren ha nyere verdier enn skjemaet.
  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description ?? '')
    setAssignee(task.assigneeUserId ?? '')
    setDue(task.dueDate ?? '')
    setMeetingId(task.meetingId ?? '')
    setProjectId(task.projectId)
    setProjectName(task.projectName)
  }, [task])

  const overdue = isOverdue(task, data.today)

  const save = async () => {
    setSaving(true)
    try {
      await updateTask({
        data: {
          id: task.id,
          title,
          description: description.trim() || null,
          assigneeUserId: assignee || null,
          dueDate: due || null,
          meetingId: meetingId || null,
          projectId,
        },
      })
      toast('Oppgaven er lagret')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (status: BoardTaskStatus) => {
    try {
      await setTaskStatus({ data: { id: task.id, status } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  const postComment = async () => {
    const body = comment.trim()
    if (!body) return
    setPosting(true)
    try {
      await addComment({ data: { taskId: task.id, body } })
      setComment('')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-9">
      <header className="rise">
        <Link
          to="/styre"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Oppgaver
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>Oppgave</Kicker>
          {overdue && <Stamp tone="oxblood">Forfalt · {dueLabel(task.dueDate, data.today)}</Stamp>}
          {task.status === 'done' && task.completedAt && (
            <Stamp>Ferdig {formatDateTime(task.completedAt)}</Stamp>
          )}
        </div>
        <h1 className="display-title mt-2 break-words text-[clamp(2rem,5.5vw,3.2rem)] font-semibold italic leading-[1.05] text-ink">
          {task.title}
        </h1>

        <div className="mt-5 flex flex-wrap gap-2">
          {BOARD_TASK_STATUSES.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={task.status === status ? 'primary' : 'secondary'}
              onClick={() => changeStatus(status)}
            >
              {BOARD_TASK_STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <section className="rise sheet space-y-4 p-5 sm:p-6" style={{ animationDelay: '80ms' }}>
        <h2 className="kicker">Detaljer</h2>
        <Field label="Tittel">
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Beskrivelse">
          <textarea
            className="field-input min-h-28"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Hva skal gjøres, og hva er avtalt?"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ansvarlig">
            <select className="field-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Ingen</option>
              {data.assignees.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isBoard ? ' · styret' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frist">
            <input type="date" className="field-input" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Møte">
            <select className="field-input" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
              <option value="">Ikke knyttet til et møte</option>
              {data.meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatDate(m.date)} · {m.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prosjekt" hint="Kobler oppgaven til en konsert i noteområdet">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                {projectName ?? 'Ingen kobling'}
              </span>
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                {projectId ? 'Endre' : 'Koble'}
              </Button>
              {projectId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setProjectId(null)
                    setProjectName(null)
                  }}
                >
                  Fjern
                </Button>
              )}
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Button variant="primary" onClick={save} loading={saving}>
            Lagre
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Slett oppgaven
          </Button>
        </div>
      </section>

      <section className="rise" style={{ animationDelay: '140ms' }}>
        <h2 className="kicker mb-3">Kommentarer</h2>
        {data.comments.length === 0 ? (
          <div className="sheet">
            <EmptyState title="Ingen kommentarer">
              Skriv den første — tråden er stedet styret diskuterer denne oppgaven.
            </EmptyState>
          </div>
        ) : (
          <ul className="sheet mb-3 overflow-hidden">
            {data.comments.map((c) => (
              <li key={c.id} className="hairline-row px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[0.82rem] font-semibold text-ink">{c.authorName ?? 'Ukjent'}</span>
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
                    {formatDateTime(c.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{c.body}</p>
                {c.authorId === data.meId && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await deleteComment({ data: { id: c.id } })
                        await router.invalidate()
                      } catch (err) {
                        toastError(err)
                      }
                    }}
                    className="mt-1 cursor-pointer font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-danger"
                  >
                    Slett
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="sheet mt-3 space-y-3 p-4 sm:p-5">
          <textarea
            className="field-input min-h-20"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Skriv en kommentar…"
            aria-label="Ny kommentar"
          />
          <Button variant="primary" size="sm" onClick={postComment} loading={posting} disabled={!comment.trim()}>
            Kommenter
          </Button>
        </div>
      </section>

      <ProjectPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setProjectId(picked.id)
          setProjectName(picked.name)
          setPickerOpen(false)
        }}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette oppgaven?">
        <p className="text-sm text-ink-soft">
          «{task.title}» og kommentarene på den blir borte. Dette kan ikke angres.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await deleteTask({ data: { id: task.id } })
                toast('Oppgaven er slettet')
                await router.invalidate()
                router.navigate({ to: '/styre' })
              } catch (err) {
                toastError(err)
              }
            }}
          >
            Slett
          </Button>
        </div>
      </Modal>
    </div>
  )
}

/** Søk i prosjektene for å koble oppgaven til en konsert. */
function ProjectPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (project: { id: string; name: string }) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; eventDate: string | null }>>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await searchProjectsForTask({ data: { q } })
        if (!cancelled) setResults(res.projects)
      } catch (err) {
        toastError(err)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, q])

  return (
    <Modal open={open} onClose={onClose} title="Koble til prosjekt" kicker="Noteområdet">
      <input
        className="field-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Søk etter konsert eller sted"
        aria-label="Søk etter prosjekt"
      />
      {results.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">Ingen prosjekter passer søket.</p>
      ) : (
        <ul className="mt-3">
          {results.map((p) => (
            <li key={p.id} className="hairline-row">
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full cursor-pointer px-1 py-2.5 text-left transition-colors hover:text-brass-strong"
              >
                <span className="block text-sm font-medium text-ink">{p.name}</span>
                {p.eventDate && (
                  <span className="block font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
                    {formatDate(p.eventDate)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
