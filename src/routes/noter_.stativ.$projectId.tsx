import { createFileRoute, redirect } from '@tanstack/react-router'
import { Notestativ } from '../components/Notestativ'
import { EmptyState } from '../components/ui'
import { getProject } from '../server/projects'

/**
 * Notestativet: stemmene i et prosjekt, i programrekkefølge, i fullskjerm inne
 * i appen. Erstatter «åpne PDF-en i ny fane», som på en installert app betyr å
 * forlate appen.
 *
 * Hører til noteområdet (`/noter/...`), men står utenfor layout-ruten
 * (`noter_`): et notestativ har ingen områdemeny, ingen fanelinje og intet
 * skall — bare noten. Se `bare` i `__root.tsx`.
 *
 * Tilgangen er den samme som på prosjektsiden (`getProject`), og hver fil hentes
 * gjennom fil-gaten (`/api/files/$fileId`). Stativet viser ikke noe serveren
 * ikke allerede ville levert.
 *
 * `?fil=` er bare startpunktet. Adressen oppdateres IKKE mens man blar: hver
 * endring i adressen er en navigasjon i ruteren (den fanger også
 * `history.replaceState`), som kjører rotens `beforeLoad` (`getMe`) på nytt — og
 * å bla skal virke uten nett, fra den lagrede kopien av siden.
 */
export const Route = createFileRoute('/noter_/stativ/$projectId')({
  validateSearch: (search: Record<string, unknown>): { fil?: string } =>
    typeof search.fil === 'string' && search.fil ? { fil: search.fil } : {},
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loaderDeps: () => ({}),
  staleTime: Infinity,
  loader: ({ params }) => getProject({ data: { id: params.projectId } }),
  errorComponent: ({ error }) => (
    <div className="grid min-h-dvh place-items-center px-6">
      <EmptyState title="Kunne ikke åpne notestativet">{error.message}</EmptyState>
    </div>
  ),
  component: StandPage,
})

function StandPage() {
  const data = Route.useLoaderData()
  const { fil } = Route.useSearch()
  const { me } = Route.useRouteContext()
  return (
    <Notestativ
      ownerId={me!.id}
      project={{ id: data.project.id, name: data.project.name }}
      repertoire={data.repertoire}
      hasParts={data.myParts.length > 0}
      initialFileId={fil ?? null}
    />
  )
}
