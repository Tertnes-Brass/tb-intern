import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ProjectFormModal } from '../../../components/ProjectForm'
import { Button, EmptyState, Field, Kicker, Stamp } from '../../../components/ui'
import { formatDate, relativeDays } from '../../../lib/format'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_KINDS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
  type ProjectSearch,
  type ProjectSort,
  type ProjectStatus,
  isUpcoming,
  parseProjectSearch,
  pickAllowed,
} from '../../../server/project-list'
import { listProjects } from '../../../server/projects'

export const Route = createFileRoute('/noter/prosjekter/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  validateSearch: (search: Record<string, unknown>): ProjectSearch => parseProjectSearch(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listProjects({ data: deps }),
  component: ProjectsPage,
})

const KIND_LABEL: Record<string, string> = {
  konsert: 'Konsert',
  konkurranse: 'Konkurranse',
  seminar: 'Seminar',
  annet: 'Annet',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  kommende: 'Kommende',
  tidligere: 'Tidligere',
}

const SORT_LABEL: Record<ProjectSort, string> = {
  standard: 'Kommende først',
  'dato-stigende': 'Dato — eldste først',
  'dato-synkende': 'Dato — nyeste først',
}

function ProjectsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const hasFilter = Boolean(search.kind || search.status || search.sort)
  // Filtrene ligger i URL-en, så en visning kan deles og bokmerkes.
  const setFilter = (patch: Partial<ProjectSearch>) => navigate({ search: { ...search, ...patch }, replace: true })
  const clearFilter = () => navigate({ search: {}, replace: true })

  return (
    <div className="space-y-9">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Sesongene</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Prosjekter</h1>
        </div>
        {data.canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Nytt prosjekt
          </Button>
        )}
      </header>

      {/* Skjules bare når arkivet faktisk er tomt — ikke når filteret er det */}
      {(data.count > 0 || hasFilter) && (
        <div className="rise space-y-3" style={{ animationDelay: '80ms' }}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Prosjekttype">
              <select
                className="field-input"
                value={search.kind ?? ''}
                onChange={(e) => setFilter({ kind: pickAllowed(e.target.value, PROJECT_KINDS) })}
              >
                <option value="">Alle typer</option>
                {PROJECT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Periode">
              <select
                className="field-input"
                value={search.status ?? ''}
                onChange={(e) => setFilter({ status: pickAllowed(e.target.value, PROJECT_STATUSES) })}
              >
                <option value="">Alle perioder</option>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sortering" className="col-span-2 sm:col-span-1">
              <select
                className="field-input"
                value={search.sort ?? DEFAULT_PROJECT_SORT}
                onChange={(e) => setFilter({ sort: pickAllowed(e.target.value, PROJECT_SORTS) })}
              >
                {PROJECT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint">
              {data.count === 1 ? '1 prosjekt' : `${data.count} prosjekter`}
            </p>
            {hasFilter && (
              <Button size="sm" variant="ghost" onClick={clearFilter}>
                Nullstill
              </Button>
            )}
          </div>
        </div>
      )}

      {data.count === 0 ? (
        <div className="sheet rise">
          {hasFilter ? (
            <EmptyState
              title="Ingen prosjekter i dette utvalget"
              action={
                <Button variant="secondary" onClick={clearFilter}>
                  Nullstill filteret
                </Button>
              }
            >
              Prøv en annen prosjekttype eller periode.
            </EmptyState>
          ) : (
            <EmptyState
              title="Ingen prosjekter ennå"
              action={
                data.canManage ? (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Opprett det første
                  </Button>
                ) : undefined
              }
            >
              Prosjekter samler repertoar, noter og deling for en konsert eller konkurranse.
            </EmptyState>
          )}
        </div>
      ) : (
        data.seasons.map((season, si) => (
          <section key={season.name} className="rise" style={{ animationDelay: `${140 + si * 60}ms` }}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="kicker">{season.name}</h2>
              {!season.hasUpcoming && <Stamp>avholdt</Stamp>}
              <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {season.projects.map((p) => {
                const isPast = !isUpcoming(p.eventDate, today)
                return (
                  <li key={p.id}>
                    <Link
                      to="/noter/prosjekter/$projectId"
                      params={{ projectId: p.id }}
                      className={`sheet sheet-hover link-quiet flex h-full items-center gap-5 px-5 py-4 ${isPast ? 'opacity-75' : ''}`}
                    >
                      <span className="flex w-12 shrink-0 flex-col items-center" aria-hidden>
                        <span className="display-title tabular text-[1.7rem] font-semibold leading-none text-ink">
                          {p.eventDate ? Number(p.eventDate.slice(8, 10)) : '–'}
                        </span>
                        <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-brass">
                          {p.eventDate ? formatDate(p.eventDate).split(' ')[1]?.slice(0, 3) : ''}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="display-title block truncate text-[1.15rem] font-semibold">{p.name}</span>
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          {KIND_LABEL[p.kind] ?? p.kind}
                          {p.venue ? ` · ${p.venue}` : ''} · {p.workCount} verk
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        {!p.isPublished && <Stamp tone="oxblood">Utkast</Stamp>}
                        {!isPast && p.isPublished && (
                          <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-brass">
                            {relativeDays(p.eventDate)}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      <ProjectFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async (id) => {
          setCreating(false)
          await router.invalidate()
          router.navigate({ to: '/noter/prosjekter/$projectId', params: { projectId: id } })
        }}
      />
    </div>
  )
}
