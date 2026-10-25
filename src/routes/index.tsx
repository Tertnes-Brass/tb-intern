import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Icon } from '../components/Icons'
import { InstallHint } from '../components/InstallHint'
import { RsvpControl } from '../components/Rsvp'
import { EmptyState, Kicker, SectionHeading, Stamp } from '../components/ui'
import { formatDate, formatDateTime, formatTime, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../lib/format'
import { type HubEvent, chooseHero } from '../lib/hub'
import { getHub } from '../server/hub'

/**
 * Hub-forsiden for internsiden «Tertnes Brass Intern».
 *
 * `/` er plattformflaten, ikke et område: primærbrukeren er medlemmet, og
 * primærhandlingen er å se hva som skjer nå og komme seg videre til riktig
 * område. Den gjengir derfor ikke hvert områdes oversikt i miniatyr
 * (docs/designprinsipper.md §4) — den viser *det neste* og *veien videre*.
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getHub(),
  component: HubPage,
})

/** «19:00–21:30» eller «Hele dagen» — samme regel som på /kalender. */
function timeLabel(event: HubEvent): string {
  if (event.allDay) return 'Hele dagen'
  return formatTimeRange(event.start, event.end)
}

/**
 * Dato-blokken i hero: ukedag, dagtall og måned, med et valgfritt felt ved siden
 * av. Bare på desktop — på telefon står datoen allerede i linjen under tittelen,
 * og to ganger det samme koster en halv skjerm.
 */
function HeroDate({ iso, aside }: { iso: string; aside: string | null }) {
  return (
    <div className="sheet hidden shrink-0 items-stretch self-end overflow-hidden md:flex">
      <div className="flex flex-col items-center justify-center px-6 py-4">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">{formatWeekday(iso)}</span>
        <span className="display-title tabular text-[2.6rem] font-semibold leading-none text-ink">
          {Number(iso.slice(8, 10))}
        </span>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-brass">
          {formatDate(iso).split(' ').slice(1).join(' ')}
        </span>
      </div>
      {aside && (
        <div className="flex items-center border-l border-line bg-paper-sunken/60 px-5">
          <span className="max-w-[130px] text-xs leading-snug text-ink-soft">{aside}</span>
        </div>
      )}
    </div>
  )
}

const heroTitleClass =
  'display-title break-words text-[clamp(2.4rem,6.5vw,4.2rem)] font-semibold italic leading-[0.98] text-ink ' +
  'transition-colors hover:text-brass-strong [hyphens:auto]'

/** Liten dato-rute foran en rad i «Kommende». */
function RowDate({ iso }: { iso: string }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-[9px] border border-line bg-paper-sunken/60 px-2 py-2">
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-ink-faint">
        {formatWeekday(iso).slice(0, 3)}
      </span>
      <span className="display-title tabular text-xl font-semibold leading-none text-ink">{Number(iso.slice(8, 10))}</span>
    </div>
  )
}

function HubPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const hero = chooseHero(data)
  const next = data.nextProject
  // Kalenderen er hovedkilden; uten den er «Kommende» prosjektene i stedet.
  const useCalendar = data.calendar.configured && !data.calendar.error
  const upcomingEvents = data.calendar.upcoming
  const important = data.importantUnread
  // Den viktige beskjeden står allerede øverst; ikke vis den to ganger.
  const wallPosts = data.posts.filter((p) => p.id !== important?.id)

  return (
    <div className="space-y-12 md:space-y-14">
      {/*
        Rekkefølgen (docs/designprinsipper.md §7 pkt 3, revidert 25. oktober
        2026): «Neste» først, med svar på oppmøte rett i kortet. Det eneste som
        får legge seg over, er en «Viktig»-beskjed brukeren ikke har åpnet —
        og bare den ene. Resten av veggen står under notene.
      */}
      {important && (
        <Link
          to="/beskjeder/$postId"
          params={{ postId: important.id }}
          className="sheet link-quiet rise flex items-center gap-3 border-oxblood/40 px-4 py-3.5 transition-colors active:bg-paper-sunken can-hover:hover:border-oxblood/70"
        >
          <Stamp tone="oxblood">Viktig</Stamp>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-ink">{important.heading}</span>
            <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">
              {important.authorName} · {formatDateTime(important.publishedAt)}
            </span>
          </span>
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </Link>
      )}

      <section className="rise" style={{ animationDelay: '40ms' }}>
        {hero.kind === 'event' ? (
          <>
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <Kicker className="mb-3">Neste · {relativeDays(toOsloDate(hero.event.start))}</Kicker>
                {/* Til forekomsten, ikke til lista: derfra ser man hele
                    øvingsplanen og hvem som kommer (#82/#24). */}
                <Link
                  to="/kalender/$eventId"
                  params={{ eventId: hero.event.occurrenceKey }}
                  className="link-quiet block"
                >
                  <h1 className={heroTitleClass}>{hero.event.title}</h1>
                </Link>
                <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft md:mt-4">
                  {formatWeekday(toOsloDate(hero.event.start))} {formatDate(toOsloDate(hero.event.start))}
                  {hero.event.allDay ? '' : ` · ${timeLabel(hero.event)}`}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-4">
                  {hero.event.location && <Stamp tone="brass">{hero.event.location}</Stamp>}
                  {hero.event.allDay && <Stamp>Hele dagen</Stamp>}
                </div>
              </div>
              <HeroDate iso={toOsloDate(hero.event.start)} aside={timeLabel(hero.event)} />
            </div>
            {data.heroEvent && (
              <div className="sheet mt-6 px-4 py-4 sm:px-5 md:max-w-xl">
                <p className="kicker mb-3">Kommer du?</p>
                <RsvpControl
                  occurrenceKey={hero.event.occurrenceKey}
                  eventLabel={`${hero.event.title} · ${formatWeekday(toOsloDate(hero.event.start))} ${formatDate(toOsloDate(hero.event.start))}${hero.event.allDay ? '' : `, ${formatTime(hero.event.start)}`}`}
                  current={data.heroEvent.myAttendance}
                  onSaved={() => router.invalidate()}
                />
                {data.heroEvent.plan.length > 0 && (
                  <Link
                    to="/kalender/$eventId"
                    params={{ eventId: hero.event.occurrenceKey }}
                    className="link-quiet mt-3 flex min-h-11 items-center gap-3 border-t border-line pt-3"
                  >
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-brass">Øves</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {data.heroEvent.plan.join(' · ')}
                      {data.heroEvent.planMore > 0 ? ` · +${data.heroEvent.planMore}` : ''}
                    </span>
                    <Icon name="chevronRight" size={18} className="text-ink-faint" />
                  </Link>
                )}
              </div>
            )}
          </>
        ) : hero.kind === 'project' ? (
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Kicker className="mb-3">Neste prosjekt · {relativeDays(hero.project.eventDate)}</Kicker>
              <Link to="/noter/prosjekter/$projectId" params={{ projectId: hero.project.id }} className="link-quiet block">
                <h1 className={heroTitleClass}>{hero.project.name}</h1>
              </Link>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
                {formatWeekday(hero.project.eventDate)} {formatDate(hero.project.eventDate)}
                {hero.project.venue ? ` · ${hero.project.venue}` : ''}
              </p>
              {hero.project.description && (
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">{hero.project.description}</p>
              )}
            </div>
            <HeroDate iso={hero.project.eventDate} aside={hero.project.venue} />
          </div>
        ) : (
          <EmptyState title="Ingenting på programmet ennå">
            Når neste øvelse eller konsert er satt opp, står den her.
          </EmptyState>
        )}
      </section>

      <InstallHint />

      <section className="rise" style={{ animationDelay: '100ms' }}>
        <SectionHeading kicker="Mine noter" title="Klart på notestativet" className="mb-4" />
        <Link
          to="/noter"
          className="sheet link-quiet flex items-center gap-4 px-4 py-4 transition-colors active:bg-paper-sunken sm:px-5 can-hover:hover:border-line-strong"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[11px] bg-[var(--brass-soft)] text-brass-strong">
            <Icon name="notes" size={24} />
          </span>
          <span className="min-w-0 flex-1">
            {next ? (
              <>
                <span className="display-title block truncate text-[1.12rem] font-semibold text-ink">{next.name}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-soft">
                  {next.workCount === 1 ? '1 verk' : `${next.workCount} verk`}
                  {data.me.parts.length > 0
                    ? ` · ${data.me.parts.length === 1 ? 'din stemme' : 'dine stemmer'}: ${data.me.parts.map((p) => p.nameNo).join(', ')}`
                    : ' · ingen stemme registrert'}
                </span>
                <span className="mt-1 block font-mono text-[0.6rem] uppercase tracking-[0.14em] text-brass">
                  {formatDate(next.eventDate)} · {relativeDays(next.eventDate)}
                </span>
              </>
            ) : (
              <>
                <span className="display-title block text-[1.05rem] font-semibold text-ink">Mine noter</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
                  Ingen kommende prosjekter ennå — notene dine finner du likevel her.
                </span>
              </>
            )}
          </span>
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </Link>
      </section>

      {/*
        Veggen (#28). Blokken er lesegrensesnittet; publiseringsflyten bor i
        sitt eget navnerom, /beskjeder. Serveren har allerede filtrert bort
        utkast og beskjeder som ikke er for denne brukeren.
      */}
      <section className="rise" style={{ animationDelay: '160ms' }}>
        <SectionHeading
          kicker="Veggen"
          title="Siste beskjeder"
          className="mb-4"
          action={
            <Link to="/beskjeder" className="link-brass text-sm">
              Hele veggen →
            </Link>
          }
        />
        {wallPosts.length === 0 ? (
          <p className="text-sm text-ink-faint">Ingenting mer på veggen ennå — det kommer.</p>
        ) : (
          <ul>
            {wallPosts.map((post) => (
              <li key={post.id} className="hairline-row">
                <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="link-quiet block py-3">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="display-title text-base font-semibold text-ink">{post.heading}</span>
                    {(post.official || post.fromArchive) && <Stamp tone="brass">{post.fromArchive ? 'Fra notearkivar' : 'Fra styret'}</Stamp>}
                    {post.important && <Stamp tone="oxblood">Viktig</Stamp>}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">
                    {post.fromArchive ? 'Notearkivar' : post.official ? 'Styret' : post.authorName} · {formatDateTime(post.publishedAt)}
                    {post.likeCount > 0 ? ` · ${post.likeCount} liker` : ''}
                    {post.commentCount > 0
                      ? ` · ${post.commentCount} ${post.commentCount === 1 ? 'kommentar' : 'kommentarer'}`
                      : ''}
                  </span>
                  <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-ink-soft">{post.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rise" style={{ animationDelay: '220ms' }}>
        <SectionHeading
          kicker={useCalendar ? 'Kalenderen' : 'Lenger frem'}
          title="Kommende"
          className="mb-4"
          action={
            useCalendar ? (
              <Link to="/kalender" className="link-brass text-sm">
                Hele kalenderen →
              </Link>
            ) : (
              <Link to="/noter/prosjekter" className="link-brass text-sm">
                Alle prosjekter →
              </Link>
            )
          }
        />
        {useCalendar ? (
          upcomingEvents.length === 0 ? (
            <p className="text-sm text-ink-faint">Ingenting mer i kalenderen de neste åtte ukene.</p>
          ) : (
            <ul>
              {upcomingEvents.map((event) => (
                <li key={event.id} className="hairline-row">
                  <Link
                    to="/kalender/$eventId"
                    params={{ eventId: event.occurrenceKey }}
                    className="link-quiet flex items-center gap-4 py-3"
                  >
                    <RowDate iso={toOsloDate(event.start)} />
                    <span className="min-w-0 flex-1">
                      <span className="display-title block truncate text-base font-semibold text-ink">{event.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-soft">
                        {timeLabel(event)}
                        {event.location ? ` · ${event.location}` : ''}
                      </span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brass sm:inline">
                      {relativeDays(toOsloDate(event.start))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : data.upcomingProjects.length === 0 ? (
          <p className="text-sm text-ink-faint">Ingenting mer planlagt — foreløpig.</p>
        ) : (
          <ul>
            {data.upcomingProjects.map((p) => (
              <li key={p.id} className="hairline-row">
                <Link
                  to="/noter/prosjekter/$projectId"
                  params={{ projectId: p.id }}
                  className="link-quiet flex items-center gap-4 py-3"
                >
                  <RowDate iso={p.eventDate} />
                  <span className="min-w-0 flex-1">
                    <span className="display-title block truncate text-base font-semibold text-ink">{p.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-soft">
                      {formatDate(p.eventDate)}
                      {p.venue ? ` · ${p.venue}` : ''}
                    </span>
                  </span>
                  <span className="hidden shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brass sm:inline">
                    {relativeDays(p.eventDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* På telefon står områdene i «Meg og mer» (Launcher.tsx), så kortene
          her ville bare gjentatt menyen. */}
      <section className="rise hidden md:block" style={{ animationDelay: '280ms' }}>
        <SectionHeading kicker="Internsiden" title="Områder" className="mb-4" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.areas.map((area) => (
            <Link key={area.to} to={area.to} className="sheet sheet-hover link-quiet px-5 py-4">
              <span className="display-title block text-[1.02rem] font-semibold text-ink">{area.label}</span>
              <span className="mt-1 block text-xs leading-snug text-ink-soft">{area.description}</span>
              {area.note && (
                <span className="mt-2 block font-mono text-[0.62rem] uppercase tracking-[0.12em] text-brass">
                  {area.note}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
