import { createFileRoute, redirect } from '@tanstack/react-router'
import { EmptyState, Kicker, SectionHeading, Stamp } from '../../components/ui'
import { CALENDAR_WINDOW_LABEL } from '../../lib/calendar-window'
import { formatDate, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../../lib/format'
import type { CalendarEvent } from '../../lib/ical'
import { getCalendar } from '../../server/calendar'

export const Route = createFileRoute('/kalender/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getCalendar(),
  component: CalendarPage,
})

// Måned, ikke uke: med ukentlig øvelse gir uke-gruppering åtte overskrifter med
// én rad under hver, mens måned samler øvelsene og lar konsertene skille seg ut.
const monthFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

function monthKey(event: CalendarEvent): string {
  return toOsloDate(event.start).slice(0, 7)
}

function monthLabel(event: CalendarEvent): string {
  const label = monthFmt.format(new Date(event.start))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** «19:00–21:30», «Hele dagen» eller «14.–16. februar» for flerdagers. */
function timeLabel(event: CalendarEvent): string {
  if (!event.allDay) return formatTimeRange(event.start, event.end)
  const lastDay = event.end ? toOsloDate(Date.parse(event.end) - 1) : toOsloDate(event.start)
  if (lastDay === toOsloDate(event.start)) return 'Hele dagen'
  return `Til og med ${formatDate(lastDay)}`
}

function groupByMonth(events: CalendarEvent[]): Array<{ key: string; label: string; events: CalendarEvent[] }> {
  const groups: Array<{ key: string; label: string; events: CalendarEvent[] }> = []
  for (const event of events) {
    const key = monthKey(event)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(event)
    else groups.push({ key, label: monthLabel(event), events: [event] })
  }
  return groups
}

function DateBlock({ event }: { event: CalendarEvent }) {
  const date = toOsloDate(event.start)
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

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <li className="hairline-row flex items-center gap-4 py-3">
      <DateBlock event={event} />
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
  )
}

function CalendarPage() {
  const data = Route.useLoaderData()
  const next = data.next
  // Hero-hendelsen gjentas ikke i lista under.
  const rest = next ? data.events.filter((e) => e.id !== next.id) : data.events

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
              <h1 className="display-title break-words text-[clamp(2.4rem,6.5vw,4.2rem)] font-semibold italic leading-[0.98] text-ink [hyphens:auto]">
                {next.title}
              </h1>
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

      {data.configured && !data.error && rest.length > 0 && (
        <section className="rise" style={{ animationDelay: '120ms' }}>
          <SectionHeading kicker={CALENDAR_WINDOW_LABEL} title="Kommende" className="mb-6" />
          <div className="space-y-8">
            {groupByMonth(rest).map((group) => (
              <div key={group.key}>
                <h3 className="kicker mb-1">{group.label}</h3>
                <ul>
                  {group.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

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
