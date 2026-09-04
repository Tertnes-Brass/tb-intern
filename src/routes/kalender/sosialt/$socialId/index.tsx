import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toastError } from '../../../../components/toast'
import { Button, EmptyState, Kicker, SectionHeading, Stamp } from '../../../../components/ui'
import { formatDate, formatDateTime, formatTime, formatWeekday, relativeDays, toOsloDate } from '../../../../lib/format'
import {
  SOCIAL_COMMENT_MAX,
  SOCIAL_LABELS,
  SOCIAL_STATUSES,
  type SocialStatus,
  socialSummary,
} from '../../../../lib/social'
import { getSocialEvent, setMySignup, setSocialCancelled } from '../../../../server/social'
import type { SocialParticipant } from '../../../../server/social'

/**
 * Detaljsiden for ETT sosialt arrangement (#31).
 *
 * Ruta hører til Kalender-området og har sitt eget lille navnerom under det
 * (`/kalender/sosialt/$socialId`) — arrangementene er LOKALE og har en egen id,
 * så de kan ikke bo på `/kalender/$eventId`, som er `occurrenceKey` fra
 * Google-feeden (docs/designprinsipper.md §2, AGENTS.md om occurrenceKey).
 *
 * Deltakerlista er synlig for alle medlemmer. Det er ikke oppmøtelistas
 * innsynsregel (#82/#24) glemt: der er spørsmålet hvem som ikke kom på
 * øvelsen, her er det hvem du møter på julebordet.
 */
export const Route = createFileRoute('/kalender/sosialt/$socialId/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getSocialEvent({ data: { id: params.socialId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne arrangementet">{error.message}</EmptyState>,
  component: SocialEventPage,
})

type Detail = Awaited<ReturnType<typeof getSocialEvent>>

