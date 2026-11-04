import type { ReactNode } from 'react'
import { formatDate, formatTimeRange, formatWeekday, toOsloDate } from '../../lib/format'

/**
 * Små byggeklosser som Hjem, Kalender og hendelsessiden deler, så en hendelse
 * ser lik ut overalt: datoflisen, tidslinjen og listeoverskriften. Bare
 * presentasjon — dataene og tilgangen kommer fra serverfunksjonene.
 */

/** Feltene en hendelse trenger for å vises (`CalendarEvent` og `HubEvent` har dem). */
export type EventLike = {
  start: string
  end: string | null
  allDay: boolean
}

/** «19:00–21:30», «Hele dagen» eller «Til og med 24. desember 2026» for flerdagers. */
export function eventTimeLabel(event: EventLike): string {
  if (!event.allDay) return formatTimeRange(event.start, event.end)
  const lastDay = event.end ? toOsloDate(Date.parse(event.end) - 1) : toOsloDate(event.start)
  if (lastDay === toOsloDate(event.start)) return 'Hele dagen'
  return `Til og med ${formatDate(lastDay)}`
}

/** «onsdag 11. november» — uten år, som i en agenda. */
export function eventDayLabel(event: EventLike): string {
  const date = toOsloDate(event.start)
  return `${formatWeekday(date)} ${formatDate(date).replace(/\s\d{4}$/, '')}`
}

/** «Øvelse · onsdag 11. november 2026, 19:00» — teksten i fraværsarket. */
export function rsvpEventLabel(event: EventLike & { title: string }): string {
  const date = toOsloDate(event.start)
  return `${event.title} · ${formatWeekday(date)} ${formatDate(date)}${event.allDay ? '' : `, ${formatTimeRange(event.start, null)}`}`
}

const monthShort = (iso: string) => formatDate(iso).split(' ')[1]?.slice(0, 3) ?? ''

/**
 * Datoflisen: ukedag, dagtall og (i stor variant) måned. `tone="brass"` markerer
 * den neste hendelsen; `muted` en som allerede er over.
 */
export function DateTile({
  iso,
  size = 'sm',
  tone = 'plain',
}: {
  /** ISO-dato (YYYY-MM-DD) i norsk tid. */
  iso: string
  size?: 'sm' | 'lg'
  tone?: 'plain' | 'brass' | 'muted'
}) {
  return (
    <span className={`date-tile date-tile-${size} date-tile-${tone}`} aria-hidden>
      <span className="date-tile-weekday">{formatWeekday(iso).slice(0, 3)}</span>
      <span className="date-tile-day display-title tabular">{Number(iso.slice(8, 10))}</span>
      {size === 'lg' && <span className="date-tile-month">{monthShort(iso)}</span>}
    </span>
  )
}

/**
 * Overskriften over en liste (Siste beskjeder, Kommende, Øvingsplan …): én
 * linje, liten Fraunces-tittel, valgfri telling og lenke til høyre, og en strek
 * under. Erstatter den store kicker + tittel-kombinasjonen der lista selv er
 * innholdet.
 */
export function ListHeader({
  title,
  meta,
  action,
  as: Tag = 'h2',
  className = '',
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={`list-header ${className}`}>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <Tag className="display-title truncate text-[1.18rem] font-semibold text-ink">{title}</Tag>
        {meta && <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{meta}</span>}
      </div>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  )
}

/** Liten merknad på en agenda-rad: «Plan», «Fravær», «Neste». */
export function RowMark({ tone, title, children }: { tone: 'brass' | 'oxblood' | 'faint'; title?: string; children: ReactNode }) {
  const color = tone === 'brass' ? 'text-brass' : tone === 'oxblood' ? 'text-oxblood' : 'text-ink-faint'
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] ${color}`}>
      {children}
    </span>
  )
}

/** Tre streker — markøren for «øvingsplan lagt inn». */
export function PlanGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
      <path d="M1 2h7M1 4.5h7M1 7h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
