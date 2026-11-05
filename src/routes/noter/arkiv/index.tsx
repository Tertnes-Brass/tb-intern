import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { WorkFormModal } from '../../../components/WorkForm'
import { Icon } from '../../../components/Icons'
import { Segmented } from '../../../components/Segmented'
import { BottomSheet, Button, EmptyState, Field, FieldGroup, PageHeader, Stamp } from '../../../components/ui'
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

type ArchiveData = Awaited<ReturnType<typeof listWorks>>

function ArchivePage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [creating, setCreating] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const filter = resolveWorkFilter(search)
  const activeCount = countActiveFilters(filter)
  // Søket står alltid synlig; knappen teller bare det som ligger bak den.
  const hiddenCount = activeCount - (filter.q ? 1 : 0)

  // Søkefeltet har lokal tilstand så skrivingen ikke venter på ruteren, men
  // synkes fra URL-en slik at «Nullstill» og delte lenker faktisk tømmer det.
  const [text, setText] = useState(filter.q)
  useEffect(() => setText(filter.q), [filter.q])

  // All filtertilstand går gjennom URL-en — da er en filtrert visning delbar.
  const update = (patch: Partial<WorkFilter>) =>
    navigate({ search: serializeArchiveSearch({ ...filter, ...patch }), replace: true })

  const reset = () => {
    setText('')
    navigate({ search: {}, replace: true })
  }

  const summary =
    activeCount > 0 ? `${data.works.length} av ${data.total} verk` : `${data.total} verk`

  // De aktive filtrene som brikker over resultatene — hvert kan fjernes for seg.
  const chips: Array<{ key: string; label: string; clear: () => void }> = []
  if (filter.composer) chips.push({ key: 'composer', label: filter.composer, clear: () => update({ composer: null }) })
  if (filter.arranger) chips.push({ key: 'arranger', label: `arr. ${filter.arranger}`, clear: () => update({ arranger: null }) })
  if (filter.genre) chips.push({ key: 'genre', label: filter.genre, clear: () => update({ genre: null }) })
  if (filter.grade != null) chips.push({ key: 'grade', label: `Grad ${filter.grade}`, clear: () => update({ grade: null }) })
  if (filter.year != null) chips.push({ key: 'year', label: `Anskaffet ${filter.year}`, clear: () => update({ year: null }) })
  if (filter.status !== 'active')
    chips.push({
      key: 'status',
      label: filter.status === 'archived' ? 'Arkiverte' : 'Aktive og arkiverte',
      clear: () => update({ status: 'active' }),
    })
  for (const key of filter.missing)
    chips.push({
      key: `missing-${key}`,
      label: `Mangler ${MISSING_LABELS[key].toLowerCase()}`,
      clear: () => update({ missing: filter.missing.filter((k) => k !== key) }),
    })

  return (
    <div className="space-y-6">
      <PageHeader
        className="rise"
        title="Arkivet"
        summary={
          <>
            {summary} ·{' '}
            <Link to="/noter/arkiv/liste" className="link-brass hit">
              Arkivliste
            </Link>
          </>
        }
        action={
          data.canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon /> Nytt verk
            </Button>
          )
        }
      />

      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        {/* Filtrene: sidekolonne fra lg, et ark bak «Filtrer» under det. */}
        <aside className="hidden lg:block" aria-label="Filtre">
          <div className="aside-sticky max-h-[calc(100dvh-8rem)] overflow-y-auto pb-6 pr-1">
            <FilterPanel data={data} filter={filter} update={update} reset={activeCount > 0 ? reset : undefined} />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="rise flex items-center gap-2" style={{ animationDelay: '60ms' }}>
            <div className="relative min-w-0 flex-1">
              <svg
                width="15"
                height="15"
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
                placeholder="Tittel, arkivnr., komponist …"
                className="field-input !pl-10"
                enterKeyHint="search"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Søk på tittel, arkivnummer, komponist eller arrangør"
                onChange={(e) => {
                  setText(e.target.value)
                  update({ q: e.target.value })
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              className={`inline-flex min-h-[2.6rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] border px-3.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 lg:hidden ${
                hiddenCount > 0
                  ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                  : 'border-line-strong bg-paper-raised text-ink hover:border-brass'
              }`}
            >
              <Icon name="sliders" size={17} />
              Filtrer
              {hiddenCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1 text-[0.7rem] font-semibold text-paper-raised dark:text-paper">
                  {hiddenCount}
                </span>
              )}
            </button>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  aria-label={`Fjern filteret ${c.label}`}
                  className="hit inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-brass/50 bg-[var(--brass-soft)] pl-3 pr-2 text-[0.8rem] font-medium text-brass-strong transition-colors hover:border-brass"
                >
                  {c.label}
                  <Icon name="close" size={13} strokeWidth={2} />
                </button>
              ))}
              <button type="button" onClick={reset} className="hit cursor-pointer px-1 text-[0.8rem] text-ink-soft underline-offset-2 hover:text-ink hover:underline">
                Nullstill
              </button>
            </div>
          )}

          {data.works.length === 0 ? (
            <div className="surface-group rise">
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
            <ul className="rise list-group" style={{ animationDelay: '100ms' }}>
              {data.works.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/noter/arkiv/$workId"
                    params={{ workId: w.id }}
                    className="list-row-link link-quiet grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-1 px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="display-title block truncate text-[1.08rem] font-semibold leading-snug text-ink">
                        {w.title}
                      </span>
                      {w.subtitle && (
                        <span className="display-title block truncate text-[0.88rem] italic text-ink-soft">
                          {w.subtitle}
                        </span>
                      )}
                      <span className="block truncate text-[0.82rem] text-ink-soft">
                        {[w.composer, w.arranger ? `arr. ${w.arranger}` : null].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="hidden min-w-0 items-center gap-2 md:flex">
                      {w.status === 'archived' && <Stamp tone="oxblood">arkivert</Stamp>}
                      {w.genre && <Stamp>{w.genre}</Stamp>}
                    </span>
                    <span className="hidden flex-col items-end gap-1 md:flex">
                      <GradeDots grade={w.grade} />
                      <span className="tabular font-mono text-[0.66rem] text-ink-faint">
                        {formatDuration(w.durationSec) || '—'}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className={`text-xs font-medium ${w.counts.parts > 0 ? 'text-ink-soft' : 'text-oxblood'}`}>
                        {w.counts.parts > 0 ? `${w.counts.parts} stemmer` : 'Mangler noter'}
                      </span>
                      {w.archiveNumber && (
                        <span className="font-mono text-[0.62rem] text-ink-faint">Nr. {w.archiveNumber}</span>
                      )}
                      {w.physicalLocation && (
                        <span className="hidden font-mono text-[0.62rem] text-ink-faint md:block">{w.physicalLocation}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Valgene gjelder med en gang (URL-en), så lukkeknappen er «Ferdig»; bunnlinjen
          med antallet står fast, så man ser hva filtrene gir uten å rulle. */}
      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtrer og sorter"
        closeLabel="Ferdig"
        footer={
          <>
            {activeCount > 0 && (
              <Button variant="ghost" onClick={reset}>
                Nullstill
              </Button>
            )}
            <Button variant="primary" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Vis {data.works.length === 1 ? '1 verk' : `${data.works.length} verk`}
            </Button>
          </>
        }
      >
        <FilterPanel data={data} filter={filter} update={update} />
      </BottomSheet>

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

/**
 * Filtrene og sorteringen, i sidekolonnen (lg) eller i arket bak «Filtrer».
 * Hver endring går rett i URL-en, akkurat som før — arket har ingen egen
 * «bruk»-tilstand som kan komme i utakt med lista bak det.
 */
function FilterPanel({
  data,
  filter,
  update,
  reset,
}: {
  data: ArchiveData
  filter: WorkFilter
  update: (patch: Partial<WorkFilter>) => void
  reset?: () => void
}) {
  const toggleMissing = (key: MissingKey) =>
    update({
      missing: filter.missing.includes(key) ? filter.missing.filter((k) => k !== key) : [...filter.missing, key],
    })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-1">
        <Field label="Sorter etter" className="col-span-2 lg:col-span-1">
          <div className="flex flex-col gap-2">
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
            <Segmented
              label="Rekkefølge"
              stretch
              value={filter.dir}
              options={[
                { value: 'asc', label: DIR_LABELS[filter.sort].asc },
                { value: 'desc', label: DIR_LABELS[filter.sort].desc },
              ]}
              onChange={(dir) => update({ dir })}
            />
          </div>
        </Field>
        <FieldGroup label="Status" className="col-span-2 lg:col-span-1">
          <Segmented
            label="Status"
            stretch
            value={filter.status}
            options={[
              { value: 'active', label: 'Aktive' },
              { value: 'archived', label: 'Arkiverte' },
              { value: 'all', label: 'Alle' },
            ]}
            onChange={(status) => update({ status })}
          />
        </FieldGroup>
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
        <Field label="Anskaffet år" className="col-span-2 lg:col-span-1">
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
      </div>

      <div>
        <p className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">Mangler</p>
        <div className="flex flex-wrap gap-2">
          {MISSING_KEYS.map((key) => {
            const active = filter.missing.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleMissing(key)}
                aria-pressed={active}
                className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-[0.82rem] font-medium transition-colors pointer-coarse:min-h-11 ${
                  active
                    ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                    : 'border-line-strong text-ink-soft hover:border-brass/60 hover:text-ink'
                }`}
              >
                {MISSING_LABELS[key]}
              </button>
            )
          })}
        </div>
      </div>

      {reset && (
        <Button variant="ghost" size="sm" onClick={reset} className="-ml-2">
          Nullstill alle filtre
        </Button>
      )}
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
