import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { DateTile, dayLabel } from '../../components/calendar/parts'
import { Icon } from '../../components/Icons'
import { AbsenceReasonPicker } from '../../components/Rsvp'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Field, Modal, PageHeader, Stamp } from '../../components/ui'
import {
  ATTENDANCE_COMMENT_MAX,
  ATTENDANCE_LABELS,
  ATTENDANCE_PERMISSION,
  type AbsenceReason,
  composeAbsenceComment,
} from '../../lib/attendance'
import { CALENDAR_WINDOW_LABEL } from '../../lib/calendar-window'
import { formatDate, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../../lib/format'
import { type AbsenceOverviewEvent, getAbsenceOverview, setMemberAttendance } from '../../server/event-meta'

/**
 * Fravær — fraværsansvarligs område (docs/designprinsipper.md §3):
 *
 * 1. **Navn:** Fravær (`/fravaer`).
 * 2. **Formål:** ett sted å se hvem som ikke kommer på øvelser og konserter
 *    fremover, uten å åpne hver hendelse.
 * 3. **Primærbruker:** fraværsansvarlig (rollen `attendance`).
 * 4. **Primærhandling:** registrere fravær for et medlem som har gitt beskjed
 *    på annen måte — knappen øverst, eller «+» på hendelsen.
 * 5. **Navigasjon:** ingen toppmeny-oppføring (taket i §6). Flis i «Meg og mer»
 *    og kort på hub-en via `areasFor`, pluss lenker fra Kalender.
 * 6. **Rettighet:** `attendance.manage`, håndhevet i `getAbsenceOverview` og
 *    `setMemberAttendance`. Sjekken i `beforeLoad` er kosmetikk.
 * 7. **Navnerom:** `src/routes/fravaer/`.
 *
 * Alle regnes som kommer til de selv melder fravær, så lista er unntakene —
 * ikke svarene. Detaljene og hele navnelista per hendelse står fortsatt på
 * `/kalender/$eventId`.
 */
export const Route = createFileRoute('/fravaer/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const { permissions } = context.me
    if (!permissions.includes('*') && !permissions.includes(ATTENDANCE_PERMISSION)) {
      throw redirect({ to: '/' })
    }
  },
  loader: () => getAbsenceOverview(),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne fraværsoversikten">{error.message}</EmptyState>,
  component: AbsencePage,
})

type Overview = Awaited<ReturnType<typeof getAbsenceOverview>>

const monthFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

