import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ProjectFormModal } from '../../../components/ProjectForm'
import { Icon } from '../../../components/Icons'
import { Segmented } from '../../../components/Segmented'
import { Button, EmptyState, PageHeader, Stamp } from '../../../components/ui'
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

  const countLabel = data.count === 1 ? '1 prosjekt' : `${data.count} prosjekter`

  return (
    <div className="space-y-7">
      <PageHeader
        className="rise"
        title="Prosjekter"
        summary={data.count > 0 || hasFilter ? countLabel : undefined}
        action={
          data.canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Nytt prosjekt
            </Button>
          )
        }
      />

      {/* Skjules bare når arkivet faktisk er tomt — ikke når filteret er det */}
      {(data.count > 0 || hasFilter) && (
        <div className="rise flex flex-wrap items-center gap-2.5" style={{ animationDelay: '60ms' }}>
          <Segmented
            label="Periode"
            value={search.status ?? 'alle'}
            options={[{ value: 'alle', label: 'Alle' }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
            onChange={(v) => setFilter({ status: pickAllowed(v, PROJECT_STATUSES) })}
            className="max-sm:w-full max-sm:[&>*]:flex-1"
          />
          <select
            className="field-input compact-select !w-auto min-w-0 max-sm:flex-1"
            aria-label="Prosjekttype"
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
          <select
            className="field-input compact-select !w-auto min-w-0 max-sm:flex-1"
            aria-label="Sortering"
            value={search.sort ?? DEFAULT_PROJECT_SORT}
            onChange={(e) => setFilter({ sort: pickAllowed(e.target.value, PROJECT_SORTS) })}
          >
            {PROJECT_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          {hasFilter && (
            <Button size="sm" variant="ghost" onClick={clearFilter}>
              Nullstill
            </Button>
          )}
        </div>
      )}

      {data.count === 0 ? (
        <div className="surface-group rise">
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
          <section key={season.name} className="rise" style={{ animationDelay: `${100 + si * 50}ms` }}>
            <div className="mb-2 flex items-baseline gap-2.5 px-1">
              <h2 className="text-[0.95rem] font-semibold text-ink">{season.name}</h2>
              {!season.hasUpcoming && <span className="text-xs text-ink-faint">avholdt</span>}
            </div>
            <ul className="list-group">
              {season.projects.map((p) => {
                const isPast = !isUpcoming(p.eventDate, today)
                return (
                  <li key={p.id}>
                    <Link
                      to="/noter/prosjekter/$projectId"
                      params={{ projectId: p.id }}
                      className="list-row-link link-quiet flex min-h-[68px] items-center gap-4 px-4 py-3 sm:gap-5 sm:px-5"
                    >
                      <span className={`flex w-11 shrink-0 flex-col items-center ${isPast ? 'opacity-60' : ''}`} aria-hidden>
                        <span className="display-title tabular text-[1.55rem] font-semibold leading-none text-ink">
                          {p.eventDate ? Number(p.eventDate.slice(8, 10)) : '–'}
                        </span>
                        <span className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-brass">
                          {p.eventDate ? formatDate(p.eventDate).split(' ')[1]?.slice(0, 3) : ''}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`display-title block truncate text-[1.1rem] font-semibold ${isPast ? 'text-ink-soft' : 'text-ink'}`}>
                          {p.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-soft">
                          {KIND_LABEL[p.kind] ?? p.kind}
                          {p.venue ? ` · ${p.venue}` : ''} · {p.workCount} verk
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {!p.isPublished && <Stamp tone="oxblood">Utkast</Stamp>}
                        {!isPast && p.isPublished && (
                          <span className="text-xs font-medium text-brass-strong">{relativeDays(p.eventDate)}</span>
                        )}
                        <Icon name="chevronRight" size={16} className="text-ink-faint" />
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
