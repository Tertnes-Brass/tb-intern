import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { WorkFormModal } from '../../../components/WorkForm'
import { Button, EmptyState, Field, Kicker, Stamp } from '../../../components/ui'
import { formatDuration } from '../../../lib/format'
import {
  MISSING_KEYS,
  type MissingKey,
  type WorkFilter,
  type WorkSortKey,
  countActiveFilters,
  defaultDirFor,
  parseArchiveSearch,
  resolveWorkFilter,
  serializeArchiveSearch,
} from '../../../lib/work-filter'
import { listWorks } from '../../../server/works'

export const Route = createFileRoute('/noter/arkiv/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canBrowseArchive =
      context.me.permissions.includes('*') ||
      context.me.permissions.includes('archive.viewAll') ||
      context.me.permissions.includes('works.manage')
    if (!canBrowseArchive) throw redirect({ to: '/noter' })
  },
  validateSearch: (search: Record<string, unknown>) => parseArchiveSearch(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listWorks({ data: deps }),
  component: ArchivePage,
})

// UI-tekster for filter og sortering. Retningen får nøkkel-spesifikke navn —
// «A–Å» og «Nyest først» sier mer enn «stigende»/«synkende».
const SORT_LABELS: Record<WorkSortKey, string> = {
  title: 'Tittel',
  composer: 'Komponist',
  grade: 'Grad',
  duration: 'Varighet',
  updated: 'Sist oppdatert',
}

const DIR_LABELS: Record<WorkSortKey, { asc: string; desc: string }> = {
  title: { asc: 'A–Å', desc: 'Å–A' },
  composer: { asc: 'A–Å', desc: 'Å–A' },
  grade: { asc: 'Lettest først', desc: 'Vanskeligst først' },
  duration: { asc: 'Kortest først', desc: 'Lengst først' },
  updated: { asc: 'Eldst først', desc: 'Nyest først' },
}

const MISSING_LABELS: Record<MissingKey, string> = {
  parts: 'Stemmefiler',
  score: 'Partitur',
  audio: 'Lytteeksempel',
}

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
  const search = Route.useSearch()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [creating, setCreating] = useState(false)

  const filter = resolveWorkFilter(search)
  const activeCount = countActiveFilters(filter)

  // Søkefeltet har lokal tilstand så skrivingen ikke venter på ruteren, men
  // synkes fra URL-en slik at «Nullstill» og delte lenker faktisk tømmer det.
  const [text, setText] = useState(filter.q)
  useEffect(() => setText(filter.q), [filter.q])

  // All filtertilstand går gjennom URL-en — da er en filtrert visning delbar.
  const update = (patch: Partial<WorkFilter>) =>
    navigate({ search: serializeArchiveSearch({ ...filter, ...patch }), replace: true })

  const toggleMissing = (key: MissingKey) =>
    update({
      missing: filter.missing.includes(key) ? filter.missing.filter((k) => k !== key) : [...filter.missing, key],
    })

  const reset = () => {
    setText('')
    navigate({ search: {}, replace: true })
  }

  const summary =
    activeCount > 0
      ? `${data.works.length} av ${data.total} verk · ${activeCount} ${activeCount === 1 ? 'filter' : 'filtre'}`
      : `${data.total} verk`

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

      <div className="rise sheet space-y-4 p-4 sm:p-5" style={{ animationDelay: '80ms' }}>
        <div className="relative">
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
            value={text}
            placeholder="Søk på tittel, arkivnummer, komponist eller arrangør …"
            className="field-input !pl-9"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Søk i arkivet"
            onChange={(e) => {
              setText(e.target.value)
              update({ q: e.target.value })
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Komponist">
            <select
              className="field-input"
              value={filter.composer ?? ''}
              onChange={(e) => update({ composer: e.target.value || null })}
            >
              <option value="">Alle</option>
              {data.options.composers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Arrangør">
            <select
              className="field-input"
              value={filter.arranger ?? ''}
              onChange={(e) => update({ arranger: e.target.value || null })}
            >
              <option value="">Alle</option>
              {data.options.arrangers.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sjanger">
            <select
              className="field-input"
              value={filter.genre ?? ''}
              onChange={(e) => update({ genre: e.target.value || null })}
            >
              <option value="">Alle</option>
              {data.options.genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grad">
            <select
              className="field-input"
              value={filter.grade ?? ''}
              onChange={(e) => update({ grade: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Alle</option>
              {data.options.grades.map((g) => (
                <option key={g} value={g}>
                  Grad {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Anskaffet år">
            <select
              className="field-input"
              value={filter.year ?? ''}
              onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Alle</option>
              {data.options.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="field-input"
              value={filter.status}
              onChange={(e) => update({ status: e.target.value as WorkFilter['status'] })}
            >
              <option value="active">Aktive</option>
              <option value="archived">Arkiverte</option>
              <option value="all">Alle</option>
            </select>
          </Field>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Field label="Mangler">
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {MISSING_KEYS.map((key) => {
                const active = filter.missing.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleMissing(key)}
                    aria-pressed={active}
                    className={`min-h-9 cursor-pointer rounded-[7px] border px-2.5 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] transition-all ${
                      active
                        ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                        : 'border-line-strong text-ink-faint hover:border-brass/50 hover:text-ink-soft'
                    }`}
                  >
                    {MISSING_LABELS[key]}
                  </button>
                )
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:w-[22rem]">
            <Field label="Sorter etter">
              <select
                className="field-input"
                value={filter.sort}
                onChange={(e) => {
                  // Ny nøkkel får sin naturlige retning (sist oppdatert = nyest først)
                  const sort = e.target.value as WorkSortKey
                  update({ sort, dir: defaultDirFor(sort) })
                }}
              >
                {Object.entries(SORT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rekkefølge">
              <select
                className="field-input"
                value={filter.dir}
                onChange={(e) => update({ dir: e.target.value === 'desc' ? 'desc' : 'asc' })}
              >
                <option value="asc">{DIR_LABELS[filter.sort].asc}</option>
                <option value="desc">{DIR_LABELS[filter.sort].desc}</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint">{summary}</p>
          {activeCount > 0 && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Nullstill filtre
            </Button>
          )}
        </div>
      </div>

      {data.works.length === 0 ? (
        <div className="sheet rise">
          <EmptyState
            title={
              activeCount === 0
                ? 'Arkivet er tomt'
                : filter.q
                  ? `Ingen treff på «${filter.q}»`
                  : 'Ingen verk matcher filtrene'
            }
            action={
              activeCount > 0 ? (
                <Button onClick={reset}>Nullstill filtre</Button>
              ) : data.canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Legg inn første verk
                </Button>
              ) : undefined
            }
          >
            {activeCount === 0
              ? 'Legg inn verk, så bygger katalogen seg selv.'
              : filter.status === 'active'
                ? 'Prøv å fjerne et filter eller sjekk stavemåten. Arkiverte verk er skjult — velg «Alle» under Status for å ta dem med.'
                : 'Prøv å fjerne et filter eller sjekk stavemåten.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="rise sheet divide-y divide-[var(--line)] overflow-hidden" style={{ animationDelay: '140ms' }}>
          {data.works.map((w) => (
            <li key={w.id}>
              <Link
                to="/noter/arkiv/$workId"
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
                  {w.status === 'archived' && <Stamp tone="oxblood">arkivert</Stamp>}
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
          router.navigate({ to: '/noter/arkiv/$workId', params: { workId: id } })
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
