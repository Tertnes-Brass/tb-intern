import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { Icon } from '../../components/Icons'
import { OfflineStandRow } from '../../components/OfflineStand'
import { RepertoireList } from '../../components/Repertoire'
import { Kicker, PageHeader, Stamp } from '../../components/ui'
import { formatDate, formatWeekday, relativeDays } from '../../lib/format'
import { pruneOfflineStands } from '../../lib/offline-notes'
import { percussionLines } from '../../lib/percussion'
import { standEntries } from '../../lib/stand'
import { getHome } from '../../server/projects'

export const Route = createFileRoute('/noter/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getHome(),
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()
  const { me } = Route.useRouteContext()
  const next = data.nextProject
  // Det som ligger på notestativet for neste prosjekt — samme regel som
  // stativet selv, så «6 stemmer» her er de seks man får der.
  const standFileIds = useMemo(
    () => standEntries(data.repertoire, { hasParts: data.me.parts.length > 0 }).map((e) => e.fileId),
    [data.repertoire, data.me.parts.length],
  )

  // Stativ lagret offline for prosjekter som ikke lenger er kommende, slettes.
  useEffect(() => {
    void pruneOfflineStands([...(next ? [next.id] : []), ...data.upcoming.map((p) => p.id)]).catch(() => {})
  }, [next, data.upcoming])

  const partsLine =
    data.me.parts.length > 0
      ? data.me.parts.map((p) => p.nameNo).join(' · ')
      : 'Ingen stemme registrert — du får partituret'

  return (
    <div>
      <PageHeader title="Mine noter" summary={partsLine} className="rise" />

      {next ? (
        <div className="mt-6 grid gap-x-12 gap-y-10 lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* Den ene primærmodulen: neste prosjekt og veien inn på notestativet. */}
          <section className="rise lg:self-start" aria-labelledby="neste-prosjekt">
            <div className="sheet overflow-hidden">
              <div className="px-5 pb-5 pt-5 sm:px-6 sm:pt-6 md:grid md:grid-cols-[minmax(0,1fr)_18rem] md:gap-8 lg:block">
                <div className="min-w-0">
                  <Kicker className="mb-2">Neste prosjekt · {relativeDays(next.eventDate)}</Kicker>
                  <Link
                    to="/noter/prosjekter/$projectId"
                    params={{ projectId: next.id }}
                    className="link-quiet group block"
                    id="neste-prosjekt"
                  >
                    <h2 className="display-title break-words text-[clamp(2rem,6vw,2.6rem)] font-semibold italic leading-[1.02] text-ink transition-colors [hyphens:auto] group-hover:text-brass-strong">
                      {next.name}
                    </h2>
                  </Link>
                  {next.eventDate && (
                    <p className="mt-2 text-[0.95rem] text-ink">
                      {formatWeekday(next.eventDate)} {formatDate(next.eventDate)}
                      {next.venue ? <span className="text-ink-soft"> · {next.venue}</span> : null}
                    </p>
                  )}
                  {next.description && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft lg:line-clamp-4">{next.description}</p>
                  )}
                </div>
                <div className="mt-5 space-y-3 md:mt-0 lg:mt-5">
                  {standFileIds.length > 0 ? (
                    <>
                      <Link to="/noter/stativ/$projectId" params={{ projectId: next.id }} className="stand-cta">
                        <Icon name="notes" size={22} />
                        Åpne notestativet
                      </Link>
                      <OfflineStandRow project={{ id: next.id, name: next.name }} fileIds={standFileIds} ownerId={me.id} />
                    </>
                  ) : (
                    <p className="surface-group px-4 py-3.5 text-sm leading-snug text-ink-soft">
                      {data.repertoire.length === 0
                        ? 'Programmet er ikke satt ennå. Notene dukker opp her så snart det er publisert.'
                        : 'Ingen noter til deg i dette programmet ennå.'}
                    </p>
                  )}
                </div>
              </div>
              {next.percussionNotes && (
                <div className="border-t border-line bg-paper-sunken/50 px-5 py-4 sm:px-6">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-brass">Slagverksnotater</p>
                  <div className="mt-1.5 space-y-1">
                    {percussionLines(next.percussionNotes).map((line, i) => (
                      <p key={i} className="text-sm leading-relaxed text-ink-soft">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="min-w-0 space-y-12">
            {data.repertoire.length > 0 && (
              <section className="rise" style={{ animationDelay: '80ms' }}>
                <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
                  <h2 className="display-title text-xl font-semibold text-ink">På stativet</h2>
                  <p className="text-sm text-ink-faint">
                    {data.repertoire.length === 1 ? '1 verk' : `${data.repertoire.length} verk`}
                  </p>
                </div>
                <RepertoireList items={data.repertoire} standProjectId={next.id} />
              </section>
            )}

            {data.upcoming.length > 0 && (
              <section className="rise" style={{ animationDelay: '120ms' }}>
                <p className="group-label">Senere</p>
                <UpcomingList projects={data.upcoming} />
              </section>
            )}

            {data.archive && <ArchiveShelf archive={data.archive} />}
          </div>
        </div>
      ) : (
        <div className={`mt-6 grid gap-x-12 gap-y-10 ${data.archive ? 'lg:grid-cols-2' : ''}`}>
          {/* Ingen kommende prosjekt: én tydelig tilstand og én vei videre — ikke
              en tom «Kommende»-seksjon i tillegg. */}
          <section className="rise surface-group flex flex-col items-start gap-3 px-6 py-8 sm:px-8">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brass-soft)] text-brass-strong">
              <Icon name="notes" size={24} />
            </span>
            <h2 className="display-title text-[1.4rem] font-semibold leading-tight text-ink sm:text-[1.6rem]">
              Ingenting på notestativet ennå
            </h2>
            <p className="max-w-md text-[0.95rem] leading-relaxed text-ink-soft">
              Når neste konsert publiseres, ligger programmet og notene dine klare her — og kan lagres på enheten
              før øvelser med dårlig nett.
            </p>
            <Link
              to="/noter/prosjekter"
              search={{ status: 'tidligere' }}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-4 text-sm font-medium text-ink transition-colors hover:border-brass hover:text-brass-strong"
            >
              Se tidligere prosjekter
              <Icon name="chevronRight" size={16} />
            </Link>
          </section>

          {data.archive && <ArchiveShelf archive={data.archive} />}
        </div>
      )}
    </div>
  )
}

type HomeData = Awaited<ReturnType<typeof getHome>>

function UpcomingList({ projects }: { projects: HomeData['upcoming'] }) {
  return (
    <ul className="list-group">
      {projects.map((p) => (
        <li key={p.id}>
          <Link
            to="/noter/prosjekter/$projectId"
            params={{ projectId: p.id }}
            className="list-row-link link-quiet flex min-h-[60px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
          >
            <span className="min-w-0">
              <span className="display-title block truncate text-[1.05rem] font-semibold text-ink">{p.name}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-soft">
                {formatDate(p.eventDate)}
                {p.venue ? ` · ${p.venue}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-xs font-medium text-brass-strong">{relativeDays(p.eventDate)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ArchiveShelf({ archive }: { archive: NonNullable<HomeData['archive']> }) {
  return (
    <section className="rise" style={{ animationDelay: '160ms' }}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <p className="group-label !m-0">Nytt i arkivet</p>
        <Link to="/noter/arkiv" className="link-brass hit text-sm">
          Hele arkivet →
        </Link>
      </div>
      <ul className="list-group">
        {archive.latestWorks.map((w) => (
          <li key={w.id}>
            <Link
              to="/noter/arkiv/$workId"
              params={{ workId: w.id }}
              className="list-row-link link-quiet flex min-h-[60px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
            >
              <span className="min-w-0">
                <span className="display-title block truncate text-[1.02rem] font-semibold text-ink">{w.title}</span>
                <span className="block truncate text-xs text-ink-soft">{w.composer ?? '—'}</span>
              </span>
              {w.genre && <Stamp>{w.genre}</Stamp>}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 px-1 text-xs text-ink-faint">
        {archive.stats.works} verk · {archive.stats.files} filer i arkivet
      </p>
    </section>
  )
}
