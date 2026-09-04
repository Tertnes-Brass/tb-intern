import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { StagePlotEditor } from '../../../components/StagePlot'
import { toast } from '../../../components/toast'
import { EmptyState, Kicker } from '../../../components/ui'
import { formatDate, formatDateTime, formatWeekday } from '../../../lib/format'
import { getStagePlot, saveStagePlot } from '../../../server/scene'

/**
 * Sceneoppsettet for ett prosjekt (#11) — den grafiske riggen.
 *
 * Ruten er `$projectId_` (understrek) av samme grunn som slagverkssida:
 * `$projectId.tsx` er en bladrute uten `Outlet`, så denne skal ligge VED SIDEN
 * av prosjektsiden, ikke inne i den.
 *
 * Én rute, to bruk: den som kan redigere får paletten og lagreknappen, alle
 * andre får den samme tegningen som en ren visning. To ruter ville betydd to
 * URL-er å dele, og den ene ville alltid vært feil å sende videre.
 *
 * Utskriftsvennlig via `@media print` i `src/styles.css`: krom og knapper er
 * `.print-hidden`, og fargene tvinges til sort på hvitt uansett tema. «Last ned
 * SVG» serialiserer tegneflaten klientside — ingen serverjobb.
 */
export const Route = createFileRoute('/noter/prosjekter/$projectId_/sceneoppsett')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getStagePlot({ data: { projectId: params.projectId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne sceneoppsettet">{error.message}</EmptyState>,
  component: StagePlotPage,
})

function StagePlotPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const p = data.project

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/noter/prosjekter/$projectId"
        params={{ projectId: p.id }}
        className="link-quiet print-hidden mb-6 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
      >
        ← {p.name}
      </Link>

      <header className="print-block">
        <Kicker>Sceneoppsett</Kicker>
        <h1 className="display-title mt-2 break-words [hyphens:auto] text-[clamp(2rem,5vw,3.2rem)] font-semibold italic leading-[1.05] text-ink">
          {p.name}
        </h1>
        <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
          {p.eventDate ? `${formatWeekday(p.eventDate)} ${formatDate(p.eventDate)}` : 'Dato ikke satt'}
          {p.venue ? ` · ${p.venue}` : ''}
        </p>
        {/* «Er dette oppsettet fra i fjor?» er spørsmålet `updated_at` finnes
            for — derfor står det på siden, ikke bare i databasen. */}
        {data.plot.updatedAt && (
          <p className="mt-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
            Sist endret {formatDateTime(data.plot.updatedAt)}
            {data.plot.updatedByName ? ` av ${data.plot.updatedByName}` : ''}
          </p>
        )}
        <div className="staff-rule mt-5 w-full opacity-50" aria-hidden />
      </header>

      <div className="mt-7">
        <StagePlotEditor
          projectName={p.name}
          initialElements={data.plot.elements}
          initialNote={data.plot.note}
          canManage={data.canManage}
          onSave={async (elements, note) => {
            await saveStagePlot({ data: { projectId: p.id, elements, note } })
            toast('Sceneoppsettet er lagret')
            await router.invalidate()
          }}
        />
      </div>
    </div>
  )
}
