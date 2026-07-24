import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { WorkFormModal } from '../../components/WorkForm'
import { Button, EmptyState, Kicker, Stamp } from '../../components/ui'
import { formatDuration } from '../../lib/format'
import { listWorks } from '../../server/works'

export const Route = createFileRoute('/arkiv/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canBrowseArchive =
      context.me.permissions.includes('*') ||
      context.me.permissions.includes('archive.viewAll') ||
      context.me.permissions.includes('works.manage')
    if (!canBrowseArchive) throw redirect({ to: '/' })
  },
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q ? { q: search.q } : {},
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => listWorks({ data: { q: deps.q } }),
  component: ArchivePage,
})

function GradeDots({ grade }: { grade: number | null }) {
  if (!grade) return <span className="text-ink-faint">—</span>
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Grad ${grade} av 5`} aria-label={`Grad ${grade} av 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`h-[5px] w-[5px] rounded-full ${i < grade ? 'bg-brass' : 'bg-line-strong'}`}
          aria-hidden
        />
      ))}
    </span>
  )
}

function ArchivePage() {
  const data = Route.useLoaderData()
  const { q } = Route.useSearch()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-7">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Biblioteket</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Arkivet</h1>
        </div>
        {data.canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon /> Nytt verk
          </Button>
        )}
      </header>

      <div className="rise flex items-center gap-3" style={{ animationDelay: '80ms' }}>
        <div className="relative max-w-md flex-1">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          >
            <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            defaultValue={q ?? ''}
            placeholder="Søk på tittel, arkivnummer, komponist eller arrangør …"
            className="field-input !pl-9"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              const value = e.target.value
              navigate({ search: { q: value || undefined }, replace: true })
            }}
          />
        </div>
        <p className="hidden font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint sm:block">
          {data.works.length} verk
        </p>
      </div>

      {data.works.length === 0 ? (
        <div className="sheet rise">
          <EmptyState
            title={q ? `Ingen treff på «${q}»` : 'Arkivet er tomt'}
            action={
              data.canManage && !q ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Legg inn første verk
                </Button>
              ) : undefined
            }
          >
            {q ? 'Prøv et annet søkeord — eller sjekk stavemåten.' : 'Legg inn verk, så bygger katalogen seg selv.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="rise sheet divide-y divide-[var(--line)] overflow-hidden" style={{ animationDelay: '140ms' }}>
          {data.works.map((w) => (
            <li key={w.id}>
              <Link
                to="/arkiv/$workId"
                params={{ workId: w.id }}
                className="link-quiet grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-5 py-4 transition-colors hover:bg-paper-sunken/50 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_auto_auto]"
              >
                <span className="min-w-0">
                  <span className="display-title block truncate text-[1.12rem] font-semibold leading-snug">
                    {w.title}
                  </span>
                  {w.subtitle && (
                    <span className="display-title block truncate text-[0.9rem] italic text-ink-soft">
                      {w.subtitle}
                    </span>
                  )}
                  <span className="block truncate text-[0.82rem] text-ink-soft">
                    {[w.composer, w.arranger ? `arr. ${w.arranger}` : null].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <span className="hidden min-w-0 items-center gap-2 sm:flex">
                  {w.genre && <Stamp>{w.genre}</Stamp>}
                </span>
                <span className="hidden flex-col items-end gap-1 sm:flex">
                  <GradeDots grade={w.grade} />
                  <span className="tabular font-mono text-[0.66rem] text-ink-faint">
                    {formatDuration(w.durationSec) || '—'}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className={`font-mono text-[0.66rem] uppercase tracking-[0.1em] ${
                      w.counts.parts > 0 ? 'text-ink-soft' : 'text-oxblood'
                    }`}
                  >
                    {w.counts.parts > 0 ? `${w.counts.parts} stemmer` : 'mangler noter'}
                  </span>
                  {w.physicalLocation && (
                    <span className="hidden font-mono text-[0.62rem] text-ink-faint md:block">{w.physicalLocation}</span>
                  )}
                  {w.archiveNumber && (
                    <span className="font-mono text-[0.62rem] text-ink-faint">Arkivnr. {w.archiveNumber}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <WorkFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async (id) => {
          setCreating(false)
          await router.invalidate()
          router.navigate({ to: '/arkiv/$workId', params: { workId: id } })
        }}
      />
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