function monthLabel(event: AbsenceOverviewEvent): string {
  const label = monthFmt.format(new Date(event.start))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function groupByMonth(events: AbsenceOverviewEvent[]) {
  const groups: Array<{ key: string; label: string; events: AbsenceOverviewEvent[] }> = []
  for (const event of events) {
    const key = toOsloDate(event.start).slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(event)
    else groups.push({ key, label: monthLabel(event), events: [event] })
  }
  return groups
}

/** «tor. 5. november · 19:00 · Øvelse» — i velgeren i registreringsdialogen. */
function eventOptionLabel(event: AbsenceOverviewEvent): string {
  const date = toOsloDate(event.start)
  const time = event.allDay ? '' : ` · ${formatTimeRange(event.start, null)}`
  return `${formatWeekday(date).slice(0, 3)}. ${formatDate(date)}${time} · ${event.title}`
}

function AbsencePage() {
  const data = Route.useLoaderData()
  const [dialog, setDialog] = useState<{ open: boolean; occurrenceKey: string | null }>({
    open: false,
    occurrenceKey: null,
  })
  const ready = data.configured && !data.error
  const withAbsence = data.events.filter((e) => e.absences.length > 0).length

  return (
    <div className="space-y-8">
      <PageHeader
        className="rise"
        kicker="Oppmøte"
        title="Fravær"
        summary="Alle regnes som kommer til de selv melder fravær — her er unntakene fremover."
        action={
          ready && data.events.length > 0 ? (
            <Button variant="primary" onClick={() => setDialog({ open: true, occurrenceKey: null })}>
              Registrer fravær
            </Button>
          ) : undefined
        }
      />

      {!data.configured ? (
        <EmptyState title="Kalenderen er ikke koblet til ennå">
          Fraværet føres på hendelsene i korpsets Google-kalender. Når kalenderen er koblet til, dukker øvelsene og
          konsertene opp her.
        </EmptyState>
      ) : data.error ? (
        <EmptyState title="Fikk ikke tak i kalenderen">
          Vi nådde ikke Google Calendar akkurat nå. Prøv igjen om litt.
        </EmptyState>
      ) : data.events.length === 0 ? (
        <EmptyState title="Ingenting på programmet">
          Det står ingen øvelser eller konserter i kalenderen de neste fire månedene.
        </EmptyState>
      ) : (
        <section className="rise space-y-8" style={{ animationDelay: '80ms' }}>
          <p className="text-sm text-ink-soft">
            {CALENDAR_WINDOW_LABEL} ·{' '}
            {withAbsence === 0
              ? 'ingen har meldt fravær'
              : `fravær på ${withAbsence} av ${data.events.length} ${data.events.length === 1 ? 'hendelse' : 'hendelser'}`}
          </p>
          {groupByMonth(data.events).map((group) => (
            <div key={group.key}>
              <h2 className="group-label">{group.label}</h2>
              <ul className="list-group">
                {group.events.map((event) => (
                  <EventItem
                    key={event.occurrenceKey}
                    event={event}
                    onRegister={() => setDialog({ open: true, occurrenceKey: event.occurrenceKey })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <RegisterDialog
        open={dialog.open}
        initialKey={dialog.occurrenceKey}
        data={data}
        onClose={() => setDialog({ open: false, occurrenceKey: null })}
      />
    </div>
  )
}

/**
 * Én hendelse: tittel og tid/sted på hver sin linje (de skal kunne leses, ikke
 * kuttes), tallene på en tredje linje bare når noen faktisk har meldt fravær —
 * «Alle kommer» trenger ikke sies 18 ganger — og «+» for å registrere, 44 pt.
 */
function EventItem({ event, onRegister }: { event: AbsenceOverviewEvent; onRegister: () => void }) {
  const { counts } = event
  const date = toOsloDate(event.start)
  const time = event.allDay ? 'Hele dagen' : formatTimeRange(event.start, event.end)
  const hasExceptions = counts.notAttending > 0 || counts.unsure > 0
  return (
    <li>
      <div className="flex items-start gap-3 py-3 pl-3 pr-1.5 sm:gap-4 sm:pl-5 sm:pr-3">
        <DateTile iso={date} srLabel={false} />
        <div className="min-w-0 flex-1 pt-0.5">
          <Link
            to="/kalender/$eventId"
            params={{ eventId: event.occurrenceKey }}
            className="display-title link-quiet block break-words text-base font-semibold leading-snug text-ink transition-colors hover:text-brass-strong"
          >
            <span className="sr-only">{dayLabel(date)}, </span>
            {event.title}
          </Link>
          <p className="mt-0.5 break-words text-[0.82rem] leading-snug text-ink-soft">
            {time}
            {event.location ? ` · ${event.location}` : ''}
            <span className="max-sm:hidden"> · {relativeDays(date)}</span>
          </p>
          {hasExceptions && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-ink-soft">
              {counts.notAttending > 0 && <Stamp tone="oxblood">{counts.notAttending} kan ikke</Stamp>}
              {counts.unsure > 0 && (
                <Stamp>
                  {counts.unsure} usikker{counts.unsure === 1 ? '' : 'e'}
                </Stamp>
              )}
              <span className="tabular">
                {counts.attending} av {counts.total} kommer
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRegister}
          aria-label={`Registrer fravær på ${event.title}, ${dayLabel(date)}`}
          title="Registrer fravær"
          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-[10px] text-ink-faint transition-colors hover:bg-paper-sunken hover:text-brass-strong active:bg-paper-sunken"
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {event.absences.length > 0 && (
        <ul className="border-t border-line bg-paper-sunken/40">
          {event.absences.map((absence) => (
            <AbsenceItem key={absence.userId} occurrenceKey={event.occurrenceKey} absence={absence} />
          ))}
        </ul>
      )}
    </li>
  )
}

function AbsenceItem({
  occurrenceKey,
  absence,
}: {
  occurrenceKey: string
  absence: AbsenceOverviewEvent['absences'][number]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await setMemberAttendance({ data: { occurrenceKey, userId: absence.userId, status: null } })
      toast(`${absence.name} er ført opp som kommer igjen`)
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-start gap-3 py-2 pr-1.5 pl-[4.5rem] sm:pr-3 sm:pl-[5.25rem]">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className={`font-medium ${absence.status === 'not_attending' ? 'text-oxblood' : ''}`}>
            {absence.name}
          </span>
          <span className="text-ink-faint"> · {absence.partName ?? 'Uten stemme'}</span>
          {absence.status === 'unsure' && <span className="text-ink-faint"> · {ATTENDANCE_LABELS.unsure}</span>}
        </p>
        {(absence.comment || absence.registeredByName) && (
          <p className="mt-0.5 break-words text-xs text-ink-soft">
            {absence.comment && <span className="italic">«{absence.comment}»</span>}
            {absence.comment && absence.registeredByName ? ' · ' : ''}
            {absence.registeredByName && (
              <span className="text-ink-faint">registrert av {absence.registeredByName}</span>
            )}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={remove}
        aria-label={`Fjern fraværet til ${absence.name}`}
        className="shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <Icon name="close" size={14} />
        <span className="hidden sm:inline">Fjern</span>
      </Button>
    </li>
  )
}

function RegisterDialog({
  open,
  initialKey,
  data,
  onClose,
}: {
  open: boolean
  initialKey: string | null
  data: Overview
  onClose: () => void
}) {
  const router = useRouter()
  const [occurrenceKey, setOccurrenceKey] = useState('')
  const [userId, setUserId] = useState('')
  const [reason, setReason] = useState<AbsenceReason | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setOccurrenceKey(initialKey ?? data.events[0]?.occurrenceKey ?? '')
    setUserId('')
    setReason(null)
    setText('')
  }, [open, initialKey])

  const event = data.events.find((e) => e.occurrenceKey === occurrenceKey) ?? null
  const alreadyAbsent = new Set(
    (event?.absences ?? []).filter((a) => a.status === 'not_attending').map((a) => a.userId),
  )
  const comment = composeAbsenceComment(reason, text)
  const tooLong = (comment?.length ?? 0) > ATTENDANCE_COMMENT_MAX

  const submit = async () => {
    const member = data.members.find((m) => m.id === userId)
    if (!event || !member) return
    setSaving(true)
    try {
      await setMemberAttendance({ data: { occurrenceKey: event.occurrenceKey, userId, status: 'not_attending', comment } })
      toast(`Fravær registrert for ${member.name}`)
      onClose()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrer fravær" kicker="For et medlem">
      <div className="space-y-4">
        <Field label="Hendelse">
          <select
            className="field-input !text-base sm:!text-sm pointer-coarse:min-h-11"
            value={occurrenceKey}
            onChange={(e) => setOccurrenceKey(e.target.value)}
          >
            {data.events.map((e) => (
              <option key={e.occurrenceKey} value={e.occurrenceKey}>
                {eventOptionLabel(e)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Medlem">
          <select
            className="field-input !text-base sm:!text-sm pointer-coarse:min-h-11"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="" disabled>
              Velg medlem …
            </option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.partName ? ` (${m.partName})` : ''}
                {alreadyAbsent.has(m.id) ? ' — har meldt fravær' : ''}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <AbsenceReasonPicker value={reason} onChange={setReason} />
        </div>
        <Field label="Kommentar (valgfri)" hint="Dirigenten og gruppelederen ser kommentaren, og at du registrerte fraværet.">
          <textarea
            className="field-input min-h-[72px] resize-none"
            placeholder="F.eks. «ringte i dag, syk»"
            value={text}
            maxLength={ATTENDANCE_COMMENT_MAX}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        {tooLong && <p className="text-xs text-danger">Kommentaren er for lang.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" loading={saving} disabled={!event || !userId || tooLong} onClick={submit}>
            Registrer fravær
          </Button>
        </div>
      </div>
    </Modal>
  )
}
