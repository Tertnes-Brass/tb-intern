import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { EventPracticalSection } from '../../components/EventPractical'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Kicker, Modal, SectionHeading, Stamp } from '../../components/ui'
import {
  ATTENDANCE_COMMENT_MAX,
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  attendanceSummary,
} from '../../lib/attendance'
import { formatDate, formatDateTime, formatDuration, formatTimeRange, formatWeekday, relativeDays, toOsloDate } from '../../lib/format'
import { hasEventPractical } from '../../lib/practical'
import { SETLIST_NOTE_MAX, SETLIST_TITLE_MAX } from '../../lib/setlist'
import {
  addSetlistItem,
  getEventDetail,
  moveSetlistItem,
  removeSetlistItem,
  searchWorksForEvent,
  setMemberAttendance,
  setMyAttendance,
  updateSetlistItem,
} from '../../server/event-meta'

/**
 * Detaljsiden for ÉN kalenderforekomst (#82 + #24): øvingsplanen og oppmøtet.
 *
 * Ruta hører til Kalender-området — ikke et nytt navnerom (docs/designprinsipper.md
 * §2). `$eventId` er `occurrenceKey` fra `src/lib/occurrence.ts`, som er stabil
 * også når Google flytter tidspunktet på en forekomst.
 *
 * Alt innsyn er avgjort SERVER-side i `getEventDetail`: `groups` er `null` for
 * den som bare skal se tall, og inneholder kun egne seksjoner for en
 * gruppeleder. Denne filen viser det den får — den filtrerer ikke selv.
 */

