import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { DateTile, ListHeader, eventDayLabel, eventTimeLabel, rsvpEventLabel } from '../components/calendar/parts'
import { Icon } from '../components/Icons'
import { InstallHint } from '../components/InstallHint'
import { RsvpControl } from '../components/Rsvp'
import { Stamp } from '../components/ui'
import { formatDate, formatDateTime, formatWeekday, relativeDays, toOsloDate } from '../lib/format'
import { type HubEvent, type HubProject, chooseHero } from '../lib/hub'
import { offlineStand, onOfflineChange } from '../lib/offline-notes'
import { getHub } from '../server/hub'

/**
 * Hub-forsiden for internsiden «Tertnes Brass Intern».
 *
 * `/` er plattformflaten, ikke et område: primærbrukeren er medlemmet, og
 * primærhandlingen er å se hva som skjer nå og komme seg videre til riktig
 * område. Den gjengir derfor ikke hvert områdes oversikt i miniatyr
 * (docs/designprinsipper.md §4) — den viser *det neste* og *veien videre*.
 *
 * Oppsettet (4. november 2026): ÉN hevet modul, «Neste», med hendelsen,
 * oppmøtet og øvingsplanen samlet, og «Mine noter» rett etter — begge innenfor
 * første skjerm på telefonen. Fra 768 px står de i to spalter (`.hub-grid`):
 * «Neste» og «Kommende» til venstre, «Mine noter» og beskjedene til høyre.
 * Rekkefølgen i DOM-en (og på telefon) er den i §7 pkt 3.
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getHub(),
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: HubPage,
})

type HubData = Awaited<ReturnType<typeof getHub>>

function HubPage() {
  const data = Route.useLoaderData()
  const hero = chooseHero(data)
  const important = data.importantUnread

  return (
    <div className="space-y-7 md:space-y-8">
      {/*
        Rekkefølgen (docs/designprinsipper.md §7 pkt 3): det eneste som får
        legge seg over «Neste», er en «Viktig»-beskjed brukeren ikke har åpnet
        — og bare den ene.
      */}
      {important && (
        <Link
          to="/beskjeder/$postId"
          params={{ postId: important.id }}
          className="link-quiet rise flex items-center gap-3 rounded-[12px] border border-oxblood/35 bg-oxblood/[0.06] px-4 py-3 transition-colors active:bg-oxblood/10 can-hover:hover:border-oxblood/60"
        >
          <Stamp tone="oxblood">Viktig</Stamp>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-ink">{important.heading}</span>
            <span className="mt-0.5 block text-[0.8rem] leading-snug text-ink-soft">
              {important.authorName} · {formatDateTime(important.publishedAt)}
            </span>
          </span>
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </Link>
      )}

      <div className="hub-grid">
        <section className="hub-next rise" style={{ animationDelay: '30ms' }} aria-label="Neste">
          {hero.kind === 'event' ? (
            <NextEventCard event={hero.event} details={data.heroEvent} />
          ) : hero.kind === 'project' ? (
            <NextProjectCard project={hero.project} />
          ) : (
            <div className="next-card px-5 pb-6 pt-7">
              <p className="kicker mb-2">Neste</p>
              <h1 className="display-title text-[1.6rem] font-semibold italic leading-tight text-ink">
                Ingenting på programmet ennå
              </h1>
              <p className="mt-2 text-sm text-ink-soft">Når neste øvelse eller konsert er satt opp, står den her.</p>
            </div>
          )}
        </section>

        <div className="hub-notes rise space-y-4" style={{ animationDelay: '70ms' }}>
          <NotesShortcut data={data} />
          <InstallHint />
        </div>

        <PostsSection data={data} />
        <UpcomingSection data={data} />
      </div>

      {/* På berøringsskjerm står områdene i «Meg og mer» (Launcher.tsx),
          så kortene her ville bare gjentatt menyen. */}
      <section className="rise hidden pt-4 desknav:block" style={{ animationDelay: '220ms' }}>
        <ListHeader title="Områder" className="mb-4" />
        <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {data.areas.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              className="link-quiet group flex items-start gap-3 border-b border-line py-3.5"
            >
              <span className="min-w-0 flex-1">
                <span className="display-title block text-[1.02rem] font-semibold text-ink transition-colors group-hover:text-brass-strong">
                  {area.label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{area.description}</span>
                {area.note && (
                  <span className="mt-1 block text-xs font-medium text-brass-strong">
                    {area.note}
                  </span>
                )}
              </span>
              <Icon name="chevronRight" size={16} className="mt-1 text-ink-faint" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------- «Neste» ----------

const nextTitleClass =
  'display-title break-words text-[clamp(1.9rem,6.4vw,2.6rem)] font-semibold italic leading-[1.02] text-ink [hyphens:auto]'

/**
 * Den ene modulen øverst: hva, når, hvor — og «kommer du?» og hva som øves,
 * uten å forlate Hjem. Tittelen og plan-raden lenker til forekomsten.
 */
function NextEventCard({ event, details }: { event: HubEvent; details: HubData['heroEvent'] }) {
  const router = useRouter()
  const date = toOsloDate(event.start)
  return (
    <article className="next-card">
      <div className="flex gap-4 px-4 pb-4 pt-5 sm:px-5">
        <DateTile iso={date} size="lg" tone="brass" srLabel={false} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="kicker mb-1.5">Neste · {relativeDays(date)}</p>
          {/* Til forekomsten, ikke til lista: derfra ser man hele øvingsplanen
              og hvem som kommer (#82/#24). */}
          <Link to="/kalender/$eventId" params={{ eventId: event.occurrenceKey }} className="link-quiet block">
            <h1 className={`${nextTitleClass} transition-colors can-hover:hover:text-brass-strong`}>{event.title}</h1>
          </Link>
          <p className="mt-2 text-[0.92rem] leading-snug text-ink-soft">
            <span className="text-ink">{eventDayLabel(event)}</span>
            {' · '}
            {eventTimeLabel(event)}
          </p>
          {event.location && (
            <p className="mt-1 flex items-start gap-1.5 text-[0.92rem] leading-snug text-ink-soft">
              <Icon name="pin" size={15} className="mt-[3px] shrink-0 text-brass" />
              <span className="min-w-0 break-words">{event.location}</span>
            </p>
          )}
        </div>
      </div>

      {details && (
        <div className="next-card-row px-4 py-3.5 sm:px-5">
          <RsvpControl
            occurrenceKey={event.occurrenceKey}
            eventLabel={rsvpEventLabel(event)}
            current={details.myAttendance}
            onSaved={() => router.invalidate()}
            compact
          />
        </div>
      )}

      <Link
        to="/kalender/$eventId"
        params={{ eventId: event.occurrenceKey }}
        className="next-card-row link-quiet flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors active:bg-paper-sunken sm:px-5 can-hover:hover:bg-paper-sunken/60"
      >
        {details && details.plan.length > 0 ? (
          <>
            <span className="shrink-0 text-[0.8rem] font-semibold text-brass-strong">Øves</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {details.plan.join(' · ')}
              {details.planMore > 0 ? ` · +${details.planMore}` : ''}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
            {details ? 'Ingen øvingsplan ennå — se hendelsen' : 'Se hendelsen'}
          </span>
        )}
        <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />
      </Link>
    </article>
  )
}

/** Uten kalender: neste publiserte prosjekt tar plassen. */
function NextProjectCard({ project }: { project: HubProject }) {
  return (
    <article className="next-card">
      <div className="flex gap-4 px-4 pb-4 pt-5 sm:px-5">
        <DateTile iso={project.eventDate} size="lg" tone="brass" srLabel={false} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="kicker mb-1.5">Neste prosjekt · {relativeDays(project.eventDate)}</p>
          <Link to="/noter/prosjekter/$projectId" params={{ projectId: project.id }} className="link-quiet block">
            <h1 className={nextTitleClass}>{project.name}</h1>
          </Link>
          <p className="mt-2 text-[0.92rem] leading-snug text-ink-soft">
            <span className="text-ink">
              {formatWeekday(project.eventDate)} {formatDate(project.eventDate)}
            </span>
            {project.venue ? ` · ${project.venue}` : ''}
          </p>
          {project.description && (
            <p className="mt-2 line-clamp-3 max-w-xl text-sm leading-relaxed text-ink-soft">{project.description}</p>
          )}
        </div>
      </div>
      <Link
        to="/noter/prosjekter/$projectId"
        params={{ projectId: project.id }}
        className="next-card-row link-quiet flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors active:bg-paper-sunken sm:px-5"
      >
        <span className="flex-1">Se prosjektet</span>
        <Icon name="chevronRight" size={18} className="text-ink-faint" />
      </Link>
    </article>
  )
}

// ---------- Mine noter ----------

function NotesShortcut({ data }: { data: HubData }) {
  const next = data.nextProject
  const savedOffline = useSavedOffline(next?.id ?? null)
  return (
    <Link
      to="/noter"
      className="link-quiet flex items-center gap-4 rounded-[14px] border border-line bg-paper-raised px-4 py-3.5 transition-colors active:bg-paper-sunken sm:px-5 can-hover:hover:border-line-strong"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-[var(--brass-soft)] text-brass-strong">
        <Icon name="notes" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        {next ? (
          <>
            <span className="block font-mono text-[0.6rem] uppercase tracking-[0.18em] text-brass">Mine noter</span>
            <span className="display-title mt-0.5 block truncate text-[1.08rem] font-semibold text-ink">{next.name}</span>
            <span className="mt-0.5 block text-[0.8rem] leading-snug text-ink-soft">
              {formatDate(next.eventDate)} · {next.workCount === 1 ? '1 verk' : `${next.workCount} verk`}
              {data.me.parts.length > 0
                ? ` · ${data.me.parts.map((p) => p.nameNo).join(', ')}`
                : ' · ingen stemme registrert'}
            </span>
            {savedOffline && (
              <span className="mt-0.5 flex items-center gap-1 text-[0.8rem] font-medium text-ok">
                <Icon name="check" size={13} strokeWidth={2.2} />
                Lagret offline
              </span>
            )}
          </>
        ) : (
          // Ingenting å spille ennå: ikke lov noe som er «klart». Samme
          // beskjed som tomtilstanden på /noter.
          <>
            <span className="display-title block text-[1.08rem] font-semibold text-ink">Mine noter</span>
            <span className="mt-0.5 block text-[0.8rem] leading-snug text-ink-soft">
              Ingen kommende prosjekter — se tidligere prosjekter.
            </span>
          </>
        )}
      </span>
      <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />
    </Link>
  )
}

// ---------- Siste beskjeder ----------

/**
 * Veggen (#28). Blokken er lesegrensesnittet; publiseringsflyten bor i sitt
 * eget navnerom, /beskjeder. Serveren har allerede filtrert bort utkast og
 * beskjeder som ikke er for denne brukeren.
 */
function PostsSection({ data }: { data: HubData }) {
  // Den viktige beskjeden står allerede øverst; ikke vis den to ganger.
  const posts = data.posts.filter((p) => p.id !== data.importantUnread?.id)
  return (
    <section className="hub-posts rise" style={{ animationDelay: '110ms' }}>
      <ListHeader
        title="Siste beskjeder"
        action={
          <Link to="/beskjeder" className="link-brass hit">
            Veggen
          </Link>
        }
      />
      {posts.length === 0 ? (
        <p className="py-3 text-sm text-ink-faint">Ingenting mer på veggen ennå — det kommer.</p>
      ) : (
        <ul>
          {posts.map((post) => (
            <li key={post.id} className="hairline-row">
              <Link
                to="/beskjeder/$postId"
                params={{ postId: post.id }}
                className="link-quiet group block py-3"
              >
                <span className="flex items-baseline gap-2">
                  <span className="display-title min-w-0 flex-1 truncate text-[1rem] font-semibold text-ink transition-colors group-hover:text-brass-strong">
                    {post.heading}
                  </span>
                  {post.important ? (
                    <Stamp tone="oxblood">Viktig</Stamp>
                  ) : (
                    (post.official || post.fromArchive) && (
                      <Stamp tone="brass">{post.fromArchive ? 'Notearkivar' : 'Styret'}</Stamp>
                    )
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-soft">{post.excerpt}</span>
                <span className="mt-1 block text-[0.8rem] leading-snug text-ink-soft">
                  {post.fromArchive ? 'Notearkivar' : post.official ? 'Styret' : post.authorName} ·{' '}
                  {formatDateTime(post.publishedAt)}
                  {post.commentCount > 0 ? ` · ${post.commentCount} ${post.commentCount === 1 ? 'kommentar' : 'kommentarer'}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Kommende ----------

function UpcomingSection({ data }: { data: HubData }) {
  // Kalenderen er hovedkilden; uten den er «Kommende» prosjektene i stedet.
  const useCalendar = data.calendar.configured && !data.calendar.error
  return (
    <section className="hub-upcoming rise" style={{ animationDelay: '150ms' }}>
      <ListHeader
        title="Kommende"
        action={
          useCalendar ? (
            <Link to="/kalender" className="link-brass hit">
              Kalender
            </Link>
          ) : (
            <Link to="/noter/prosjekter" className="link-brass hit">
              Prosjekter
            </Link>
          )
        }
      />
      {useCalendar ? (
        data.calendar.upcoming.length === 0 ? (
          <p className="py-3 text-sm text-ink-faint">Ingenting mer i kalenderen de neste ukene.</p>
        ) : (
          <ul>
            {data.calendar.upcoming.map((event) => (
              <UpcomingRow
                key={event.id}
                date={toOsloDate(event.start)}
                title={event.title}
                meta={`${eventTimeLabel(event)}${event.location ? ` · ${event.location}` : ''}`}
                link={{ to: '/kalender/$eventId', params: { eventId: event.occurrenceKey } }}
              />
            ))}
          </ul>
        )
      ) : data.upcomingProjects.length === 0 ? (
        <p className="py-3 text-sm text-ink-faint">Ingenting mer planlagt — foreløpig.</p>
      ) : (
        <ul>
          {data.upcomingProjects.map((p) => (
            <UpcomingRow
              key={p.id}
              date={p.eventDate}
              title={p.name}
              meta={`${formatDate(p.eventDate)}${p.venue ? ` · ${p.venue}` : ''}`}
              link={{ to: '/noter/prosjekter/$projectId', params: { projectId: p.id } }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function UpcomingRow({
  date,
  title,
  meta,
  link,
}: {
  date: string
  title: string
  meta: string
  link:
    | { to: '/kalender/$eventId'; params: { eventId: string } }
    | { to: '/noter/prosjekter/$projectId'; params: { projectId: string } }
}) {
  return (
    <li className="hairline-row">
      <Link {...link} className="link-quiet group flex items-center gap-3.5 py-2.5">
        <DateTile iso={date} />
        <span className="min-w-0 flex-1">
          <span className="display-title block truncate text-[1rem] font-semibold text-ink transition-colors group-hover:text-brass-strong">
            {title}
          </span>
          <span className="mt-0.5 block break-words text-[0.8rem] leading-snug text-ink-soft">{meta}</span>
        </span>
        {/* Datoflisen sier allerede når; på smal skjerm får tittelen plassen. */}
        <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">
          {relativeDays(date)}
        </span>
      </Link>
    </li>
  )
}

/** Er stativet for prosjektet lagret på denne enheten? Bare klienten vet det. */
function useSavedOffline(projectId: string | null): boolean {
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!projectId) return setSaved(false)
    const sync = () => setSaved(offlineStand(projectId) !== null)
    sync()
    return onOfflineChange(sync)
  }, [projectId])
  return saved
}
