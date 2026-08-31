import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { BoardChat } from '../../../components/BoardChat'
import { BoardTaskRowItem, QuickAddTask } from '../../../components/BoardTasks'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../../components/ui'
import {
  BOARD_PROJECT_STATUSES,
  BOARD_PROJECT_STATUS_LABEL,
  type BoardProjectStatus,
  type BoardTaskStatus,
  isProjectOverdue,
  projectProgress,
} from '../../../lib/board'
import { formatDate } from '../../../lib/format'
import {
  createTask,
  deleteBoardProject,
  getBoardProject,
  searchProjectsForTask,
  setTaskStatus,
  updateBoardProject,
} from '../../../server/board'

export const Route = createFileRoute('/styre/prosjekter/$boardProjectId')({
  loader: ({ params }) => getBoardProject({ data: { id: params.boardProjectId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne prosjektet">{error.message}</EmptyState>,
  component: BoardProjectPage,
})

function BoardProjectPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const p = data.project

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const progress = projectProgress(p.doneTasks, p.totalTasks)
  const overdue = isProjectOverdue(p, data.today)

  const setStatus = async (id: string, status: BoardTaskStatus) => {
    try {
      await setTaskStatus({ data: { id, status } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  const setProjectStatus = async (status: BoardProjectStatus) => {
    try {
      await updateBoardProject({ data: { id: p.id, status } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <div className="space-y-9">
      <header className="rise">
        <Link
          to="/styre/prosjekter"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Prosjekter
        </Link>

        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>Styreprosjekt</Kicker>
              {overdue && <Stamp tone="oxblood">Forfalt</Stamp>}
              {p.status !== 'active' && <Stamp>{BOARD_PROJECT_STATUS_LABEL[p.status]}</Stamp>}
            </div>
            <h1 className="display-title mt-2 break-words text-[clamp(2rem,5.5vw,3.4rem)] font-semibold italic leading-[1.05] text-ink">
              {p.title}
            </h1>
            {p.goal && <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">{p.goal}</p>}
            <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
              {p.ownerName ?? 'Ingen ansvarlig'}
              {p.dueDate ? ` · frist ${formatDate(p.dueDate)}` : ''}
            </p>
            {p.linkedProjectId && p.linkedProjectName && (
              <p className="mt-2 text-xs text-ink-soft">
                Konsert:{' '}
                <Link
                  to="/noter/prosjekter/$projectId"
                  params={{ projectId: p.linkedProjectId }}
                  className="link-brass"
                >
                  {p.linkedProjectName}
                </Link>
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Rediger</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-paper-sunken" aria-hidden>
            <div className="h-full rounded-full bg-brass transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
            {progress.label}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {BOARD_PROJECT_STATUSES.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={p.status === status ? 'primary' : 'secondary'}
              onClick={() => setProjectStatus(status)}
            >
              {BOARD_PROJECT_STATUS_LABEL[status]}
            </Button>
          ))}
        </div>

        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <h2 className="kicker mb-3">Oppgaver</h2>
        <div className="mb-3">
          <QuickAddTask
            placeholder="Ny oppgave i dette prosjektet"
            onCreate={async (title) => {
              try {
                await createTask({ data: { title, boardProjectId: p.id } })
                toast('Oppgaven er lagt til')
                await router.invalidate()
              } catch (err) {
                toastError(err)
              }
            }}
          />
        </div>

        {data.open.length + data.inProgress.length + data.done.length === 0 ? (
          <div className="sheet">
            <EmptyState title="Ingen oppgaver i prosjektet">
              Del opp arbeidet i det som faktisk må gjøres — så ser dere fremdriften.
            </EmptyState>
          </div>
        ) : (
          <div className="space-y-6">
            {data.open.length > 0 && (
              <div>
                <h3 className="kicker mb-2">Åpne</h3>
                <ul className="sheet overflow-hidden">
                  {data.open.map((task) => (
                    <BoardTaskRowItem
                      key={task.id}
                      task={task}
                      today={data.today}
                      hideBoardProject
                      onToggle={(status) => setStatus(task.id, status)}
                    />
                  ))}
                </ul>
              </div>
            )}
            {data.inProgress.length > 0 && (
              <div>
                <h3 className="kicker mb-2">Pågår</h3>
                <ul className="sheet overflow-hidden">
                  {data.inProgress.map((task) => (
                    <BoardTaskRowItem
                      key={task.id}
                      task={task}
                      today={data.today}
                      hideBoardProject
                      onToggle={(status) => setStatus(task.id, status)}
                    />
                  ))}
                </ul>
              </div>
            )}
            {data.done.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowDone((v) => !v)}
                  className="kicker mb-2 flex cursor-pointer items-center gap-2 transition-colors hover:text-brass-strong"
                  aria-expanded={showDone}
                >
                  Ferdig ({data.done.length})
                  <span aria-hidden>{showDone ? '−' : '+'}</span>
                </button>
                {showDone && (
                  <ul className="sheet overflow-hidden">
                    {data.done.map((task) => (
                      <BoardTaskRowItem
                        key={task.id}
                        task={task}
                        today={data.today}
                        hideBoardProject
                        onToggle={(status) => setStatus(task.id, status)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rise" style={{ animationDelay: '160ms' }}>
        <h2 className="kicker mb-3">Prosjekttråd</h2>
        <BoardChat
          channel={data.channel}
          meId={data.meId}
          emptyTitle="Ingen meldinger i tråden"
          emptyBody="Diskuter prosjektet her i stedet for i en chat ingen finner igjen."
          onRead={() => router.invalidate()}
        />
      </section>

      <EditBoardProjectModal
        open={editing}
        onClose={() => setEditing(false)}
        project={p}
        assignees={data.assignees}
        onSaved={() => router.invalidate()}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette prosjektet?">
        <p className="text-sm text-ink-soft">
          «{p.title}» og prosjekttråden forsvinner. Oppgavene blir liggende, men mister koblingen til
          prosjektet. Vil du bare rydde bort prosjektet, kan du arkivere det i stedet.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await deleteBoardProject({ data: { id: p.id } })
                toast('Prosjektet er slettet')
                await router.invalidate()
                router.navigate({ to: '/styre/prosjekter' })
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

function EditBoardProjectModal({
  open,
  onClose,
  project,
  assignees,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  project: {
    id: string
    title: string
    goal: string | null
    dueDate: string | null
    ownerUserId: string | null
    linkedProjectId: string | null
    linkedProjectName: string | null
  }
  assignees: Array<{ id: string; name: string; isBoard: boolean }>
  onSaved: () => Promise<void> | void
}) {
  const [title, setTitle] = useState(project.title)
  const [goal, setGoal] = useState(project.goal ?? '')
  const [dueDate, setDueDate] = useState(project.dueDate ?? '')
  const [owner, setOwner] = useState(project.ownerUserId ?? '')
  const [linkedId, setLinkedId] = useState(project.linkedProjectId)
  const [linkedName, setLinkedName] = useState(project.linkedProjectName)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(project.title)
    setGoal(project.goal ?? '')
    setDueDate(project.dueDate ?? '')
    setOwner(project.ownerUserId ?? '')
    setLinkedId(project.linkedProjectId)
    setLinkedName(project.linkedProjectName)
  }, [project])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateBoardProject({
        data: {
          id: project.id,
          title,
          goal: goal.trim() || null,
          dueDate: dueDate || null,
          ownerUserId: owner || null,
          linkedProjectId: linkedId,
        },
      })
      toast('Prosjektet er lagret')
      onClose()
      await onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Rediger prosjektet">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Tittel">
            <input
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </Field>
          <Field label="Mål">
            <textarea className="field-input min-h-24" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ansvarlig">
              <select className="field-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Ingen</option>
                {assignees.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.isBoard ? ' · styret' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frist">
              <input
                type="date"
                className="field-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Konsert" hint="Kobler prosjektet til et prosjekt i noteområdet">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{linkedName ?? 'Ingen kobling'}</span>
              <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
                {linkedId ? 'Endre' : 'Koble'}
              </Button>
              {linkedId && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLinkedId(null)
                    setLinkedName(null)
                  }}
                >
                  Fjern
                </Button>
              )}
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
              Lagre
            </Button>
          </div>
        </form>
      </Modal>

      <ConcertPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setLinkedId(picked.id)
          setLinkedName(picked.name)
          setPickerOpen(false)
        }}
      />
    </>
  )
}

/** Søk i noteområdets prosjekter for å koble styreprosjektet til en konsert. */
function ConcertPickerModal({
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
    <Modal open={open} onClose={onClose} title="Koble til konsert" kicker="Noteområdet">
      <input
        className="field-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Søk etter konsert eller sted"
        aria-label="Søk etter konsert"
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