export const Route = createFileRoute('/kalender/$eventId')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getEventDetail({ data: { occurrenceKey: params.eventId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne hendelsen">{error.message}</EmptyState>,
  component: EventDetailPage,
})

type Detail = Awaited<ReturnType<typeof getEventDetail>>

function BackLink() {
  return (
    <Link
      to="/kalender"
      className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
    >
      ← Kalender
    </Link>
  )
}

function EventDetailPage() {
  const data = Route.useLoaderData()
  const { eventId } = Route.useParams()

  if (!data.found) return <OrphanPage data={data} />

  const event = data.event!
  const date = toOsloDate(event.start)

  return (
    <div className="space-y-12">
      <header className="rise">
        <BackLink />
        <Kicker className="mb-3">{relativeDays(date)}</Kicker>
        <h1 className="display-title break-words text-[clamp(2rem,5.5vw,3.4rem)] font-semibold italic leading-[1.02] text-ink [hyphens:auto]">
          {event.title}
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
          {formatWeekday(date)} {formatDate(date)}
          {event.allDay ? '' : ` · ${formatTimeRange(event.start, event.end)}`}
        </p>
        {event.description && (
          <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink-soft">{event.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(data.practical.locationName || event.location) && (
            <Stamp tone="brass">{data.practical.locationName ?? event.location}</Stamp>
          )}
          {event.allDay && <Stamp>Hele dagen</Stamp>}
          {data.practical.meetupMusicians && <Stamp>Oppmøte {data.practical.meetupMusicians}</Stamp>}
        </div>
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <EventPracticalSection
        occurrenceKey={eventId}
        practical={data.practical}
        linkedProjects={data.linkedProjects}
        projectOptions={data.projectOptions}
        canManage={data.canManagePlan}
        eventLocation={event.location}
      />
      <PlanSection data={data} occurrenceKey={eventId} />
      <AttendanceSection data={data} occurrenceKey={eventId} />
    </div>
  )
}

/**
 * Hendelsen finnes ikke i feeden. Den kan være slettet i Google, eller bare
 * falt ut av firemånedersvinduet — de to er ikke til å skille fra utsiden, og
 * lokale data slettes derfor aldri automatisk.
 */
function OrphanPage({ data }: { data: Detail }) {
  const hasSnapshot = data.snapshot !== null
  // Serveren har allerede avgjort om DENNE leseren får se de lokale dataene
  // (skriverett eller gruppelederbinding). Teksten skal ikke røpe at det finnes
  // en øvingsplan for en som ikke får se den.
  // `hasEventPractical` er med: en hendelse kan ha KUN praktisk info (uten
  // øvingsplan eller prosjektkobling), og da skal den fortsatt vises — og kunne
  // redigeres — for den som har innsyn. Serveren har allerede nullet feltene
  // for lesere uten innsyn.
  const showsLocal =
    data.setlist.length > 0 ||
    data.groups !== null ||
    data.linkedProjects.length > 0 ||
    hasEventPractical(data.practical)
  return (
    <div className="space-y-10">
      <header className="rise">
        <BackLink />
        <Kicker className="mb-3">Ikke i kalenderen</Kicker>
        <h1 className="display-title break-words text-[clamp(1.8rem,5vw,2.8rem)] font-semibold italic leading-[1.05] text-ink">
          {data.snapshot?.summary ?? 'Hendelsen finnes ikke lenger i kalenderen'}
        </h1>
        {data.snapshot && (
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
            Sto i kalenderen {formatDateTime(data.snapshot.start)}.
          </p>
        )}
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <EmptyState title={hasSnapshot ? 'Ikke i kalenderen lenger' : 'Fant ingen hendelse'}>
        {!hasSnapshot
          ? 'Vi finner ingen hendelse med denne adressen, og det er ikke registrert noe lokalt på den heller. Sjekk lenken, eller gå tilbake til kalenderen.'
          : showsLocal
            ? 'Den er enten slettet i Google Calendar, eller så ligger den utenfor de fire månedene vi viser. Det som ble registrert her, er tatt vare på — ingenting slettes automatisk.'
            : 'Den er enten slettet i Google Calendar, eller så ligger den utenfor de fire månedene vi viser.'}
      </EmptyState>

      {showsLocal && (
        <>
          <EventPracticalSection
            occurrenceKey={data.occurrenceKey}
            practical={data.practical}
            linkedProjects={data.linkedProjects}
            projectOptions={data.projectOptions}
            canManage={data.canManagePlan}
            eventLocation={null}
          />
          <PlanSection data={data} occurrenceKey={data.occurrenceKey} />
          <AttendanceSection data={data} occurrenceKey={data.occurrenceKey} />
        </>
      )}
    </div>
  )
}

// ---------- Øvingsplan ----------

function PlanSection({ data, occurrenceKey }: { data: Detail; occurrenceKey: string }) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rise" style={{ animationDelay: '80ms' }}>
      <SectionHeading
        kicker={
          data.setlist.length > 0
            ? `${data.setlist.length} ${data.setlist.length === 1 ? 'punkt' : 'punkter'}`
            : undefined
        }
        title="Øvingsplan"
        className="mb-4"
        action={
          data.canManagePlan ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => setPickerOpen(true)}>
                Legg til verk
              </Button>
              <Button size="sm" onClick={() => setCustomOpen(true)}>
                Fritekst
              </Button>
            </div>
          ) : undefined
        }
      />

      {data.setlist.length === 0 ? (
        <EmptyState title="Ingen øvingsplan ennå">
          {data.canManagePlan
            ? 'Legg inn verkene i den rekkefølgen de skal øves, så vet alle hva de skal ha framme.'
            : 'Dirigenten har ikke lagt inn hva som skal øves på denne gangen.'}
        </EmptyState>
      ) : (
        <ol className="sheet overflow-hidden">
          {data.setlist.map((item, index) => (
            <li key={item.id} className="hairline-row flex items-start gap-3 px-4 py-3 sm:px-5">
              <span className="display-title tabular mt-0.5 w-6 shrink-0 text-right text-sm font-semibold text-ink-faint">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="display-title text-[1.02rem] font-semibold leading-snug text-ink">
                  {item.workId && item.workLink && item.workTitle ? (
                    <Link
                      to="/noter/arkiv/$workId"
                      params={{ workId: item.workId }}
                      className="link-brass break-words"
                    >
                      {item.workTitle}
                    </Link>
                  ) : (
                    <span className="break-words">
                      {item.workId
                        ? (item.workTitle ?? 'Ukjent verk')
                        : (item.customTitle ?? 'Slettet fra arkivet')}
                    </span>
                  )}
                </p>
                {item.workComposer && <p className="mt-0.5 text-xs text-ink-soft">{item.workComposer}</p>}
                {item.note && <p className="mt-1 text-sm leading-snug text-ink-soft">{item.note}</p>}
                {data.canManagePlan && (
                  <NoteEditor occurrenceKey={occurrenceKey} item={item} disabled={busy} onDone={() => router.invalidate()} />
                )}
              </div>
              {data.canManagePlan && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label="Flytt opp"
                    disabled={busy || index === 0}
                    onClick={() => act(() => moveSetlistItem({ data: { occurrenceKey, id: item.id, direction: 'up' } }))}
                  >
                    <Arrow dir="up" />
                  </IconButton>
                  <IconButton
                    label="Flytt ned"
                    disabled={busy || index === data.setlist.length - 1}
                    onClick={() => act(() => moveSetlistItem({ data: { occurrenceKey, id: item.id, direction: 'down' } }))}
                  >
                    <Arrow dir="down" />
                  </IconButton>
                  <IconButton
                    label="Fjern punktet"
                    danger
                    disabled={busy}
                    onClick={() => act(() => removeSetlistItem({ data: { occurrenceKey, id: item.id } }))}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <WorkPicker occurrenceKey={occurrenceKey} open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <CustomItemDialog occurrenceKey={occurrenceKey} open={customOpen} onClose={() => setCustomOpen(false)} />
    </section>
  )
}

function NoteEditor({
  occurrenceKey,
  item,
  disabled,
  onDone,
}: {
  occurrenceKey: string
  item: Detail['setlist'][number]
  disabled: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(item.note ?? '')
  const [saving, setSaving] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setValue(item.note ?? '')
          setOpen(true)
        }}
        className="mt-1 cursor-pointer font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-brass-strong"
      >
        {item.note ? 'Endre merknad' : 'Legg til merknad'}
      </button>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateSetlistItem({ data: { occurrenceKey, id: item.id, note: value } })
      setOpen(false)
      onDone()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        className="field-input max-w-xs !text-base sm:!text-sm"
        value={value}
        maxLength={SETLIST_NOTE_MAX}
        placeholder="Sats 2, takt 40 — ca. 15 min"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setOpen(false)
        }}
        autoFocus
      />
      <Button size="sm" variant="primary" loading={saving} onClick={save}>
        Lagre
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Avbryt
      </Button>
    </div>
  )
}

