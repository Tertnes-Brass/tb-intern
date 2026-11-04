import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Icon } from '../../components/Icons'
import { BottomSheet, Button, EmptyState, Field, PageHeader } from '../../components/ui'
import { formatDateShort, formatDateTime, formatTime, toOsloDate } from '../../lib/format'
import { listDownloads } from '../../server/downloads'

type Search = {
  page?: number
  projectId?: string
  workId?: string
  userId?: string
  shareLinkId?: string
  from?: string
  to?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

export const Route = createFileRoute('/innstillinger/nedlastinger')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const ok = context.me.permissions.includes('*') || context.me.permissions.includes('downloads.view')
    if (!ok) throw redirect({ to: '/' })
  },
  validateSearch: (search: Record<string, unknown>): Search => {
    const page = Number(search.page)
    const from = str(search.from)
    const to = str(search.to)
    return {
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      projectId: str(search.projectId),
      workId: str(search.workId),
      userId: str(search.userId),
      shareLinkId: str(search.shareLinkId),
      from: from && DATE_RE.test(from) ? from : undefined,
      to: to && DATE_RE.test(to) ? to : undefined,
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listDownloads({ data: { ...deps, page: deps.page ?? 1 } }),
  component: DownloadsPage,
})

type Row = Awaited<ReturnType<typeof listDownloads>>['rows'][number]

function fileLabel(r: Row): string {
  return r.kind === 'score' ? 'Partitur' : r.kind === 'audio' ? (r.label ?? 'Lydfil') : (r.partName ?? 'Uplassert')
}

type Data = Awaited<ReturnType<typeof listDownloads>>

/** «5. nov. 14:30» — kort nok for en rad på telefon; året står i detaljene. */
function shortWhen(ms: number): string {
  return `${formatDateShort(toOsloDate(ms))} ${formatTime(ms)}`
}

function who(r: Row): { name: string; share: boolean; deleted: boolean } {
  if (r.userName) return { name: r.userName, share: false, deleted: false }
  if (r.shareLinkId) return { name: r.shareRecipient ?? 'Ukjent vikar', share: true, deleted: false }
  return { name: 'Slettet bruker', share: false, deleted: true }
}

function DownloadsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)

  const projectName = new Map(data.options.projects.map((p) => [p.id, p.name]))
  const shareProject = new Map(data.options.shares.map((s) => [s.id, projectName.get(s.projectId)]))

  const setFilter = (patch: Partial<Search>) =>
    navigate({ search: { ...search, ...patch, page: undefined }, replace: true })
  const reset = () =>
    navigate({
      search: { page: undefined, projectId: undefined, workId: undefined, userId: undefined, shareLinkId: undefined, from: undefined, to: undefined },
      replace: true,
    })
  const goToPage = (page: number) => navigate({ search: { ...search, page: page > 1 ? page : undefined } })

  // Aktive filtre som brikker — samme mønster som arkivet. Hver brikke fjerner
  // bare sitt filter; alt står fortsatt i URL-en, så lenker inn hit virker.
  const chips: Array<{ key: string; label: string; clear: () => void }> = []
  if (search.projectId)
    chips.push({
      key: 'projectId',
      label: projectName.get(search.projectId) ?? 'Prosjekt',
      clear: () => setFilter({ projectId: undefined }),
    })
  if (search.workId)
    chips.push({
      key: 'workId',
      label: data.options.works.find((w) => w.id === search.workId)?.title ?? 'Verk',
      clear: () => setFilter({ workId: undefined }),
    })
  if (search.userId)
    chips.push({
      key: 'userId',
      label: data.options.members.find((m) => m.id === search.userId)?.name ?? 'Medlem',
      clear: () => setFilter({ userId: undefined }),
    })
  if (search.shareLinkId)
    chips.push({
      key: 'shareLinkId',
      label: `Vikar: ${data.options.shares.find((x) => x.id === search.shareLinkId)?.recipientName ?? 'ukjent'}`,
      clear: () => setFilter({ shareLinkId: undefined }),
    })
  if (search.from) chips.push({ key: 'from', label: `Fra ${formatDateShort(search.from)}`, clear: () => setFilter({ from: undefined }) })
  if (search.to) chips.push({ key: 'to', label: `Til ${formatDateShort(search.to)}`, clear: () => setFilter({ to: undefined }) })
  const hasFilter = chips.length > 0

  // Clampes så en håndskrevet ?page= utenfor rekkevidde ikke viser «101–4 av 4»
  const first = Math.min((data.page - 1) * data.pageSize + 1, data.total)
  const last = Math.min(data.page * data.pageSize, data.total)
  const countText = data.total === 0 ? 'Ingen filtilganger' : `Viser ${first}–${last} av ${data.total}`

  return (
    <div className="space-y-5">
      <PageHeader
        className="rise"
        title="Filtilganger"
        summary="Hvem som har vist eller lastet ned filer fra arkivet."
      />

      {/* Filtrene: rett på siden fra lg (der tabellen også er), ellers bak «Filtrer». */}
      <div className="rise hidden lg:block" style={{ animationDelay: '60ms' }}>
        <div className="grid grid-cols-6 gap-3">
          <FilterFields data={data} search={search} setFilter={setFilter} projectName={projectName} />
        </div>
      </div>

      <div className="rise flex items-center gap-3 lg:hidden" style={{ animationDelay: '60ms' }}>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-haspopup="dialog"
          className={`inline-flex min-h-[2.6rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] border px-3.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${
            hasFilter
              ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
              : 'border-line-strong bg-paper-raised text-ink hover:border-brass'
          }`}
        >
          <Icon name="sliders" size={17} />
          Filtrer
          {hasFilter && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1 text-[0.7rem] font-semibold text-paper-raised dark:text-paper">
              {chips.length}
            </span>
          )}
        </button>
        <p className="min-w-0 truncate text-[0.82rem] text-ink-soft">{countText}</p>
      </div>

      {hasFilter && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.clear}
              aria-label={`Fjern filteret ${c.label}`}
              className="hit inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-brass/50 bg-[var(--brass-soft)] pl-3 pr-2 text-[0.8rem] font-medium text-brass-strong transition-colors hover:border-brass"
            >
              <span className="truncate">{c.label}</span>
              <Icon name="close" size={13} strokeWidth={2} />
            </button>
          ))}
          <button
            type="button"
            onClick={reset}
            className="hit cursor-pointer px-1 text-[0.8rem] text-ink-soft underline-offset-2 hover:text-ink hover:underline"
          >
            Nullstill
          </button>
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="surface-group rise" style={{ animationDelay: '120ms' }}>
          <EmptyState
            title={hasFilter ? 'Ingen treff på filteret' : 'Ingen filtilganger ennå'}
            action={hasFilter ? <Button onClick={reset}>Nullstill filtre</Button> : undefined}
          >
            {hasFilter
              ? 'Prøv å fjerne eller justere ett av filtrene.'
              : 'Når noen viser eller laster ned en fil fra arkivet, dukker det opp her.'}
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Telefon og iPad stående: aktivitetsrader. Trykk for detaljer. */}
          <ul className="rise list-group lg:hidden" style={{ animationDelay: '120ms' }}>
            {data.rows.map((r) => (
              <ActivityRow
                key={r.id}
                r={r}
                shareProject={r.shareLinkId ? shareProject.get(r.shareLinkId) : undefined}
                search={search}
                setFilter={setFilter}
              />
            ))}
          </ul>

          {/* Bred skjerm: tabellen — her er den bedre, for kolonnene kan
              sammenlignes nedover. */}
          <div className="rise surface-group hidden overflow-hidden lg:block" style={{ animationDelay: '120ms' }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Tidspunkt', 'Hvem', 'Tilgang', 'Verk', 'Fil'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-[0.8rem] font-medium text-ink-soft first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const w = who(r)
                  return (
                    <tr key={r.id} className="hairline-row">
                      <td className="whitespace-nowrap py-3 pl-5 pr-4 text-[0.82rem] text-ink-soft">
                        {formatDateTime(r.at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={w.deleted ? 'text-ink-faint' : 'font-medium text-ink'}>{w.name}</span>
                        {w.share && (
                          <span className="block text-[0.8rem] text-oxblood">
                            Vikarlenke{r.shareLinkId && shareProject.get(r.shareLinkId) ? ` · ${shareProject.get(r.shareLinkId)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[0.85rem]">
                        <AccessLabel type={r.accessType} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/noter/arkiv/$workId"
                          params={{ workId: r.workId }}
                          className="link-quiet font-medium text-ink transition-colors hover:text-brass-strong"
                        >
                          {r.workTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-ink-soft">{fileLabel(r)}</span>
                        <span className="block break-all text-[0.78rem] text-ink-faint">{r.fileName}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Under lg står tallet allerede ved «Filtrer». */}
          <p className="hidden text-[0.82rem] text-ink-soft lg:block">{countText}</p>
          {(data.total > data.pageSize || data.page > 1) && (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={data.page <= 1} onClick={() => goToPage(data.page - 1)}>
                Forrige
              </Button>
              <Button size="sm" disabled={data.page * data.pageSize >= data.total} onClick={() => goToPage(data.page + 1)}>
                Neste
              </Button>
            </div>
          )}
        </div>
      )}

      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        label="Filtrer filtilganger"
        header={<p className="display-title mt-2 text-center text-[1.05rem] font-semibold text-ink">Filtrer</p>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FilterFields data={data} search={search} setFilter={setFilter} projectName={projectName} />
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          {hasFilter && (
            <Button variant="ghost" onClick={reset} className="w-full sm:flex-1">
              Nullstill
            </Button>
          )}
          <Button variant="primary" className="w-full sm:flex-1" onClick={() => setFiltersOpen(false)}>
            {data.total === 0 ? 'Ingen treff' : `Vis ${data.total === 1 ? '1 filtilgang' : `${data.total} filtilganger`}`}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

function AccessLabel({ type }: { type: Row['accessType'] }) {
  return type === 'download' ? (
    <span className="font-medium text-brass-strong">Nedlasting</span>
  ) : (
    <span className="text-ink-soft">Visning</span>
  )
}

/**
 * Én filtilgang som en rad: hvem og når øverst, hva under, og vikarlenken som
 * egen linje. Detaljene (fullt tidspunkt, filnavn, snarveier til filtrene)
 * ligger bak et trykk — en `<details>`, så det virker uten JavaScript.
 */
function ActivityRow({
  r,
  shareProject,
  search,
  setFilter,
}: {
  r: Row
  shareProject: string | undefined
  search: Search
  setFilter: (patch: Partial<Search>) => void
}) {
  const w = who(r)
  const quick = 'inline-flex min-h-9 cursor-pointer items-center rounded-full border border-line-strong bg-paper-raised px-3 text-[0.82rem] font-medium text-ink-soft no-underline transition-colors hover:border-brass hover:text-brass-strong pointer-coarse:min-h-11 pointer-coarse:px-3.5'
  return (
    <li>
      <details className="group">
        <summary className="list-row-link flex min-h-14 cursor-pointer list-none items-start gap-3 py-2.5 pl-4 pr-3 sm:pl-5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className={`truncate text-[0.95rem] ${w.deleted ? 'text-ink-faint' : 'font-semibold text-ink'}`}>{w.name}</span>
              <span className="shrink-0 text-[0.8rem] text-ink-soft">{shortWhen(r.at)}</span>
            </span>
            <span className="mt-0.5 block truncate text-[0.88rem] text-ink">
              <AccessLabel type={r.accessType} /> · {fileLabel(r)} · {r.workTitle}
            </span>
            {w.share && (
              <span className="mt-0.5 block truncate text-[0.8rem] text-oxblood">
                Vikarlenke{shareProject ? ` · ${shareProject}` : ''}
              </span>
            )}
          </span>
          <Icon name="chevronRight" size={16} className="mt-1 text-ink-faint transition-transform duration-150 group-open:rotate-90" />
        </summary>
        <div className="admin-subrows space-y-3 py-3 pl-4 pr-4 sm:pl-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.85rem]">
            <dt className="text-ink-soft">Tidspunkt</dt>
            <dd className="text-ink">{formatDateTime(r.at)}</dd>
            <dt className="text-ink-soft">Fil</dt>
            <dd className="break-all text-ink">{r.fileName}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link to="/noter/arkiv/$workId" params={{ workId: r.workId }} className={quick}>
              Åpne verket
            </Link>
            {r.userId && !w.deleted && search.userId !== r.userId && (
              <button type="button" className={quick} onClick={() => setFilter({ userId: r.userId ?? undefined })}>
                Bare {w.name.split(' ')[0]}
              </button>
            )}
            {r.shareLinkId && search.shareLinkId !== r.shareLinkId && (
              <button type="button" className={quick} onClick={() => setFilter({ shareLinkId: r.shareLinkId ?? undefined })}>
                Bare denne vikarlenken
              </button>
            )}
            {search.workId !== r.workId && (
              <button type="button" className={quick} onClick={() => setFilter({ workId: r.workId })}>
                Bare dette verket
              </button>
            )}
          </div>
        </div>
      </details>
    </li>
  )
}

function FilterFields({
  data,
  search,
  setFilter,
  projectName,
}: {
  data: Data
  search: Search
  setFilter: (patch: Partial<Search>) => void
  projectName: Map<string, string>
}) {
  return (
    <>
      <Field label="Prosjekt">
        <select
          className="field-input pointer-coarse:min-h-11"
          value={search.projectId ?? ''}
          onChange={(e) => setFilter({ projectId: e.target.value || undefined })}
        >
          <option value="">Alle</option>
          {data.options.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Verk">
        <select
          className="field-input pointer-coarse:min-h-11"
          value={search.workId ?? ''}
          onChange={(e) => setFilter({ workId: e.target.value || undefined })}
        >
          <option value="">Alle</option>
          {data.options.works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Medlem">
        <select
          className="field-input pointer-coarse:min-h-11"
          value={search.userId ?? ''}
          onChange={(e) => setFilter({ userId: e.target.value || undefined })}
        >
          <option value="">Alle</option>
          {data.options.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vikarlenke">
        <select
          className="field-input pointer-coarse:min-h-11"
          value={search.shareLinkId ?? ''}
          onChange={(e) => setFilter({ shareLinkId: e.target.value || undefined })}
        >
          <option value="">Alle</option>
          {data.options.shares.map((s) => (
            <option key={s.id} value={s.id}>
              {s.recipientName}
              {projectName.has(s.projectId) ? ` — ${projectName.get(s.projectId)}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fra">
        <input
          type="date"
          className="field-input pointer-coarse:min-h-11"
          value={search.from ?? ''}
          onChange={(e) => setFilter({ from: e.target.value || undefined })}
        />
      </Field>
      <Field label="Til">
        <input
          type="date"
          className="field-input pointer-coarse:min-h-11"
          value={search.to ?? ''}
          onChange={(e) => setFilter({ to: e.target.value || undefined })}
        />
      </Field>
    </>
  )
}
