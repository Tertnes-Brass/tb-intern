import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardTaskRowItem, QuickAddTask } from '../../components/BoardTasks'
import { toast, toastError } from '../../components/toast'
import { Icon } from '../../components/Icons'
import { Segmented } from '../../components/Segmented'
import { EmptyState, PageHeader } from '../../components/ui'
import type { BoardTaskStatus } from '../../lib/board'
import { createTask, listTasks, setTaskStatus } from '../../server/board'

type TaskSearch = { mine?: true; prosjekt?: string }

export const Route = createFileRoute('/styre/')({
  // Både visningen og prosjektfilteret ligger i URL-en, så en visning kan
  // bokmerkes og deles i styret.
  validateSearch: (search: Record<string, unknown>): TaskSearch => ({
    ...(search.mine === true || search.mine === 'true' ? { mine: true as const } : {}),
    ...(typeof search.prosjekt === 'string' && search.prosjekt ? { prosjekt: search.prosjekt } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listTasks({ data: { mine: deps.mine, boardProjectId: deps.prosjekt } }),
  component: BoardTasksPage,
})

function BoardTasksPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [showDone, setShowDone] = useState(false)

  const mine = search.mine === true

  const setStatus = async (id: string, status: BoardTaskStatus) => {
    try {
      await setTaskStatus({ data: { id, status } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  const create = async (title: string) => {
    try {
      await createTask({
        data: {
          title,
          boardProjectId: search.prosjekt ?? null,
          // I «Mine»-visningen er det underforstått at oppgaven er min.
          assigneeUserId: mine ? data.meId : null,
        },
      })
      toast('Oppgaven er lagt til')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  const active = data.open.length + data.inProgress.length
  const setSearch = (patch: TaskSearch) => navigate({ search: { ...search, ...patch }, replace: true })

  const summary = (
    <>
      {active === 1 ? '1 åpen' : `${active} åpne`}
      {data.overdueCount > 0 && (
        <span className="font-medium text-danger">
          {' · '}
          {data.overdueCount === 1 ? '1 forfalt' : `${data.overdueCount} forfalte`}
        </span>
      )}
    </>
  )

  const list = (tasks: typeof data.open) => (
    <ul className="surface-group overflow-hidden">
      {tasks.map((task) => (
        <BoardTaskRowItem key={task.id} task={task} today={data.today} onToggle={(status) => setStatus(task.id, status)} />
      ))}
    </ul>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        className="rise"
        title={mine ? 'Mine oppgaver' : 'Oppgaver'}
        summary={data.count > 0 ? summary : undefined}
        // To visninger, ikke et filter blant flere: «alt styret skal gjøre» og
        // «det som står på meg» er to forskjellige spørsmål.
        action={
          <Segmented
            label="Visning"
            value={mine ? 'mine' : 'alle'}
            options={[
              { value: 'alle', label: 'Alle' },
              { value: 'mine', label: 'Mine' },
            ]}
            onChange={(v) => setSearch({ mine: v === 'mine' ? true : undefined })}
          />
        }
      >
        {mine && (
          // Én linje, ikke et varselkort: påminnelsen er en opplysning om
          // hvordan området oppfører seg, ikke noe man skal gjøre noe med.
          <p className="-mt-2 text-xs leading-relaxed text-ink-faint">
            Er noe av dette forfalt, får du én e-post om dagen med påminnelse.{' '}
            <Link to="/min-profil" className="underline decoration-line underline-offset-2 hover:text-ink-soft">
              Skru av under Min profil
            </Link>
            .
          </p>
        )}
      </PageHeader>

      <div className="rise flex flex-col gap-2.5 md:flex-row md:items-center" style={{ animationDelay: '60ms' }}>
        <div className="min-w-0 flex-1">
          <QuickAddTask onCreate={create} />
        </div>
        {data.projectOptions.length > 0 && (
          <select
            className="field-input compact-select !w-auto md:max-w-[16rem]"
            aria-label="Prosjekt"
            value={search.prosjekt ?? ''}
            onChange={(e) => navigate({ search: { ...search, prosjekt: e.target.value || undefined }, replace: true })}
          >
            <option value="">Alle prosjekter</option>
            {data.projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {data.count === 0 ? (
        <div className="surface-group rise" style={{ animationDelay: '120ms' }}>
          <EmptyState title={mine ? 'Ingen oppgaver på deg' : 'Ingen oppgaver ennå'}>
            {mine
              ? 'Ingen av styrets oppgaver står på deg akkurat nå.'
              : 'Skriv inn det første styret skal gjøre i feltet over — tittel og Enter holder.'}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-8">
          {active === 0 ? (
            <div className="surface-group rise" style={{ animationDelay: '120ms' }}>
              <EmptyState title="Alt er gjort">Ingen åpne oppgaver igjen. De ferdige ligger nederst.</EmptyState>
            </div>
          ) : (
            // Fra lg (iPad på tvers) står Åpne og Pågår side om side.
            <div
              className={`grid items-start gap-x-6 gap-y-8 ${
                data.open.length > 0 && data.inProgress.length > 0 ? 'lg:grid-cols-2' : ''
              }`}
            >
              {data.open.length > 0 && (
                <section className="rise" style={{ animationDelay: '120ms' }}>
                  <h2 className="group-label">Åpne · {data.open.length}</h2>
                  {list(data.open)}
                </section>
              )}
              {data.inProgress.length > 0 && (
                <section className="rise" style={{ animationDelay: '180ms' }}>
                  <h2 className="group-label">Pågår · {data.inProgress.length}</h2>
                  {list(data.inProgress)}
                </section>
              )}
            </div>
          )}

          {data.done.length > 0 && (
            <section className="rise" style={{ animationDelay: '240ms' }}>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="group-label hit flex cursor-pointer items-center gap-1.5 transition-colors hover:text-ink"
                aria-expanded={showDone}
              >
                Ferdig · {data.done.length}
                <Icon name="chevronRight" size={14} className={`transition-transform ${showDone ? 'rotate-90' : ''}`} />
              </button>
              {showDone && list(data.done)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
