import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { SocialEventForm } from '../../../../components/SocialEventForm'
import { toast, toastError } from '../../../../components/toast'
import { EmptyState, Kicker } from '../../../../components/ui'
import { toOsloDate } from '../../../../lib/format'
import { utcToWallClock } from '../../../../lib/wallclock'
import { getSocialEvent, updateSocialEvent } from '../../../../server/social'

/**
 * Redigering av et sosialt arrangement. Arrangøren eller en moderator
 * (`members.manage`) — `canEdit` kommer fra serveren, og `updateSocialEvent`
 * håndhever den samme regelen på nytt. Skjermen skjuler bare knappen; det er
 * serveren som sier nei.
 */
export const Route = createFileRoute('/kalender/sosialt/$socialId/rediger')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getSocialEvent({ data: { id: params.socialId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne arrangementet">{error.message}</EmptyState>,
  component: EditSocialEventPage,
})

function EditSocialEventPage() {
  const data = Route.useLoaderData()
  const navigate = useNavigate()
  const back = () => navigate({ to: '/kalender/sosialt/$socialId', params: { socialId: data.id } })

  if (!data.canEdit) {
    return (
      <EmptyState title="Dette er ikke ditt arrangement" action={<Link to="/kalender" className="link-brass text-sm">Til kalenderen</Link>}>
        Bare arrangøren kan endre det. Ta kontakt med {data.hostName ?? 'arrangøren'} om noe må rettes.
      </EmptyState>
    )
  }

  // Lagret UTC → feltverdier i norsk veggklokke. Samme regning som ved lagring,
  // motsatt vei, så et arrangement ikke flytter seg en time av å bli åpnet.
  const start = utcToWallClock(data.startsAt)

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/kalender/sosialt/$socialId"
          params={{ socialId: data.id }}
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← {data.title}
        </Link>
        <Kicker className="mb-2">Sosialt</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink sm:text-4xl">Endre arrangement</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Svarene som allerede er gitt, blir stående. Setter du maks antall lavere enn antall påmeldte, mister ingen
          svaret sitt — de som ikke lenger får plass, havner nederst på ventelista i den rekkefølgen de svarte.
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <SocialEventForm
          initial={{
            title: data.title,
            description: data.description,
            location: data.location,
            startDate: start.date,
            startTime: start.time,
            deadlineDate: data.signupDeadline === null ? '' : toOsloDate(data.signupDeadline),
            capacity: data.capacity === null ? '' : String(data.capacity),
          }}
          submitLabel="Lagre"
          onCancel={back}
          onSubmit={async (values) => {
            try {
              await updateSocialEvent({ data: { ...values, id: data.id } })
              toast('Arrangementet er oppdatert')
              await back()
            } catch (err) {
              toastError(err)
            }
          }}
        />
      </section>
    </div>
  )
}
