import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Button, EmptyState, Field, Kicker, Stamp } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
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

function DownloadsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const hasFilter = Boolean(
    search.projectId || search.workId || search.userId || search.shareLinkId || search.from || search.to,
  )
  const projectName = new Map(data.options.projects.map((p) => [p.id, p.name]))

  const setFilter = (patch: Partial<Search>) =>
    navigate({ search: { ...search, ...patch, page: undefined }, replace: true })
  const goToPage = (page: number) => navigate({ search: { ...search, page: page > 1 ? page : undefined } })

  // Clampes så en håndskrevet ?page= utenfor rekkevidde ikke viser «101–4 av 4»
  const first = Math.min((data.page - 1) * data.pageSize + 1, data.total)
  const last = Math.min(data.page * data.pageSize, data.total)

  return (
    <div className="space-y-7">
      <header className="rise">
        <Kicker className="mb-2">Administrasjon</Kicker>
        <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Filtilganger</h1>
        <p className="mt-2 text-sm text-ink-soft">Hvem som har vist eller lastet ned filer fra arkivet.</p>
      </header>

      <div className="rise grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" style={{ animationDelay: '80ms' }}>
        <Field label="Prosjekt">
          <select
            className="field-input"
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
            className="field-input"
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
            className="field-input"
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
            className="field-input"
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
            className="field-input"
            value={search.from ?? ''}
            onChange={(e) => setFilter({ from: e.target.value || undefined })}
          />
        </Field>
        <Field label="Til">
          <input
            type="date"
            className="field-input"
            value={search.to ?? ''}
            onChange={(e) => setFilter({ to: e.target.value || undefined })}
          />
        </Field>
      </div>

      {data.rows.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '140ms' }}>
          <EmptyState title={hasFilter ? 'Ingen treff på filteret' : 'Ingen filtilganger ennå'}>
            {hasFilter
              ? 'Prøv å fjerne eller justere ett av filtrene.'
              : 'Når noen viser eller laster ned en fil fra arkivet, dukker det opp her.'}
          </EmptyState>
        </div>
      ) : (
        <div
          className="rise sheet relative overflow-x-auto overscroll-x-contain after:pointer-events-none after:absolute after:inset-y-px after:right-px after:w-8 after:rounded-r-[13px] after:bg-gradient-to-l after:from-[var(--paper-raised)] after:to-transparent md:after:hidden"
          style={{ animationDelay: '140ms' }}
        >
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                  Tidspunkt
                </th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                  Hvem
                </th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                  Tilgang
                </th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                  Verk
                </th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                  Fil
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="hairline-row">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.72rem] text-ink-soft sm:px-5">
                    {formatDateTime(r.at)}
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    {r.userName ? (
                      <span className="font-medium text-ink">{r.userName}</span>
                    ) : r.shareLinkId ? (
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink">{r.shareRecipient ?? 'Ukjent vikar'}</span>
                        <Stamp tone="oxblood">vikar</Stamp>
                      </span>
                    ) : (
                      <span className="text-ink-faint">Slettet bruker</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                    <Stamp tone={r.accessType === 'download' ? 'brass' : 'neutral'}>
                      {r.accessType === 'download' ? 'nedlasting' : 'visning'}
                    </Stamp>
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <Link
                      to="/arkiv/$workId"
                      params={{ workId: r.workId }}
                      className="link-quiet font-medium text-ink transition-colors hover:text-brass-strong"
                    >
                      {r.workTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-ink-soft">{fileLabel(r)}</span>
                      <span className="font-mono text-[0.64rem] text-ink-faint">{r.fileName}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint">
          {data.total === 0 ? '0 filtilganger' : `Viser ${first}–${last} av ${data.total}`}
        </p>
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
    </div>
  )
}
