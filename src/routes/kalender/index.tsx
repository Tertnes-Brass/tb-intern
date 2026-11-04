import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  DateTile,
  ListHeader,
  PlanGlyph,
  RowMark,
  eventDayLabel,
  eventTimeLabel,
  rsvpEventLabel,
} from '../../components/calendar/parts'
import { Icon } from '../../components/Icons'
import { RsvpControl } from '../../components/Rsvp'
import { EmptyState, PageHeader, Stamp } from '../../components/ui'
import { ATTENDANCE_PERMISSION, attendanceSummary } from '../../lib/attendance'
import { CALENDAR_WINDOW_LABEL } from '../../lib/calendar-window'
import { relativeDays, toOsloDate } from '../../lib/format'
import type { CalendarEvent } from '../../lib/ical'
import { isOccurrenceKey } from '../../lib/occurrence'
import { getCalendar } from '../../server/calendar'
import { getEventDetail } from '../../server/event-meta'

/**
 * Kalenderen: agendaen først. På telefon er hver rad en lenke til
 * `/kalender/$eventId`. Fra 768 px (iPad) står agendaen til venstre og den
 * valgte hendelsen til høyre — tittel, tid, sted, ditt oppmøte, øvingsplanen
 * og tallene — uten å forlate lista.
 *
 * Valget står i adressen (`?valgt=<occurrenceKey>`), så det kan lenkes til og
 * overlever en oppdatering. Detaljene hentes med den samme `getEventDetail`
 * som detaljsiden bruker, så innsynet er avgjort ett sted (server-side).
 */
export const Route = createFileRoute('/kalender/')({
  validateSearch: (search: Record<string, unknown>): { valgt?: string } => {
    const valgt = search.valgt
    return typeof valgt === 'string' && isOccurrenceKey(valgt) ? { valgt } : {}
  },
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getCalendar(),
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: CalendarPage,
})

/** Bredden der agendaen får et detaljpanel ved siden av seg (`.calendar-layout`). */
const TWO_PANE_QUERY = '(min-width: 768px)'

// Måned, ikke uke: med ukentlig øvelse gir uke-gruppering åtte overskrifter med
// én rad under hver, mens måned samler øvelsene og lar konsertene skille seg ut.
const monthFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

