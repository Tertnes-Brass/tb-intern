import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../../components/ui'
import { isProjectOverdue, projectProgress } from '../../../lib/board'
import { formatDate } from '../../../lib/format'
import { createBoardProject, listBoardProjects } from '../../../server/board'

export const Route = createFileRoute('/styre/prosjekter/')({
  loader: () => listBoardProjects(),
  component: BoardProjectsPage,
})

function BoardProjectsPage() {
  const data = Route.useLoaderData()
  const [creating, setCreating] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const active = data.projects.filter((p) => p.status === 'active')
  // Ferdige og arkiverte er historikk — de slås sammen nederst, bak ett trykk.
  const closed = data.projects.filter((p) => p.status !== 'active')

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Styrearbeidet</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Prosjekter</h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nytt prosjekt
        </Button>
      </header>

      {data.projects.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '80ms' }}>
          <EmptyState
            title="Ingen styreprosjekter ennå"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Opprett det første
              </Button>
            }
          >
            Et prosjekt samler oppgavene, fremdriften og praten om én sak — jubileum, uniformer eller
            en konsert styret har ansvar for.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-8">
          {active.length === 0 ? (
            <div className="sheet rise" style={{ animationDelay: '80ms' }}>
              <EmptyState title="Ingen aktive prosjekter">
                Alt er ferdig eller arkivert. De ligger nederst.
              </EmptyState>
            </div>
          ) : (
            <ul className="rise grid gap-3" style={{ animationDelay: '80ms' }}>
              {active.map((p) => (
                <ProjectCard key={p.id} project={p} today={data.today} />
              ))}
            </ul>
          )}

          {closed.length > 0 && (
            <section className="rise" style={{ animationDelay: '160ms' }}>
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="kicker mb-2 flex cursor-pointer items-center gap-2 transition-colors hover:text-brass-strong"
                aria-expanded={showClosed}
              >
                Ferdig og arkivert ({closed.length})
                <span aria-hidden>{showClosed ? '−' : '+'}</span>
              </button>
              {showClosed && (
                <ul className="grid gap-3">
                  {closed.map((p) => (
                    <ProjectCard key={p.id} project={p} today={data.today} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      <NewBoardProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

type ProjectListItem = ReturnType<typeof Route.useLoaderData>['projects'][number]

function ProjectCard({ project, today }: { project: ProjectListItem; today: string }) {
  const progress = projectProgress(project.doneTasks, project.totalTasks)
  const overdue = isProjectOverdue(project, today)

  const meta = [
    project.ownerName ?? 'Ingen ansvarlig',
    project.dueDate ? `frist ${formatDate(project.dueDate)}` : null,
    project.linkedProjectName,
  ].filter((v): v is string => Boolean(v))

  return (
    <li>
      <Link
        to="/styre/prosjekter/$boardProjectId"
        params={{ boardProjectId: project.id }}
        className={`sheet sheet-hover link-quiet block px-5 py-4 ${project.status !== 'active' ? 'opacity-80' : ''}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <span className="display-title block truncate text-[1.15rem] font-semibold">{project.title}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-soft">{meta.join(' · ')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {overdue && <Stamp tone="oxblood">Forfalt</Stamp>}
            {project.status === 'done' && <Stamp>Ferdig</Stamp>}
            {project.status === 'archived' && <Stamp>Arkivert</Stamp>}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken" aria-hidden>
            <div
              className="h-full rounded-full bg-brass transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
            {progress.label}
          </span>
        </div>
      </Link>
    </li>
  )
}

function NewBoardProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { id } = await createBoardProject({ data: { title, goal, dueDate: dueDate || null } })
      toast('Prosjektet er opprettet')
      onClose()
      setTitle('')
      setGoal('')
      setDueDate('')
      await router.invalidate()
      router.navigate({ to: '/styre/prosjekter/$boardProjectId', params: { boardProjectId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nytt styreprosjekt">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tittel">
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nye uniformer"
            maxLength={200}
            required
          />
        </Field>
        <Field label="Mål" hint="Én til to setninger om hva som skal være oppnådd">
          <textarea
            className="field-input min-h-24"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Hele korpset i nye jakker før NM."
          />
        </Field>
        <Field label="Frist">
          <input type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
            Opprett
          </Button>
        </div>
      </form>
    </Modal>
  )
}