function IconButton({
  label,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 cursor-pointer place-items-center rounded-[7px] text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30 ${
        danger ? 'hover:!bg-danger/10 hover:!text-danger' : ''
      }`}
    >
      {children}
    </button>
  )
}

function Arrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      aria-hidden
      style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}
    >
      <path d="M5.5 9.5v-8M2 5l3.5-3.5L9 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WorkPicker({ occurrenceKey, open, onClose }: { occurrenceKey: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<
    Array<{ id: string; title: string; composer: string | null; durationSec: number | null }>
  >([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchWorksForEvent({ data: { q: q || undefined } })
        if (!cancelled) setResults(res.works)
      } catch (err) {
        if (!cancelled) toastError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, open])

  return (
    <Modal open={open} onClose={onClose} title="Legg til verk" kicker="Fra arkivet">
      <input
        type="search"
        className="field-input mb-3"
        placeholder="Søk i arkivet …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
      />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {loading && results.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">Søker …</p>
        ) : results.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">
            {q ? `Ingen treff på «${q}»` : 'Arkivet er tomt'}
          </p>
        ) : (
          results.map((w) => (
            <button
              key={w.id}
              disabled={addingId !== null}
              onClick={async () => {
                setAddingId(w.id)
                try {
                  await addSetlistItem({ data: { occurrenceKey, workId: w.id } })
                  toast(`«${w.title}» lagt til i øvingsplanen`)
                  await router.invalidate()
                } catch (err) {
                  toastError(err)
                } finally {
                  setAddingId(null)
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-paper-sunken disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="display-title block truncate text-[1rem] font-semibold">{w.title}</span>
                <span className="block text-xs text-ink-soft">{w.composer ?? '—'}</span>
              </span>
              {addingId === w.id ? (
                <span className="spinner text-brass" />
              ) : (
                <span className="font-mono text-[0.64rem] text-ink-faint">{formatDuration(w.durationSec)}</span>
              )}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

function CustomItemDialog({
  occurrenceKey,
  open,
  onClose,
}: {
  occurrenceKey: string
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await addSetlistItem({ data: { occurrenceKey, customTitle: title, note } })
      setTitle('')
      setNote('')
      onClose()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Eget punkt" kicker="Utenfor arkivet">
      <div className="space-y-3">
        <input
          className="field-input"
          placeholder="Oppvarming"
          value={title}
          maxLength={SETLIST_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <input
          className="field-input"
          placeholder="Merknad (valgfri) — f.eks. «15 min, skalaer»"
          value={note}
          maxLength={SETLIST_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) submit()
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={submit}>
            Legg til
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- Oppmøte ----------

function AttendanceSection({ data, occurrenceKey }: { data: Detail; occurrenceKey: string }) {
  return (
    <section className="rise space-y-6" style={{ animationDelay: '160ms' }}>
      <SectionHeading kicker={attendanceSummary(data.counts)} title="Oppmøte" />
      <MyRsvp data={data} occurrenceKey={occurrenceKey} />
      {data.groups ? (
        <div className="space-y-6">
          {data.groups.map((group) => (
            <div key={group.section}>
              <h3 className="kicker mb-1">{group.label}</h3>
              <ul className="sheet overflow-hidden">
                {group.members.map((member) => (
                  <MemberRow key={member.userId} member={member} occurrenceKey={occurrenceKey} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">
          Hvem som har svart hva, er bare synlig for dirigent, fraværsansvarlig og gruppelederne for sin egen
          stemmegruppe. Tallene over gjelder hele korpset.
        </p>
      )}
    </section>
  )
}

function MyRsvp({ data, occurrenceKey }: { data: Detail; occurrenceKey: string }) {
  const router = useRouter()
  const current = data.myAttendance
  const [comment, setComment] = useState(current?.comment ?? '')
  const [busy, setBusy] = useState<AttendanceStatus | 'clear' | null>(null)

  useEffect(() => {
    setComment(current?.comment ?? '')
  }, [current?.comment])

  const write = async (status: AttendanceStatus | null, nextComment: string) => {
    setBusy(status ?? 'clear')
    try {
      await setMyAttendance({ data: { occurrenceKey, status, comment: status ? nextComment : null } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sheet px-4 py-4 sm:px-5">
      <p className="kicker mb-3">Mitt svar</p>
      <div className="flex flex-wrap gap-2">
        {ATTENDANCE_STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={current?.status === status ? 'primary' : 'secondary'}
            loading={busy === status}
            onClick={() => write(status, comment)}
          >
            {ATTENDANCE_LABELS[status]}
          </Button>
        ))}
        {current && (
          <Button size="sm" variant="ghost" loading={busy === 'clear'} onClick={() => write(null, '')}>
            Nullstill
          </Button>
        )}
      </div>
      {current && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="field-input max-w-sm !text-base sm:!text-sm"
            placeholder="Kort kommentar (valgfri) — «kommer 19:30»"
            value={comment}
            maxLength={ATTENDANCE_COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') write(current.status, comment)
            }}
          />
          {comment !== (current.comment ?? '') && (
            <Button size="sm" onClick={() => write(current.status, comment)}>
              Lagre
            </Button>
          )}
        </div>
      )}
      {!current && (
        <p className="mt-3 text-xs text-ink-faint">Du har ikke svart ennå. Svaret kan endres når som helst.</p>
      )}
    </div>
  )
}

const STATUS_TONE: Record<AttendanceStatus, 'brass' | 'oxblood' | 'neutral'> = {
  attending: 'brass',
  not_attending: 'oxblood',
  unsure: 'neutral',
}

function MemberRow({
  member,
  occurrenceKey,
}: {
  member: NonNullable<Detail['groups']>[number]['members'][number]
  occurrenceKey: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const setStatus = async (value: string) => {
    setBusy(true)
    try {
      await setMemberAttendance({
        data: {
          occurrenceKey,
          userId: member.userId,
          status: value === '' ? null : (value as AttendanceStatus),
        },
      })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="hairline-row flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{member.name}</p>
        <p className="truncate text-xs text-ink-faint">
          {member.partName ?? 'Uten stemme'}
          {member.source === 'admin' && member.registeredByName ? ` · registrert av ${member.registeredByName}` : ''}
        </p>
        {member.comment && <p className="mt-0.5 text-xs italic text-ink-soft">«{member.comment}»</p>}
      </div>
      {member.canEdit ? (
        <select
          className="field-input !w-auto shrink-0 !text-base sm:!text-xs"
          value={member.status ?? ''}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={`Oppmøte for ${member.name}`}
        >
          <option value="">Ikke svart</option>
          {ATTENDANCE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ATTENDANCE_LABELS[status]}
            </option>
          ))}
        </select>
      ) : member.status ? (
        <Stamp tone={STATUS_TONE[member.status]}>{ATTENDANCE_LABELS[member.status]}</Stamp>
      ) : (
        <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">Ikke svart</span>
      )}
    </li>
  )
}