function SocialEventPage() {
  const data = Route.useLoaderData()
  const date = toOsloDate(data.startsAt)

  return (
    <div className="space-y-12">
      <header className="rise">
        <Link
          to="/kalender"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Kalender
        </Link>
        <Kicker className="mb-3">Sosialt · {relativeDays(date)}</Kicker>
        <h1 className="display-title break-words text-[clamp(2rem,5.5vw,3.4rem)] font-semibold italic leading-[1.02] text-ink [hyphens:auto]">
          {data.title}
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
          {formatWeekday(date)} {formatDate(date)} · {formatTime(data.startsAt)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {data.cancelled && <Stamp tone="oxblood">Avlyst</Stamp>}
          {data.location && <Stamp tone="brass">{data.location}</Stamp>}
          {data.capacity !== null && <Stamp>Maks {data.capacity}</Stamp>}
        </div>
        {data.description && (
          <p className="mt-5 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink-soft">{data.description}</p>
        )}
        <p className="mt-5 text-xs text-ink-faint">
          Arrangør: {data.hostName ?? 'Ukjent'}
          {data.signupDeadline !== null && ` · Påmeldingsfrist ${formatDateTime(data.signupDeadline)}`}
        </p>
        {data.canEdit && <HostActions data={data} />}
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <MySignup data={data} />
      <Participants data={data} />
    </div>
  )
}

/** Arrangørens egne knapper. Avlysning er myk og kan angres — ingen sletting. */
function HostActions({ data }: { data: Detail }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      await setSocialCancelled({ data: { id: data.id, cancelled: !data.cancelled } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link to="/kalender/sosialt/$socialId/rediger" params={{ socialId: data.id }}>
        <Button size="sm">Endre</Button>
      </Link>
      <Button size="sm" variant={data.cancelled ? 'secondary' : 'danger'} loading={busy} onClick={toggle}>
        {data.cancelled ? 'Ta opp igjen' : 'Avlys'}
      </Button>
    </div>
  )
}

function MySignup({ data }: { data: Detail }) {
  const router = useRouter()
  const [comment, setComment] = useState(data.my?.comment ?? '')
  const [busy, setBusy] = useState<SocialStatus | 'clear' | null>(null)

  useEffect(() => {
    setComment(data.my?.comment ?? '')
  }, [data.my?.comment])

  const write = async (status: SocialStatus | null, nextComment: string) => {
    setBusy(status ?? 'clear')
    try {
      await setMySignup({ data: { id: data.id, status, comment: status ? nextComment : null } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  // Fullt hus er ikke en stengt dør: svaret blir stående, det havner bare bak
  // dem som svarte først. Teksten sier det FØR man trykker.
  const wouldWaitlist = data.spotsLeft === 0 && data.my?.status !== 'attending'

  return (
    <section className="rise" style={{ animationDelay: '80ms' }}>
      <div className="sheet px-4 py-4 sm:px-5">
        <p className="kicker mb-3">Ditt svar</p>
        <div className="flex flex-wrap gap-2">
          {SOCIAL_STATUSES.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={data.my?.status === status ? 'primary' : 'secondary'}
              loading={busy === status}
              disabled={!data.state.allowed.includes(status)}
              onClick={() => write(status, comment)}
            >
              {SOCIAL_LABELS[status]}
            </Button>
          ))}
          {data.my && data.state.canClear && (
            <Button size="sm" variant="ghost" loading={busy === 'clear'} onClick={() => write(null, '')}>
              Nullstill
            </Button>
          )}
        </div>

        {data.state.message && <p className="mt-3 text-xs text-ink-faint">{data.state.message}</p>}
        {data.state.open && wouldWaitlist && (
          <p className="mt-3 text-xs text-ink-faint">
            Det er fullt. Svarer du «kommer» nå, havner du på venteliste — og rykker opp hvis noen melder avbud.
          </p>
        )}
        {data.myWaitlistPosition !== null && (
          <p className="mt-3 text-xs text-brass">
            Du står som nummer {data.myWaitlistPosition} på ventelista.
          </p>
        )}

        {data.my && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="field-input max-w-sm !text-base sm:!text-sm"
              placeholder="Kommentar (valgfri) — «vegetar», «kan kjøre fire stk»"
              value={comment}
              maxLength={SOCIAL_COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') write(data.my!.status, comment)
              }}
            />
            {comment !== (data.my.comment ?? '') && (
              <Button size="sm" onClick={() => write(data.my!.status, comment)}>
                Lagre
              </Button>
            )}
          </div>
        )}
        {!data.my && data.state.open && (
          <p className="mt-3 text-xs text-ink-faint">Du har ikke svart ennå. Svaret kan endres når som helst.</p>
        )}
      </div>
    </section>
  )
}

function Participants({ data }: { data: Detail }) {
  const nobody = data.going.length + data.waitlist.length + data.unsure.length + data.notAttending.length === 0

  return (
    <section className="rise space-y-6" style={{ animationDelay: '160ms' }}>
      <SectionHeading kicker={socialSummary(data.counts, data.capacity)} title="Hvem kommer" />
      {nobody ? (
        <EmptyState title="Ingen har svart ennå">Vær den første — det pleier å løsne etter det.</EmptyState>
      ) : (
        <div className="space-y-6">
          <PeopleList label="Kommer" people={data.going} />
          <PeopleList label="Venteliste" people={data.waitlist} numbered />
          <PeopleList label="Usikre" people={data.unsure} />
          <PeopleList label="Kommer ikke" people={data.notAttending} />
        </div>
      )}
    </section>
  )
}

function PeopleList({
  label,
  people,
  numbered,
}: {
  label: string
  people: SocialParticipant[]
  numbered?: boolean
}) {
  if (people.length === 0) return null
  return (
    <div>
      <h3 className="kicker mb-1">
        {label} · {people.length}
      </h3>
      <ul className="sheet overflow-hidden">
        {people.map((person, index) => (
          <li key={person.userId} className="hairline-row flex items-start gap-3 px-4 py-2.5 sm:px-5">
            {numbered && (
              <span className="display-title tabular mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-ink-faint">
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{person.name}</p>
              {person.comment && <p className="mt-0.5 text-xs italic text-ink-soft">«{person.comment}»</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
