import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { SocialEventForm } from '../../../components/SocialEventForm'
import { toast, toastError } from '../../../components/toast'
import { Kicker } from '../../../components/ui'
import { toOsloDate } from '../../../lib/format'
import { createSocialEvent } from '../../../server/social'

/**
 * Nytt sosialt arrangement (#31). Ingen rettighetssjekk utover innlogging:
 * ALLE aktive medlemmer kan foreslå en pub etter øving eller en fjelltur. Det
 * er et bevisst produktvalg — korpset er et sosialt fellesskap, og en terskel
 * her ville gjort at forslagene ble værende i Facebook-gruppen.
 * `createSocialEvent` håndhever det samme server-side.
 */
export const Route = createFileRoute('/kalender/sosialt/ny')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  component: NewSocialEventPage,
})

function NewSocialEventPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/kalender"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Kalender
        </Link>
        <Kicker className="mb-2">Sosialt</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink sm:text-4xl">Nytt arrangement</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Pub etter øving, julebord, fjelltur, dugnad eller brettspillkveld. Alle medlemmer kan lage et arrangement, og
          det dukker opp i kalenderen sammen med øvelsene. Du står som arrangør og kan endre eller avlyse det siden.
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <SocialEventForm
          initial={{ startDate: toOsloDate(Date.now()) }}
          submitLabel="Opprett"
          onCancel={() => navigate({ to: '/kalender' })}
          onSubmit={async (values) => {
            try {
              const { id } = await createSocialEvent({ data: values })
              toast('Arrangementet er lagt inn')
              await navigate({ to: '/kalender/sosialt/$socialId', params: { socialId: id } })
            } catch (err) {
              toastError(err)
            }
          }}
        />
      </section>
    </div>
  )
}
