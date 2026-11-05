import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast, toastError } from '../../components/toast'
import { DateTile, ListHeader, eventDayLabel, eventTimeLabel, rsvpEventLabel } from '../../components/calendar/parts'
import { Icon } from '../../components/Icons'
import { RsvpControl } from '../../components/Rsvp'
import { BackArrow, Button, EmptyState, Kicker, Modal, Stamp } from '../../components/ui'
import { ATTENDANCE_LABELS, attendanceSummary, effectiveStatus } from '../../lib/attendance'
import { formatDate, formatDateTime, formatDuration, relativeDays, toOsloDate } from '../../lib/format'
import { SETLIST_NOTE_MAX, SETLIST_TITLE_MAX } from '../../lib/setlist'
import {
  addSetlistItem,
  getEventDetail,
  moveSetlistItem,
  removeSetlistItem,
  searchWorksForEvent,
  setLinkedProject,
  setMemberAttendance,
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
 *
 * Rekkefølgen (4. november 2026): hendelsen, så «Ditt oppmøte» — det de fleste
 * åpner siden for — så øvingsplanen og til sist navnelistene. Fra 768 px står
 * oppmøtet i en egen spalte til høyre for planen (`.event-layout`).
 *
 * Første skjerm på telefon (5. november 2026): oppmøtet er ÉN linje («Vi regner
 * med deg · Kan ikke komme»), tallene og hvem som ser navnene ligger bak en
 * sammenleggbar «Oppmøte · 3 kommer · 1 kan ikke», og første punkt i
 * øvingsplanen står innenfor første skjerm. Planen vises ren for alle;
 * vedlikeholdet (legg til, flytt, fjern, merknad, prosjektkobling) kommer først
 * etter «Rediger øvingsplan», som «Rediger programmet» på prosjektsiden.
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
      className="back-link mb-4"
    >
      <BackArrow />
      Kalender
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
    <div className="event-layout">
      <header className="event-head rise">
        <BackLink />
        <div className="flex gap-4">
          <DateTile iso={date} size="lg" tone="brass" srLabel={false} />
          <div className="min-w-0 flex-1 pt-0.5">
            <Kicker className="mb-1.5">{relativeDays(date)}</Kicker>
            <h1 className="display-title break-words text-[clamp(1.9rem,5.5vw,3rem)] font-semibold italic leading-[1.02] text-ink [hyphens:auto]">
              {event.title}
            </h1>
            <p className="mt-2 text-[0.95rem] leading-snug text-ink-soft">
              <span className="text-ink">{eventDayLabel(event)}</span> · {eventTimeLabel(event)}
            </p>
            {event.location && (
              <p className="mt-1 flex items-start gap-1.5 text-[0.95rem] leading-snug text-ink-soft">
                <Icon name="pin" size={15} className="mt-[3px] shrink-0 text-brass" />
                <span className="min-w-0 break-words">{event.location}</span>
              </p>
            )}
            {data.linkedProject && (
              <Link
                to="/noter/prosjekter/$projectId"
                params={{ projectId: data.linkedProject.id }}
                className="mt-2.5 inline-flex"
              >
                <Stamp wrap className="cursor-pointer">{data.linkedProject.name}</Stamp>
              </Link>
            )}
          </div>
        </div>
        {event.description && (
          <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink-soft md:mt-4">{event.description}</p>
        )}
      </header>

      <AttendanceCard data={data} occurrenceKey={eventId} />
      <PlanSection data={data} occurrenceKey={eventId} />
      <RosterSection data={data} occurrenceKey={eventId} />
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
  const showsLocal = data.setlist.length > 0 || data.groups !== null
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
          <PlanSection data={data} occurrenceKey={data.occurrenceKey} />
          <AttendanceCard data={data} occurrenceKey={data.occurrenceKey} />
          <RosterSection data={data} occurrenceKey={data.occurrenceKey} />
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
  // Lesemodus er standard også for dirigenten: planen er det alle åpner siden
  // for å se, og pilene/krysset skal ikke ligge i veien for den.
  const [editing, setEditing] = useState(false)
  const canEdit = data.canManagePlan
  const editMode = canEdit && editing
  const empty = data.setlist.length === 0

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
    <section className="event-plan rise" style={{ animationDelay: '80ms' }}>
      <ListHeader
        title="Øvingsplan"
        meta={empty ? undefined : `${data.setlist.length} ${data.setlist.length === 1 ? 'punkt' : 'punkter'}`}
        className="mb-1"
        action={
          canEdit && !editing ? (
            <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => setEditing(true)}>
              {empty ? 'Lag øvingsplan' : 'Rediger øvingsplan'}
            </Button>
          ) : undefined
        }
      />

      {editMode && (
        <div className="surface-group mt-3 flex flex-wrap items-center justify-between gap-2 border-brass/40 bg-[var(--brass-soft)] px-3 py-2.5">
          <p className="px-1 text-sm font-medium text-brass-strong">Redigerer øvingsplanen</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => setPickerOpen(true)}>
              + Verk
            </Button>
            <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => setCustomOpen(true)}>
              + Fritekst
            </Button>
            <Button size="sm" className="pointer-coarse:min-h-11" variant="primary" onClick={() => setEditing(false)}>
              Ferdig
            </Button>
          </div>
        </div>
      )}

      {empty ? (
        <p className="py-3 text-sm text-ink-soft">
          {editMode
            ? 'Legg inn verkene i den rekkefølgen de skal øves, så vet alle hva de skal ha framme.'
            : canEdit
              ? 'Ingen plan ennå.'
              : 'Dirigenten har ikke lagt inn hva som skal øves på denne gangen.'}
        </p>
      ) : (
        <ol>
          {data.setlist.map((item, index) => (
            <li key={item.id} className="hairline-row flex items-start gap-3 py-3">
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
                {item.workComposer && <p className="mt-0.5 text-[0.8rem] text-ink-soft">{item.workComposer}</p>}
                {item.note && <p className="mt-1 text-sm leading-snug text-ink-soft">{item.note}</p>}
                {editMode && (
                  <NoteEditor occurrenceKey={occurrenceKey} item={item} disabled={busy} onDone={() => router.invalidate()} />
                )}
              </div>
              {editMode && (
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

      {editMode && (
        <label className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[0.85rem] font-medium text-ink-soft">Hører til prosjekt</span>
          <select
            className="field-input !w-auto max-w-full !text-base sm:!text-sm pointer-coarse:min-h-11"
            value={data.linkedProject?.id ?? ''}
            disabled={busy}
            onChange={(e) => act(() => setLinkedProject({ data: { occurrenceKey, projectId: e.target.value || null } }))}
          >
            <option value="">Ingen prosjektkobling</option>
            {data.projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.eventDate ? ` · ${formatDate(p.eventDate)}` : ''}
              </option>
            ))}
          </select>
        </label>
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
        className="mt-1 inline-flex cursor-pointer items-center text-[0.8rem] font-medium text-brass-strong transition-colors hover:text-ink pointer-coarse:-mb-2 pointer-coarse:min-h-11"
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
      className={`grid h-8 w-8 cursor-pointer place-items-center rounded-[7px] text-ink-faint pointer-coarse:h-11 pointer-coarse:w-11 transition-colors hover:bg-paper-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30 ${
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

/**
 * Oppmøtet — én flate, rett under hendelsen (på iPad i høyre spalte). Ditt
 * eget svar er én linje; tallene for hele korpset og hvem som ser navnene
 * ligger bak «Oppmøte · …», så fraværsflyten ikke tar første skjerm fra
 * øvingsplanen. Navnelistene står i `RosterSection`, nederst.
 */
function AttendanceCard({ data, occurrenceKey }: { data: Detail; occurrenceKey: string }) {
  const router = useRouter()
  const event = data.event
  return (
    <section className="event-side rise" style={{ animationDelay: '40ms' }} aria-label="Oppmøte">
      <div className="next-card">
        {/* En hendelse som er borte fra kalenderen (`OrphanPage`) har ingen tid
            å svare på — da vises bare tallene. */}
        {event && (
          <div className="px-4 pb-3 pt-3.5 sm:px-5">
            <h2 className="sr-only">Ditt oppmøte</h2>
            {/* Samme kontroll som på Hjem: ett trykk på «Kan ikke komme», og et
                ark med grunn og kommentar. Har man meldt fravær, vises hele
                kontrollen (endre / jeg kommer likevel). */}
            <RsvpControl
              occurrenceKey={occurrenceKey}
              eventLabel={rsvpEventLabel(event)}
              current={data.myAttendance}
              onSaved={() => router.invalidate()}
              compact
            />
          </div>
        )}
        <details className={`group ${event ? 'next-card-row' : ''}`}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 text-sm transition-colors sm:px-5 can-hover:hover:bg-paper-sunken/60 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-ink">Oppmøte</span>
              <span className="text-ink-soft"> · {attendanceSummary(data.counts)}</span>
            </span>
            <Icon name="chevronRight" size={16} className="shrink-0 text-ink-faint transition-transform group-open:rotate-90" />
          </summary>
          <div className="space-y-2.5 px-4 pb-4 text-[0.85rem] leading-relaxed text-ink-soft sm:px-5">
            <p>Alle regnes som kommer til de selv melder fravær.</p>
            <p>
              {data.groups
                ? data.canManageAttendance
                  ? 'Navnelisten står nederst på siden. Der kan du også registrere fravær for noen som har gitt beskjed på annen måte.'
                  : 'Navnelisten for din stemmegruppe står nederst på siden. Der kan du også registrere fravær for noen som har gitt beskjed på annen måte.'
                : 'Hvem som har meldt fravær, ser bare dirigent, fraværsansvarlig og gruppelederne for sin egen stemmegruppe.'}
            </p>
            {(data.groups || data.canManageAttendance) && (
              <p className="flex flex-wrap gap-x-5 gap-y-1">
                {data.groups && (
                  <a
                    href="#hvem-kommer"
                    className="link-brass hit"
                    onClick={(e) => {
                      // Ikke la ruteren tolke ankeret; rull dit i det som faktisk
                      // ruller (vinduet, eller skallet i installert iOS-app).
                      e.preventDefault()
                      document.getElementById('hvem-kommer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    Til navnelisten
                  </a>
                )}
                {data.canManageAttendance && (
                  <Link to="/fravaer" className="link-brass hit">
                    Fraværsoversikt
                  </Link>
                )}
              </p>
            )}
          </div>
        </details>
      </div>
    </section>
  )
}

/** Navnelistene per stemmegruppe — bare for dem serveren har gitt dem til. */
function RosterSection({ data, occurrenceKey }: { data: Detail; occurrenceKey: string }) {
  if (!data.groups) return null
  return (
    <section id="hvem-kommer" className="event-people rise scroll-mt-24 space-y-6" style={{ animationDelay: '120ms' }}>
      <ListHeader title="Hvem kommer" meta={attendanceSummary(data.counts)} />
      {data.groups.map((group) => (
        <div key={group.section}>
          <h3 className="group-label !ml-0 !mb-1">{group.label}</h3>
          <ul>
            {group.members.map((member) => (
              <MemberRow key={member.userId} member={member} occurrenceKey={occurrenceKey} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
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
  const status = effectiveStatus(member.status)

  const setStatus = async (value: string) => {
    setBusy(true)
    try {
      await setMemberAttendance({
        data: {
          occurrenceKey,
          userId: member.userId,
          // «Kommer» er ingen rad: fravær er unntaket.
          status: value === 'not_attending' || value === 'unsure' ? value : null,
          comment: value === 'not_attending' && member.status === 'not_attending' ? member.comment : null,
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
    <li className="hairline-row flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${status === 'attending' ? 'text-ink' : 'text-oxblood'}`}>
          {member.name}
        </p>
        <p className="truncate text-[0.8rem] text-ink-soft">
          {member.partName ?? 'Uten stemme'}
          {status !== 'attending' && member.source === 'admin' && member.registeredByName
            ? ` · registrert av ${member.registeredByName}`
            : ''}
        </p>
        {status !== 'attending' && member.comment && (
          <p className="mt-0.5 text-xs italic text-ink-soft">«{member.comment}»</p>
        )}
      </div>
      {member.canEdit ? (
        <select
          className="field-input !w-auto shrink-0 !text-base sm:!text-sm pointer-coarse:min-h-11"
          value={status === 'attending' ? '' : status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={`Oppmøte for ${member.name}`}
        >
          <option value="">{ATTENDANCE_LABELS.attending}</option>
          <option value="not_attending">{ATTENDANCE_LABELS.not_attending}</option>
          {/* «Usikker» lages ikke lenger, men en gammel rad skal vises riktig. */}
          {status === 'unsure' && <option value="unsure">{ATTENDANCE_LABELS.unsure}</option>}
        </select>
      ) : status === 'attending' ? (
        <span className="shrink-0 text-[0.8rem] text-ink-faint">{ATTENDANCE_LABELS.attending}</span>
      ) : (
        <Stamp tone={status === 'not_attending' ? 'oxblood' : 'neutral'}>{ATTENDANCE_LABELS[status]}</Stamp>
      )}
    </li>
  )
}
