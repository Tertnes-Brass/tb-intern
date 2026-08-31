import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { RepertoireList } from '../../components/Repertoire'
import { EmptyState, Kicker, SectionHeading, Stamp } from '../../components/ui'
import { formatDate, formatWeekday, relativeDays } from '../../lib/format'
import { percussionLines } from '../../lib/percussion'
import { getHome } from '../../server/projects'

export const Route = createFileRoute('/noter/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getHome(),
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()
  const next = data.nextProject

  return (
    <div className="space-y-14">
      {next ? (
        <section className="rise">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Kicker className="mb-3">
                Neste prosjekt · {relativeDays(next.eventDate)}
              </Kicker>
              <Link
                to="/noter/prosjekter/$projectId"
                params={{ projectId: next.id }}
                className="link-quiet block"
              >
                <h1 className="display-title text-[clamp(2.6rem,7vw,4.6rem)] font-semibold italic leading-[0.98] text-ink transition-colors hover:text-brass-strong break-words [hyphens:auto]">
                  {next.name}
                </h1>
              </Link>
              <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">
                {next.description}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {data.me.parts.map((p) => (
                  <Stamp key={p.id} tone="brass">
                    {p.nameNo}
                  </Stamp>
                ))}
                <Stamp>{data.me.roleName}</Stamp>
              </div>
            </div>

            {next.eventDate && (
              <div className="sheet flex shrink-0 items-stretch self-start overflow-hidden md:self-end">
                <div className="flex flex-col items-center justify-center px-6 py-4">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
                    {formatWeekday(next.eventDate)}
                  </span>
                  <span className="display-title tabular text-[2.6rem] font-semibold leading-none text-ink">
                    {Number(next.eventDate.slice(8, 10))}
                  </span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-brass">
                    {formatDate(next.eventDate).split(' ').slice(1).join(' ')}
                  </span>
                </div>
                {next.venue && (
                  <div className="flex items-center border-l border-line bg-paper-sunken/60 px-5">
                    <span className="max-w-[120px] text-xs leading-snug text-ink-soft">{next.venue}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="staff-rule mt-8 w-full opacity-50" aria-hidden />

          {next.percussionNotes && (
            <div className="mt-6 rounded-2xl border border-line bg-paper-raised px-5 py-4">
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

          <div className="mt-2">
            <RepertoireList items={data.repertoire} />
            {data.repertoire.length === 0 && (
              <EmptyState title="Programmet er ikke satt ennå">
                Repertoaret dukker opp her så snart det er publisert.
              </EmptyState>
            )}
          </div>
        </section>
      ) : (
        <section className="rise">
          <EmptyState
            title="Ingen kommende prosjekter"
            action={
              <Link to="/noter/prosjekter" className="link-brass text-sm">
                Se tidligere prosjekter
              </Link>
            }
          >
            Når neste konsert publiseres finner du programmet og notene dine her.
          </EmptyState>
        </section>
      )}

      <div className={data.archive ? 'grid gap-10 md:grid-cols-2' : 'max-w-2xl'}>
        <section className="rise" style={{ animationDelay: '120ms' }}>
          <SectionHeading kicker="Lenger frem" title="Kommende" className="mb-4" />
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-ink-faint">Ingenting mer planlagt — foreløpig.</p>
          ) : (
            <ul className="space-y-3">
              {data.upcoming.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/noter/prosjekter/$projectId"
                    params={{ projectId: p.id }}
                    className="sheet sheet-hover link-quiet flex items-center justify-between gap-4 px-5 py-4"
                  >
                    <span>
                      <span className="display-title block text-lg font-semibold">{p.name}</span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {formatDate(p.eventDate)}
                        {p.venue ? ` · ${p.venue}` : ''}
                      </span>
                    </span>
                    <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-brass">
                      {relativeDays(p.eventDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.archive && (
          <section className="rise" style={{ animationDelay: '200ms' }}>
            <SectionHeading
              kicker="Arkivet"
              title="Nytt i hyllene"
              className="mb-4"
              action={
                <Link to="/noter/arkiv" className="link-brass text-sm">
                  Hele arkivet →
                </Link>
              }
            />
            <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
              {data.archive.latestWorks.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/noter/arkiv/$workId"
                    params={{ workId: w.id }}
                    className="link-quiet flex items-baseline justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-paper-sunken/50"
                  >
                    <span className="min-w-0">
                      <span className="display-title block truncate text-[1.02rem] font-semibold">{w.title}</span>
                      <span className="block text-xs text-ink-soft">{w.composer ?? '—'}</span>
                    </span>
                    {w.genre && <Stamp>{w.genre}</Stamp>}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">
              {data.archive.stats.works} verk · {data.archive.stats.files} filer i arkivet
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
