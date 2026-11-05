import { Link, createFileRoute } from '@tanstack/react-router'
import { Icon } from '../../components/Icons'
import { Avatar, EmptyState, PageHeader, Stamp } from '../../components/ui'
import { getLeaderOverview } from '../../server/gruppeledere'

/**
 * Oversikten: hvem som er gruppeleder, og hvilke stemmer og seksjoner de leder.
 * Den dupliserer bevisst ikke medlemsadministrasjonen — stemmetildeling og
 * leiarbinding gjøres i `/medlemmer`, og herfra går det en krysslenke dit
 * (docs/designprinsipper.md §4).
 */
export const Route = createFileRoute('/gruppeledere/')({
  loader: () => getLeaderOverview(),
  component: OverviewPage,
})

function OverviewPage() {
  const { leaders } = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <PageHeader
        className="rise"
        title="Gruppeledere"
        summary="Hvem som leder hvilke stemmer. Bruk chatten til å koordinere på tvers av seksjonene."
        action={
          <Link
            to="/gruppeledere/chat"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[9px] bg-brass px-4 text-sm font-medium text-paper-raised transition-colors hover:bg-brass-strong pointer-coarse:min-h-11 dark:text-paper"
          >
            <Icon name="forum" size={17} />
            Chat
          </Link>
        }
      />

      {leaders.length === 0 ? (
        <div className="surface-group rise" style={{ animationDelay: '60ms' }}>
          <EmptyState title="Ingen gruppeledere er registrert">
            Leiarbindingene settes under Medlemmer. Uten en binding finnes ikke dette området for noen.
          </EmptyState>
        </div>
      ) : (
        <ul className="rise list-group md:grid md:grid-cols-2 md:[&>li:nth-child(2)]:border-t-0 md:[&>li:nth-child(even)]:border-l md:[&>li:nth-child(even)]:border-line" style={{ animationDelay: '60ms' }}>
          {leaders.map((leader) => (
            <li key={leader.userId} className="flex items-start gap-3 px-4 py-4 sm:px-5">
              <Avatar name={leader.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-semibold text-ink">{leader.name}</p>
                  {leader.isMe && (
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">Deg</span>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">
                  {leader.sections.join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {leader.parts.map((part) => (
                    <Stamp key={part.id} tone="brass">
                      {part.nameNo}
                    </Stamp>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="rise text-sm text-ink-soft" style={{ animationDelay: '120ms' }}>
        Stemmetildeling gjør du under{' '}
        <Link to="/medlemmer" className="link-quiet font-medium text-brass-strong underline underline-offset-2">
          Medlemmer
        </Link>
        .
      </p>
    </div>
  )
}
