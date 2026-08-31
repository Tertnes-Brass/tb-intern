import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { EmptyState, Kicker, SectionHeading, Stamp } from '../components/ui'
import { formatDate, formatDateTime, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../lib/format'
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

/** Dato-blokken i hero: ukedag, dagtall og måned, med et valgfritt felt ved siden av. */
function HeroDate({ iso, aside }: { iso: string; aside: string | null }) {
  return (
    <div className="sheet flex shrink-0 items-stretch self-start overflow-hidden md:self-end">
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
  const hero = chooseHero(data)
  const next = data.nextProject
  // Kalenderen er hovedkilden; uten den er «Kommende» prosjektene i stedet.
  const useCalendar = data.calendar.configured && !data.calendar.error
  const upcomingEvents = data.calendar.upcoming

  return (
    <div className="space-y-14">
      {/*
        Beskjeder (#28) står øverst, over hero: en melding fra styret er det
        eneste som skal kunne fortrenge «Neste» (docs/designprinsipper.md §7
        pkt 3). Blokken er lesegrensesnittet; publiseringsflyten bor i sitt eget
        navnerom, /beskjeder. Serveren har allerede filtrert bort utkast og
        beskjeder som ikke er for denne brukeren.
      */}
      <section className="rise">
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
        {data.posts.length === 0 ? (
          <p className="text-sm text-ink-faint">Ingenting på veggen ennå — det kommer.</p>
        ) : (
          <ul>
            {data.posts.map((post) => (
              <li key={post.id} className="hairline-row">
                <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="link-quiet block py-3">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="display-title text-base font-semibold text-ink">{post.heading}</span>
                    {post.official && <Stamp tone="brass">Fra styret</Stamp>}
                    {post.important && <Stamp tone="oxblood">Viktig</Stamp>}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">
                    {post.official ? 'Styret' : post.authorName} · {formatDateTime(post.publishedAt)}
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

      <section className="rise" style={{ animationDelay: '60ms' }}>
        {hero.kind === 'event' ? (
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Kicker className="mb-3">Neste · {relativeDays(toOsloDate(hero.event.start))}</Kicker>
              <Link to="/kalender" className="link-quiet block">
                <h1 className={heroTitleClass}>{hero.event.title}</h1>
              </Link>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
                {formatWeekday(toOsloDate(hero.event.start))} {formatDate(toOsloDate(hero.event.start))}
                {hero.event.allDay ? '' : ` · ${timeLabel(hero.event)}`}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hero.event.location && <Stamp tone="brass">{hero.event.location}</Stamp>}
                {hero.event.allDay && <Stamp>Hele dagen</Stamp>}
              </div>
            </div>
            <HeroDate iso={toOsloDate(hero.event.start)} aside={timeLabel(hero.event)} />
          </div>
        ) : hero.kind === 'project' ? (
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Kicker className="mb-3">Neste prosjekt · {relativeDays(hero.project.eventDate)}</Kicker>
              <Link to="/noter/prosjekter/$projectId" params={{ projectId: hero.project.id }} className="link-quiet block">
                <h1 className={heroTitleClass}>{hero.project.name}</h1>
              </Link>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
                {formatWeekday(hero.project.eventDate)} {formatDate(hero.project.eventDate)}
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

      <section className="rise" style={{ animationDelay: '120ms' }}>
        <SectionHeading kicker="Mine noter" title="Stemmene dine" className="mb-4" />
        <div className="sheet flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-6">
          <div className="min-w-0">
            {next && hero.kind !== 'project' ? (
              <>
                <p className="display-title text-[1.15rem] font-semibold text-ink">{next.name}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {formatDate(next.eventDate)}
                  {next.venue ? ` · ${next.venue}` : ''} · {relativeDays(next.eventDate)}
                </p>
                <p className="mt-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">
                  {next.workCount === 1 ? '1 verk i programmet' : `${next.workCount} verk i programmet`}
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-ink-soft">
                {next
                  ? 'Programmet, stemmene dine og lytteeksemplene ligger klare i noteområdet.'
                  : 'Ingen kommende prosjekter ennå — notene dine finner du likevel i noteområdet.'}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {data.me.parts.length > 0 ? (
                data.me.parts.map((p) => (
                  <Stamp key={p.id} tone="brass">
                    {p.nameNo}
                  </Stamp>
                ))
              ) : (
                <Stamp>Ingen stemme registrert</Stamp>
              )}
              <Stamp>{data.me.roleName}</Stamp>
            </div>
          </div>
          <Link
            to="/noter"
            className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[9px] bg-brass px-4 py-2 text-sm font-medium text-paper-raised shadow-[0_1px_2px_rgba(43,34,16,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:bg-brass-strong dark:text-paper"
          >
            Åpne mine noter
          </Link>
        </div>
      </section>

      <section className="rise" style={{ animationDelay: '200ms' }}>
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
                <li key={event.id} className="hairline-row flex items-center gap-4 py-3">
                  <RowDate iso={toOsloDate(event.start)} />
                  <div className="min-w-0 flex-1">
                    <p className="display-title truncate text-base font-semibold text-ink">{event.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {timeLabel(event)}
                      {event.location ? ` · ${event.location}` : ''}
                    </p>
                  </div>
                  <span className="hidden shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brass sm:inline">
                    {relativeDays(toOsloDate(event.start))}
                  </span>
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

      <section className="rise" style={{ animationDelay: '280ms' }}>
        <SectionHeading kicker="Internsiden" title="Områder" className="mb-4" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.areas.map((area) => (
            <Link key={area.to} to={area.to} className="sheet sheet-hover link-quiet px-5 py-4">
              <span className="display-title block text-[1.02rem] font-semibold text-ink">{area.label}</span>
              <span className="mt-1 block text-xs leading-snug text-ink-soft">{area.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
