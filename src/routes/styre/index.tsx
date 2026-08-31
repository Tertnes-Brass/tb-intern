import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardTaskRowItem, QuickAddTask } from '../../components/BoardTasks'
import { toast, toastError } from '../../components/toast'
import { EmptyState, Field, Kicker, Stamp } from '../../components/ui'
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

  return (
    <div className="space-y-7">
      <header className="rise">
        <Kicker className="mb-2">Styrearbeidet</Kicker>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">
            {mine ? 'Mine oppgaver' : 'Oppgaver'}
          </h1>
          {data.overdueCount > 0 && (
            <Stamp tone="oxblood">
              {data.overdueCount === 1 ? '1 forfalt' : `${data.overdueCount} forfalte`}
            </Stamp>
          )}
        </div>

        {mine && (
          // Én linje, ikke et varselkort: påminnelsen er en opplysning om
          // hvordan området oppfører seg, ikke noe man skal gjøre noe med.
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Er noe av dette forfalt, får du én e-post om dagen med påminnelse.{' '}
            <Link to="/min-profil" className="underline decoration-line underline-offset-2 hover:text-ink-soft">
              Skru av under Min profil
            </Link>
            .
          </p>
        )}

        {/* To visninger, ikke et filter blant flere: «alt styret skal gjøre» og
            «det som står på meg» er to forskjellige spørsmål. */}
        <div className="mt-5 inline-flex rounded-[10px] border border-line bg-paper-raised p-0.5" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!mine}
            onClick={() => navigate({ search: { ...search, mine: undefined }, replace: true })}
            className={`cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[0.82rem] font-medium transition-colors ${
              !mine ? 'bg-[var(--brass-soft)] text-brass-strong' : 'text-ink-soft hover:text-ink'
            }`}
          >
            Alle
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mine}
            onClick={() => setSearch({ mine: true })}
            className={`cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[0.82rem] font-medium transition-colors ${
              mine ? 'bg-[var(--brass-soft)] text-brass-strong' : 'text-ink-soft hover:text-ink'
            }`}
          >
            Mine
          </button>
        </div>
      </header>

      <div className="rise" style={{ animationDelay: '60ms' }}>
        <QuickAddTask onCreate={create} />
      </div>

      {data.projectOptions.length > 0 && (
        <div className="rise max-w-xs" style={{ animationDelay: '80ms' }}>
          <Field label="Prosjekt">
            <select
              className="field-input"
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
          </Field>
        </div>
      )}

      {data.count === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '120ms' }}>
          <EmptyState title={mine ? 'Ingen oppgaver på deg' : 'Ingen oppgaver ennå'}>
            {mine
              ? 'Ingen av styrets oppgaver står på deg akkurat nå.'
              : 'Skriv inn det første styret skal gjøre i feltet over — tittel og Enter holder.'}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-8">
          {active === 0 ? (
            <div className="sheet rise" style={{ animationDelay: '120ms' }}>
              <EmptyState title="Alt er gjort">
                Ingen åpne oppgaver igjen. De ferdige ligger nederst.
              </EmptyState>
            </div>
          ) : (
            <>
              {data.open.length > 0 && (
                <section className="rise" style={{ animationDelay: '120ms' }}>
                  <h2 className="kicker mb-2">Åpne</h2>
                  <ul className="sheet overflow-hidden">
                    {data.open.map((task) => (
                      <BoardTaskRowItem
                        key={task.id}
                        task={task}
                        today={data.today}
                        onToggle={(status) => setStatus(task.id, status)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {data.inProgress.length > 0 && (
                <section className="rise" style={{ animationDelay: '180ms' }}>
                  <h2 className="kicker mb-2">Pågår</h2>
                  <ul className="sheet overflow-hidden">
                    {data.inProgress.map((task) => (
                      <BoardTaskRowItem
                        key={task.id}
                        task={task}
                        today={data.today}
                        onToggle={(status) => setStatus(task.id, status)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {data.done.length > 0 && (
            <section className="rise" style={{ animationDelay: '240ms' }}>
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
                      onToggle={(status) => setStatus(task.id, status)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
