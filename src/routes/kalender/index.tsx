import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Button, EmptyState, Kicker, SectionHeading, Stamp } from '../../components/ui'
import { CALENDAR_WINDOW_LABEL } from '../../lib/calendar-window'
import { formatDate, formatTime, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../../lib/format'
import type { CalendarEvent } from '../../lib/ical'
import { type CalendarRow, type SocialListItem, mergeCalendarRows, socialSummary } from '../../lib/social'
import { getCalendar } from '../../server/calendar'

export const Route = createFileRoute('/kalender/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getCalendar(),
  component: CalendarPage,
})

/**
 * Lista er ÉN liste med to kilder: Google-feeden og de lokale sosiale
 * arrangementene (#31). Medlemmet har ett program selv om vi har to
 * datakilder, og sammenslåingen skjer i `mergeCalendarRows` — den samme
 * funksjonen hub-en bruker, så de to listene ikke kan sortere ulikt.
 */
type Row = CalendarRow<CalendarEvent>

// Måned, ikke uke: med ukentlig øvelse gir uke-gruppering åtte overskrifter med
// én rad under hver, mens måned samler øvelsene og lar konsertene skille seg ut.
const monthFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

function monthKey(start: string): string {
  return toOsloDate(start).slice(0, 7)
}

function monthLabel(start: string): string {
  const label = monthFmt.format(new Date(start))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** «19:00–21:30», «Hele dagen» eller «14.–16. februar» for flerdagers. */
function timeLabel(event: CalendarEvent): string {
  if (!event.allDay) return formatTimeRange(event.start, event.end)
  const lastDay = event.end ? toOsloDate(Date.parse(event.end) - 1) : toOsloDate(event.start)
  if (lastDay === toOsloDate(event.start)) return 'Hele dagen'
  return `Til og med ${formatDate(lastDay)}`
}

function groupByMonth(rows: Row[]): Array<{ key: string; label: string; rows: Row[] }> {
  const groups: Array<{ key: string; label: string; rows: Row[] }> = []
  for (const row of rows) {
    const key = monthKey(row.start)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, label: monthLabel(row.start), rows: [row] })
  }
  return groups
}

function DateBlock({ start }: { start: string }) {
  const date = toOsloDate(start)
  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-[9px] border border-line bg-paper-sunken/60 px-2 py-2">
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-ink-faint">
        {formatWeekday(date).slice(0, 3)}
      </span>
      <span className="display-title tabular text-xl font-semibold leading-none text-ink">
        {Number(date.slice(8, 10))}
      </span>
    </div>
  )
}

/**
 * En diskret markør på radene som har en øvingsplan (#82). Bare det: at det
 * finnes en plan. Innholdet står på detaljsiden, og markøren røper ingenting om
 * oppmøte.
 */
function PlanMark() {
  return (
    <span
      title="Øvingsplan lagt inn"
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-brass"
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
        <path d="M1 2h7M1 4.5h7M1 7h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      Plan
    </span>
  )
}

function EventRow({ event, hasPlan }: { event: CalendarEvent; hasPlan: boolean }) {
  return (
    <li className="hairline-row">
      <Link
        to="/kalender/$eventId"
        params={{ eventId: event.occurrenceKey }}
        className="group flex items-center gap-4 py-3 transition-colors"
      >
        <DateBlock start={event.start} />
        <div className="min-w-0 flex-1">
          <p className="display-title truncate text-base font-semibold text-ink transition-colors group-hover:text-brass-strong">
            {event.title}
          </p>
          <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-ink-soft">
            <span className="truncate">
              {timeLabel(event)}
              {event.location ? ` · ${event.location}` : ''}
            </span>
            {hasPlan && <PlanMark />}
          </p>
        </div>
        <span className="hidden shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brass sm:inline">
          {relativeDays(toOsloDate(event.start))}
        </span>
      </Link>
    </li>
  )
}

/**
 * Et sosialt arrangement i lista. Tydelig merket «Sosialt» — det er et lokalt
 * arrangement en av medlemmene har laget, ikke noe som står i korpsets
 * Google-kalender, og det skal man kunne se uten å klikke seg inn.
 */
function SocialRow({ social }: { social: SocialListItem }) {
  return (
    <li className="hairline-row">
      <Link
        to="/kalender/sosialt/$socialId"
        params={{ socialId: social.id }}
        className="group flex items-center gap-4 py-3 transition-colors"
      >
        <DateBlock start={social.start} />
        <div className="min-w-0 flex-1">
          <p className="display-title flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-semibold text-ink transition-colors group-hover:text-brass-strong">
            <span className="truncate">{social.title}</span>
            <Stamp tone="brass">Sosialt</Stamp>
            {social.cancelled && <Stamp tone="oxblood">Avlyst</Stamp>}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {formatTime(social.start)}
            {social.location ? ` · ${social.location}` : ''}
            {' · '}
            {socialSummary({ going: social.going, waitlist: social.waitlist, notAttending: 0, unsure: 0 }, social.capacity)}
            {social.myStatus === 'attending' ? ' · Du kommer' : ''}
          </p>
        </div>
        <span className="hidden shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brass sm:inline">
          {relativeDays(toOsloDate(social.start))}
        </span>
      </Link>
    </li>
  )
}