function monthLabel(event: CalendarEvent): string {
  const label = monthFmt.format(new Date(event.start))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function groupByMonth(events: CalendarEvent[]): Array<{ key: string; label: string; events: CalendarEvent[] }> {
  const groups: Array<{ key: string; label: string; events: CalendarEvent[] }> = []
  for (const event of events) {
    const key = toOsloDate(event.start).slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(event)
    else groups.push({ key, label: monthLabel(event), events: [event] })
  }
  return groups
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const sync = () => setMatches(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [query])
  return matches
}

function CalendarPage() {
  const data = Route.useLoaderData()
  const { valgt } = Route.useSearch()
  const { me } = Route.useRouteContext()
  const navigate = useNavigate({ from: '/kalender/' })
  const twoPane = useMediaQuery(TWO_PANE_QUERY)

  const canManageAttendance = !!me && (me.permissions.includes('*') || me.permissions.includes(ATTENDANCE_PERMISSION))
  const ready = data.configured && !data.error
  const events = ready ? data.events : []
  const next = data.next
  // Vinduet begynner i går: det som allerede er over, står dempet øverst.
  const nextIndex = next ? events.findIndex((e) => e.id === next.id) : events.length
  const withPlan = new Set(data.keysWithPlan)
  const absentKeys = new Set(data.myAbsentKeys)
  const selected =
    events.find((e) => e.occurrenceKey === valgt) ?? (next ? events[nextIndex] : undefined) ?? events[0] ?? null
  const upcomingCount = nextIndex === -1 ? events.length : events.length - nextIndex

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        className="rise"
        title="Kalender"
        summary={
          ready && events.length > 0
            ? `${CALENDAR_WINDOW_LABEL} · ${upcomingCount} ${upcomingCount === 1 ? 'hendelse' : 'hendelser'}`
            : undefined
        }
        action={
          canManageAttendance ? (
            <Link
              to="/fravaer"
              className="link-quiet inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[0.8rem] font-medium text-ink transition-colors pointer-coarse:min-h-11 can-hover:hover:border-brass can-hover:hover:text-brass-strong"
            >
              <Icon name="absence" size={16} className="text-brass" />
              <span>
                Fravær<span className="max-sm:hidden">soversikt</span>
              </span>
            </Link>
          ) : undefined
        }
      />

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
      ) : events.length === 0 ? (
        <EmptyState title="Ingenting på programmet ennå">
          Det står ingen øvelser eller konserter i kalenderen de neste fire månedene.
        </EmptyState>
      ) : (
        <div className="calendar-layout">
          <div className="rise space-y-5" style={{ animationDelay: '40ms' }}>
            {groupByMonth(events).map((group) => (
              <section key={group.key} aria-label={group.label}>
                <ListHeader as="h2" title={group.label} />
                <ul className="mt-1.5 space-y-0.5">
                  {group.events.map((event) => {
                    const index = events.indexOf(event)
                    return (
                      <AgendaRow
                        key={event.id}
                        event={event}
                        isNext={index === nextIndex}
                        past={nextIndex !== -1 && index < nextIndex}
                        selected={twoPane && selected?.id === event.id}
                        hasPlan={withPlan.has(event.occurrenceKey)}
                        absent={absentKeys.has(event.occurrenceKey)}
                        onSelect={
                          twoPane
                            ? () =>
                                navigate({
                                  search: { valgt: event.occurrenceKey },
                                  replace: true,
                                  resetScroll: false,
                                })
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Panelet rendres også på server og telefon (CSS skjuler det under
              768 px), men henter detaljene bare når det faktisk vises. */}
          <aside className="calendar-pane rise max-md:hidden" style={{ animationDelay: '90ms' }} aria-label="Valgt hendelse">
            {selected && (
              <EventPane
                key={selected.occurrenceKey}
                event={selected}
                isNext={selected.id === next?.id}
                enabled={twoPane}
              />
            )}
          </aside>
        </div>
      )}

      {data.embedUrl && ready && (
        <details className="rise group border-t border-line pt-4" style={{ animationDelay: '140ms' }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
            <span>
              <span className="display-title text-[1.05rem] font-semibold text-ink">Hele kalenderen fra Google</span>
              <span className="ml-2 text-xs text-ink-faint">måned- og ukevisning</span>
            </span>
            <Icon name="chevronRight" size={16} className="text-ink-faint transition-transform group-open:rotate-90" />
          </summary>
          <div className="sheet mt-3 overflow-hidden">
            <iframe
              src={data.embedUrl}
              title="Google Calendar"
              loading="lazy"
              className="block h-[70vh] max-h-[720px] min-h-[420px] w-full border-0"
            />
          </div>
        </details>
      )}
    </div>
  )
}

/**
 * Én rad i agendaen. Lenken går alltid til detaljsiden (cmd-klikk, del lenke,
 * telefon); i tospaltevisningen fanger `onSelect` trykket og velger raden i
 * stedet.
 */
function AgendaRow({
  event,
  isNext,
  past,
  selected,
  hasPlan,
  absent,
  onSelect,
}: {
  event: CalendarEvent
  isNext: boolean
  past: boolean
  selected: boolean
  hasPlan: boolean
  absent: boolean
  onSelect?: () => void
}) {
  const date = toOsloDate(event.start)
  return (
    <li>
      <Link
        to="/kalender/$eventId"
        params={{ eventId: event.occurrenceKey }}
        onClick={(e) => {
          if (!onSelect || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          onSelect()
        }}
        aria-current={selected ? 'true' : undefined}
        data-next={isNext}
        data-selected={selected}
        className="agenda-row link-quiet -mx-2 flex items-center gap-3.5 px-2 py-2.5"
      >
        {/* DateTile har med full dato for skjermlesere («onsdag 11. november, »). */}
        <DateTile iso={date} tone={isNext ? 'brass' : past ? 'muted' : 'plain'} />
        <span className={`min-w-0 flex-1 ${past ? 'opacity-60' : ''}`}>
          {/* Merkene står på tittellinja, så tid og sted får hele bredden og
              kan bryte i stedet for å kuttes. */}
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="display-title min-w-0 break-words text-[1.02rem] font-semibold leading-snug text-ink">
              {event.title}
            </span>
            {isNext && <RowMark tone="brass">Neste</RowMark>}
            {hasPlan && (
              <RowMark tone="brass" title="Øvingsplan lagt inn">
                <PlanGlyph />
                Plan
              </RowMark>
            )}
            {absent && (
              <RowMark tone="oxblood" title="Du har meldt fravær">
                Fravær
              </RowMark>
            )}
          </span>
          <span className="mt-0.5 block break-words text-[0.8rem] leading-snug text-ink-soft">
            {eventTimeLabel(event)}
            {event.location ? ` · ${event.location}` : ''}
          </span>
        </span>
        <span className="hidden shrink-0 text-xs text-ink-faint sm:inline md:hidden lg:inline">
          {relativeDays(date)}
        </span>
      </Link>
    </li>
  )
}

type Detail = Awaited<ReturnType<typeof getEventDetail>>

/** Siste svar per forekomst, så et nytt valg av en rad viser det man så sist med en gang. */
const detailCache = new Map<string, Detail>()

function useEventDetail(occurrenceKey: string, enabled: boolean) {
  const [detail, setDetail] = useState<Detail | null>(() => detailCache.get(occurrenceKey) ?? null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setFailed(false)
    getEventDetail({ data: { occurrenceKey } })
      .then((res) => {
        if (cancelled) return
        detailCache.set(occurrenceKey, res)
        setDetail(res)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [occurrenceKey, enabled, version])
  return { detail, failed, reload: () => setVersion((v) => v + 1) }
}

/**
 * Den valgte hendelsen i tospaltevisningen. Det som står i kalenderlista
 * (tittel, tid, sted, beskrivelse) vises med en gang; oppmøte, plan og tall
 * kommer fra `getEventDetail`. Redigering av planen og navnelistene bor på
 * detaljsiden — panelet er for å se og svare, ikke for å administrere.
 */
function EventPane({ event, isNext, enabled }: { event: CalendarEvent; isNext: boolean; enabled: boolean }) {
  const router = useRouter()
  const { detail, failed, reload } = useEventDetail(event.occurrenceKey, enabled)
  const date = toOsloDate(event.start)

  return (
    <article className="next-card">
      <div className="flex gap-4 px-5 pb-4 pt-6">
        <DateTile iso={date} size="lg" tone={isNext ? 'brass' : 'plain'} srLabel={false} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="kicker mb-1.5">
            {isNext ? 'Neste · ' : ''}
            {relativeDays(date)}
          </p>
          <h2 className="display-title break-words text-[clamp(1.7rem,3.2vw,2.3rem)] font-semibold italic leading-[1.04] text-ink [hyphens:auto]">
            {event.title}
          </h2>
          <p className="mt-2 text-[0.92rem] leading-snug text-ink-soft">
            <span className="text-ink">{eventDayLabel(event)}</span> · {eventTimeLabel(event)}
          </p>
          {event.location && (
            <p className="mt-1 flex items-start gap-1.5 text-[0.92rem] leading-snug text-ink-soft">
              <Icon name="pin" size={15} className="mt-[3px] shrink-0 text-brass" />
              <span className="min-w-0 break-words">{event.location}</span>
            </p>
          )}
          {detail?.linkedProject && (
            <Link
              to="/noter/prosjekter/$projectId"
              params={{ projectId: detail.linkedProject.id }}
              className="mt-2.5 inline-flex"
            >
              <Stamp wrap className="cursor-pointer">{detail.linkedProject.name}</Stamp>
            </Link>
          )}
        </div>
      </div>
      {event.description && (
        <p className="whitespace-pre-line px-5 pb-4 text-sm leading-relaxed text-ink-soft">{event.description}</p>
      )}

      <div className="next-card-row px-5 py-3.5">
        <h3 className="sr-only">Ditt oppmøte</h3>
        {detail?.found ? (
          <RsvpControl
            occurrenceKey={event.occurrenceKey}
            eventLabel={rsvpEventLabel(event)}
            current={detail.myAttendance}
            onSaved={async () => {
              reload()
              // Fraværsmerket i agendaen kommer fra kalenderens loader.
              await router.invalidate()
            }}
            compact
          />
        ) : failed ? (
          <p className="text-sm text-ink-soft">Fikk ikke hentet oppmøtet. Åpne hendelsen for å svare.</p>
        ) : (
          <div className="h-11 animate-pulse rounded-[9px] bg-paper-sunken" aria-hidden />
        )}
      </div>

      <div className="next-card-row px-5 py-4">
        <ListHeader
          as="h3"
          title="Øvingsplan"
          meta={detail && detail.setlist.length > 0 ? `${detail.setlist.length} ${detail.setlist.length === 1 ? 'punkt' : 'punkter'}` : undefined}
          className="!border-b-0 !pb-1"
        />
        {!detail ? (
          failed ? null : <div className="mt-2 h-16 animate-pulse rounded-[9px] bg-paper-sunken" aria-hidden />
        ) : detail.setlist.length === 0 ? (
          <p className="text-sm text-ink-faint">
            {detail.canManagePlan ? 'Ingen plan ennå — legg den inn på hendelsessiden.' : 'Dirigenten har ikke lagt inn hva som skal øves.'}
          </p>
        ) : (
          <ol className="mt-1">
            {detail.setlist.map((item, index) => (
              <li key={item.id} className="hairline-row flex items-baseline gap-3 py-2">
                <span className="display-title tabular w-5 shrink-0 text-right text-sm font-semibold text-ink-faint">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="display-title block break-words text-[0.98rem] font-semibold leading-snug text-ink">
                    {item.workId ? (item.workTitle ?? 'Ukjent verk') : (item.customTitle ?? 'Slettet fra arkivet')}
                  </span>
                  {(item.workComposer || item.note) && (
                    <span className="mt-0.5 block text-[0.8rem] text-ink-soft">
                      {[item.workComposer, item.note].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {detail?.found && (
        <div className="next-card-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5">
          <p className="text-sm">
            <span className="font-semibold text-ink">Oppmøte</span>
            <span className="text-ink-soft"> · {attendanceSummary(detail.counts)}</span>
          </p>
          {detail.canManageAttendance && (
            <Link to="/fravaer" className="link-brass hit text-sm">
              Fraværsoversikt
            </Link>
          )}
        </div>
      )}

      <Link
        to="/kalender/$eventId"
        params={{ eventId: event.occurrenceKey }}
        className="next-card-row link-quiet flex min-h-12 items-center gap-3 px-5 py-3 text-sm font-medium text-brass-strong transition-colors can-hover:hover:bg-paper-sunken/60"
      >
        <span className="flex-1">
          {detail?.canManagePlan || detail?.groups ? 'Åpne hendelsen — plan og navneliste' : 'Åpne hendelsen'}
        </span>
        <Icon name="chevronRight" size={18} />
      </Link>
    </article>
  )
}
