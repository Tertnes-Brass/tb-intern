import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardTaskRowItem, QuickAddTask } from '../../components/BoardTasks'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Kicker, Stamp } from '../../components/ui'
import type { BoardTaskStatus } from '../../lib/board'
import { createTask, listTasks, setTaskStatus } from '../../server/board'

type TaskSearch = { mine?: true }

export const Route = createFileRoute('/styre/')({
  // Filteret ligger i URL-en, så en visning kan bokmerkes og deles i styret.
  validateSearch: (search: Record<string, unknown>): TaskSearch =>
    search.mine === true || search.mine === 'true' ? { mine: true } : {},
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listTasks({ data: { mine: deps.mine } }),
  component: BoardTasksPage,
})

function BoardTasksPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [showDone, setShowDone] = useState(false)

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
      await createTask({ data: { title } })
      toast('Oppgaven er lagt til')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  const active = data.open.length + data.inProgress.length

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Styrearbeidet</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Oppgaver</h1>
        </div>
        <div className="flex items-center gap-2">
          {data.overdueCount > 0 && (
            <Stamp tone="oxblood">
              {data.overdueCount === 1 ? '1 forfalt' : `${data.overdueCount} forfalte`}
            </Stamp>
          )}
          <Button
            size="sm"
            variant={search.mine ? 'primary' : 'secondary'}
            onClick={() => navigate({ search: search.mine ? {} : { mine: true }, replace: true })}
          >
            Mine
          </Button>
        </div>
      </header>

      <div className="rise" style={{ animationDelay: '60ms' }}>
        <QuickAddTask onCreate={create} />
      </div>

      {data.count === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '120ms' }}>
          <EmptyState title={search.mine ? 'Ingen oppgaver på deg' : 'Ingen oppgaver ennå'}>
            {search.mine
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