function CalendarPage() {
  const data = Route.useLoaderData()
  const next = data.next
  // Hero-hendelsen gjentas ikke i lista under.
  const rest = next ? data.events.filter((e) => e.id !== next.id) : data.events
  const withPlan = new Set(data.keysWithPlan)
  // Feed og sosialt i én sortert liste. Hero er fortsatt forbeholdt feeden:
  // øvelsen eller konserten er avtalen, puben etterpå er tillegget.
  const rows = mergeCalendarRows(rest, data.social)

  return (
    <div className="space-y-14">
      <section className="rise">
        {!data.configured ? (
          <EmptyState title="Kalenderen er ikke koblet til ennå">
            En administrator må sette <code className="font-mono text-[0.8em]">CALENDAR_ICS_URL</code> — den hemmelige
            iCal-adressen fra korpsets Google-kalender — før øvelser og konserter dukker opp her.
          </EmptyState>
        ) : data.error ? (
          <EmptyState title="Fikk ikke tak i kalenderen">
            Vi nådde ikke Google Calendar akkurat nå. Prøv igjen om litt — kalenderen i Google er uansett den som
            gjelder.
          </EmptyState>
        ) : !next ? (
          <EmptyState title="Ingenting på programmet ennå">
            Det står ingen øvelser eller konserter i kalenderen de neste fire månedene.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Kicker className="mb-3">Neste · {relativeDays(toOsloDate(next.start))}</Kicker>
              <Link to="/kalender/$eventId" params={{ eventId: next.occurrenceKey }} className="link-quiet block">
                <h1 className="display-title break-words text-[clamp(2.4rem,6.5vw,4.2rem)] font-semibold italic leading-[0.98] text-ink [hyphens:auto]">
                  {next.title}
                </h1>
              </Link>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
                {formatWeekday(toOsloDate(next.start))} {formatDate(toOsloDate(next.start))}
                {next.allDay ? '' : ` · ${formatTimeRange(next.start, next.end)}`}
              </p>
              {next.description && (
                <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                  {next.description}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {next.location && <Stamp tone="brass">{next.location}</Stamp>}
                {next.allDay && <Stamp>Hele dagen</Stamp>}
              </div>
            </div>

            <div className="sheet flex shrink-0 items-stretch self-start overflow-hidden md:self-end">
              <div className="flex flex-col items-center justify-center px-6 py-4">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
                  {formatWeekday(toOsloDate(next.start))}
                </span>
                <span className="display-title tabular text-[2.6rem] font-semibold leading-none text-ink">
                  {Number(toOsloDate(next.start).slice(8, 10))}
                </span>
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-brass">
                  {formatDate(toOsloDate(next.start)).split(' ').slice(1).join(' ')}
                </span>
              </div>
              <div className="flex items-center border-l border-line bg-paper-sunken/60 px-5">
                <span className="font-mono text-xs leading-snug text-ink-soft">
                  {next.allDay ? 'Hele dagen' : formatTimeRange(next.start, next.end)}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/*
        Seksjonen står ALLTID, også når Google-feeden mangler eller feiler: de
        sosiale arrangementene er en lokal kilde som ikke faller med den, og
        «Nytt sosialt arrangement» er veien inn for alle medlemmer (#31). Uten
        den betingelsen ville en nede feed også tatt bort muligheten til å legge
        inn en pub etter øving.
      */}
      <section className="rise" style={{ animationDelay: '120ms' }}>
        <SectionHeading
          kicker={CALENDAR_WINDOW_LABEL}
          title="Kommende"
          className="mb-6"
          action={
            <Link to="/kalender/sosialt/ny">
              <Button size="sm">Nytt sosialt arrangement</Button>
            </Link>
          }
        />
        {rows.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Ingenting mer på programmet. Pub etter øving, fjelltur eller brettspillkveld — alle kan legge inn et
            sosialt arrangement.
          </p>
        ) : (
          <div className="space-y-8">
            {groupByMonth(rows).map((group) => (
              <div key={group.key}>
                <h3 className="kicker mb-1">{group.label}</h3>
                <ul>
                  {group.rows.map((row) =>
                    row.kind === 'feed' ? (
                      <EventRow
                        key={`feed-${row.id}`}
                        event={row.event}
                        hasPlan={withPlan.has(row.event.occurrenceKey)}
                      />
                    ) : (
                      <SocialRow key={`social-${row.id}`} social={row.social} />
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.embedUrl && (
        <section className="rise" style={{ animationDelay: '200ms' }}>
          <SectionHeading kicker="Fra Google" title="Hele kalenderen" className="mb-4" />
          <div className="sheet overflow-hidden">
            <iframe
              src={data.embedUrl}
              title="Google Calendar"
              loading="lazy"
              className="block h-[70vh] max-h-[720px] min-h-[420px] w-full border-0"
            />
          </div>
        </section>
      )}
    </div>
  )
}
