import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { StageEditorLoader } from '../components/stage/StageEditorLoader'
import { EmptyState } from '../components/ui'
import { getStageSetup } from '../server/stage-setups'

/**
 * Sceneoppsettet: én tegning av hvordan korpset og slagverket står, i
 * fullskjerm. Hører til prosjektområdet, men står utenfor noteområdets layout
 * (`noter_`) — en tegneflate trenger hele skjermen, som notestativet. Se `bare`
 * i `__root.tsx`.
 *
 * Editoren leser lasterdataene ÉN gang. Etterpå er det den som eier tegningen;
 * ny lasterdata (f.eks. fra en `router.invalidate()` et annet sted) skal aldri
 * bytte ut det noen sitter og tegner på. `gcTime: 0` gjør at et nytt besøk
 * alltid henter fersk data, så revisjonen editoren starter fra stemmer.
 */
export const Route = createFileRoute('/noter_/oppsett/$setupId')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  gcTime: 0,
  loader: ({ params }) => getStageSetup({ data: { id: params.setupId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.setup.title} · Sceneoppsett` : 'Sceneoppsett' }],
  }),
  errorComponent: ({ error }) => (
    <div className="grid min-h-dvh place-items-center px-6">
      <EmptyState title="Kunne ikke åpne sceneoppsettet">{error.message}</EmptyState>
    </div>
  ),
  component: StageSetupPage,
})

function StageSetupPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  // Økes når brukeren velger «Hent siste versjon» etter en konflikt.
  const [generation, setGeneration] = useState(0)
  const [initial, setInitial] = useState(data)
  // Et annet oppsett i samme rute (ny id) er en ny tegning, ikke en oppdatering.
  if (data.setup.id !== initial.setup.id) setInitial(data)

  return (
    <StageEditorLoader
      key={`${initial.setup.id}:${generation}`}
      data={initial}
      onLeave={() =>
        void router.navigate({ to: '/noter/prosjekter/$projectId', params: { projectId: initial.project.id } })
      }
      onReload={async () => {
        const fresh = await getStageSetup({ data: { id: initial.setup.id } })
        setInitial(fresh)
        setGeneration((n) => n + 1)
      }}
    />
  )
}
