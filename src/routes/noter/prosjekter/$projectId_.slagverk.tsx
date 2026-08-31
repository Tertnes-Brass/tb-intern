import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Button, EmptyState, Kicker } from '../../../components/ui'
import { formatDate, formatWeekday, toRoman } from '../../../lib/format'
import { percussionLines } from '../../../lib/percussion'
import { getProject } from '../../../server/projects'

/**
 * Hele slagverksoppsettet for én konsert på én side — arket som henger på
 * pauken under rigging. Ruten er `$projectId_` (understrek) fordi
 * `$projectId.tsx` er en bladrute uten `Outlet`: siden skal ligge ved siden av
 * prosjektsiden, ikke inne i den.
 *
 * Utskriftsvennlig med `@media print` i `src/styles.css`: papirkorn, toppmeny,
 * områdemeny og knapper (`.print-hidden`) forsvinner, og fargene tvinges til
 * sort på hvitt uansett tema.
 */
export const Route = createFileRoute('/noter/prosjekter/$projectId_/slagverk')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getProject({ data: { id: params.projectId } }),
  errorComponent: ({ error }) => (
    <EmptyState title="Kunne ikke åpne slagverksoppsettet">{error.message}</EmptyState>
  ),
  component: PercussionSheetPage,
})

function PercussionSheetPage() {
  const data = Route.useLoaderData()
  const p = data.project
  const notes = percussionLines(p.percussionNotes)
  const withSetup = data.repertoire.filter((r) => r.percussionSetup)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print-hidden mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/noter/prosjekter/$projectId"
          params={{ projectId: p.id }}
          className="link-quiet inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← {p.name}
        </Link>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          Skriv ut
        </Button>
      </div>

      <header className="print-block">
        <Kicker>Slagverksoppsett</Kicker>
        <h1 className="display-title mt-2 break-words [hyphens:auto] text-[clamp(2rem,5vw,3.2rem)] font-semibold italic leading-[1.05] text-ink">
          {p.name}
        </h1>
        <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
          {p.eventDate ? `${formatWeekday(p.eventDate)} ${formatDate(p.eventDate)}` : 'Dato ikke satt'}
          {p.venue ? ` · ${p.venue}` : ''}
        </p>
        <div className="staff-rule mt-5 w-full opacity-50" aria-hidden />
      </header>

      {notes.length > 0 && (
        <section className="print-block mt-7">
          <h2 className="kicker">Notater</h2>
          <div className="mt-2 space-y-1 border-l-2 border-brass/40 pl-4">
            {notes.map((line, i) => (
              <p key={i} className="text-[0.92rem] leading-relaxed text-ink-soft">
                {line}
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="kicker">Program</h2>
        {data.repertoire.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">Programmet er tomt.</p>
        ) : (
          <ol className="mt-1">
            {data.repertoire.map((item, i) => {
              const lines = percussionLines(item.percussionSetup)
              return (
                <li key={item.workId} className="print-block hairline-row flex gap-4 py-4 sm:gap-6">
                  <span className="roman-no w-9 shrink-0 pt-0.5 text-right text-lg text-brass sm:w-11" aria-hidden>
                    {toRoman(i + 1)}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="display-title text-[1.1rem] font-semibold leading-snug text-ink">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-[0.82rem] text-ink-soft">
                      {[item.composer, item.arranger ? `arr. ${item.arranger}` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    {lines.length > 0 ? (
                      <ul className="mt-2 space-y-0.5">
                        {lines.map((line, j) => (
                          <li key={j} className="text-[0.9rem] leading-snug text-ink">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-ink-faint">
                        Ikke satt opp
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {withSetup.length === 0 && notes.length === 0 && (
        <p className="print-hidden mt-8 text-sm leading-relaxed text-ink-soft">
          Ingenting er satt opp ennå.{' '}
          {data.canManage ? (
            <Link to="/noter/prosjekter/$projectId" params={{ projectId: p.id }} className="link-brass">
              Fyll inn oppsettet på prosjektsiden
            </Link>
          ) : (
            'Den som setter opp slagverket fyller det inn på prosjektsiden.'
          )}
        </p>
      )}

      <p className="mt-10 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-ink-faint">
        Tertnes Brass · slagverksoppsett
      </p>
    </div>
  )
}
