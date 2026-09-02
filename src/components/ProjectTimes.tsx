import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { formatDate, formatWeekday, toOsloDate } from '../lib/format'
import {
  PRACTICAL_LABEL_MAX,
  PRACTICAL_LOCATION_MAX,
  PRACTICAL_NAME_MAX,
  PRACTICAL_NOTE_MAX,
  PRACTICAL_PHONE_MAX,
  PROJECT_TIME_AUDIENCES,
  PROJECT_TIME_AUDIENCE_LABELS,
  PROJECT_TIME_KINDS,
  PROJECT_TIME_KIND_LABELS,
  type ProjectTimeAudience,
  type ProjectTimeKind,
  nextProjectTime,
  projectTimeTitle,
} from '../lib/practical'
import { addProjectTime, listProjectMembers, removeProjectTime, updateProjectTime } from '../server/projects'
import { toast, toastError } from './toast'
import { Button, EmptyState, Field, Modal, SectionHeading, Stamp } from './ui'

/**
 * Tidsplanen for et prosjekt (#9): oppmøte for lasting, avreise, rigg,
 * lydprøve, konsertstart, nedrigg — med ansvarlig og kontaktinfo der det
 * trengs.
 *
 * Lista er gruppert på dag og sortert kronologisk i `sortProjectTimes`
 * (server-side, enhetstestet). Det NESTE punktet som ikke er passert løftes
 * fram — det er «det viktigste først» på mobil, og den ene tingen et medlem
 * som står på bussen faktisk lurer på.
 */

export type ProjectTimeItem = {
  id: string
  kind: string
  label: string | null
  date: string
  time: string | null
  location: string | null
  audience: string
  note: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  contactPhone: string | null
  createdAt: number
}

type MemberOption = { id: string; name: string; phone: string | null; partName: string | null }

export function ProjectTimesSection({
  projectId,
  times,
  canManage,
  animationDelay,
}: {
  projectId: string
  times: ProjectTimeItem[]
  canManage: boolean
  animationDelay?: string
}) {
  const [editing, setEditing] = useState<ProjectTimeItem | 'new' | null>(null)

  // «Neste» beregnes FØRST etter hydrering: serveren og nettleseren står ikke
  // nødvendigvis på samme minutt, og en markering som spriker mellom
  // server-HTML og klient ville gitt en hydreringsfeil for en ren detalj.
  const [now, setNow] = useState<{ date: string; time: string } | null>(null)
  useEffect(() => {
    const stamp = new Date()
    setNow({
      date: toOsloDate(stamp.getTime()),
      time: new Intl.DateTimeFormat('nb-NO', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Oslo',
      }).format(stamp),
    })
  }, [])

  const nextId = now ? (nextProjectTime(times, now.date, now.time)?.id ?? null) : null

  if (times.length === 0 && !canManage) return null

  const days = groupByDate(times)

  return (
    <section className="rise" style={animationDelay ? { animationDelay } : undefined}>
      <SectionHeading
        kicker={times.length > 0 ? `${times.length} ${times.length === 1 ? 'tidspunkt' : 'tidspunkter'}` : undefined}
        title="Tidsplan"
        className="mb-4"
        action={
          canManage ? (
            <Button size="sm" variant={times.length === 0 ? 'primary' : 'secondary'} onClick={() => setEditing('new')}>
              + Nytt tidspunkt
            </Button>
          ) : undefined
        }
      />

      {times.length === 0 ? (
        <EmptyState title="Ingen tidspunkter ennå">
          Oppmøte for lasting, avreise, rigg i lokalet, lydprøve og konsertstart — det som ellers blir spurt om i
          chatten kvelden før.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day.date}>
              <h3 className="kicker mb-1.5">
                {formatWeekday(day.date)} {formatDate(day.date)}
              </h3>
              <ul className="sheet overflow-hidden">
                {day.items.map((item) => (
                  <TimeRow
                    key={item.id}
                    projectId={projectId}
                    item={item}
                    isNext={item.id === nextId}
                    canManage={canManage}
                    onEdit={() => setEditing(item)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <TimeDialog
          projectId={projectId}
          item={editing === 'new' ? null : editing}
          open={editing !== null}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function groupByDate(times: ProjectTimeItem[]): Array<{ date: string; items: ProjectTimeItem[] }> {
  const days: Array<{ date: string; items: ProjectTimeItem[] }> = []
  for (const item of times) {
    const last = days[days.length - 1]
    if (last && last.date === item.date) last.items.push(item)
    else days.push({ date: item.date, items: [item] })
  }
  return days
}

function TimeRow({
  projectId,
  item,
  isNext,
  canManage,
  onEdit,
}: {
  projectId: string
  item: ProjectTimeItem
  isNext: boolean
  canManage: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await removeProjectTime({ data: { id: item.id, projectId } })
      toast('Tidspunktet er fjernet')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="hairline-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span
        className={`display-title tabular mt-0.5 w-14 shrink-0 text-[0.95rem] font-semibold ${
          isNext ? 'text-brass-strong' : 'text-ink'
        }`}
      >
        {item.time ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[0.98rem] font-semibold leading-snug text-ink">{projectTimeTitle(item)}</span>
          {isNext && <Stamp tone="brass">Neste</Stamp>}
          {item.audience !== 'alle' && <Stamp>{audienceLabel(item.audience)}</Stamp>}
        </p>
        {item.location && <p className="mt-0.5 text-sm text-ink-soft">{item.location}</p>}
        {item.note && <p className="mt-0.5 text-sm leading-snug text-ink-soft">{item.note}</p>}
        {(item.responsibleName || item.contactPhone) && (
          <p className="mt-1 text-[0.8rem] text-ink-faint">
            {item.responsibleName ? `Ansvarlig: ${item.responsibleName}` : 'Kontakt'}
            {item.contactPhone && (
              <>
                {' · '}
                <a href={`tel:${item.contactPhone.replace(/\s/g, '')}`} className="link-brass">
                  {item.contactPhone}
                </a>
              </>
            )}
          </p>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label={`Rediger ${projectTimeTitle(item)}`}
            className="cursor-pointer rounded-md px-2 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-30"
          >
            Endre
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={`Fjern ${projectTimeTitle(item)}`}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[7px] text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
              <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </li>
  )
}

function audienceLabel(audience: string): string {
  return (PROJECT_TIME_AUDIENCE_LABELS as Record<string, string>)[audience] ?? audience
}

const OTHER = '__annen__'

function TimeDialog({
  projectId,
  item,
  open,
  onClose,
}: {
  projectId: string
  /** `null` = nytt tidspunkt. */
  item: ProjectTimeItem | null
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [kind, setKind] = useState<ProjectTimeKind>('konsertstart')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [location, setLocation] = useState('')
  const [audience, setAudience] = useState<ProjectTimeAudience>('alle')
  const [note, setNote] = useState('')
  const [responsible, setResponsible] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [canSeePhone, setCanSeePhone] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind((item?.kind as ProjectTimeKind) ?? 'konsertstart')
    setLabel(item?.label ?? '')
    setDate(item?.date ?? '')
    setTime(item?.time ?? '')
    setLocation(item?.location ?? '')
    setAudience((item?.audience as ProjectTimeAudience) ?? 'alle')
    setNote(item?.note ?? '')
    setResponsible(item?.responsibleUserId ?? (item?.responsibleName ? OTHER : ''))
    setResponsibleName(item?.responsibleUserId ? '' : (item?.responsibleName ?? ''))
    setContactPhone(item?.contactPhone ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  useEffect(() => {
    if (!open || members.length > 0) return
    listProjectMembers()
      .then((res) => {
        setMembers(res.members)
        setCanSeePhone(res.canSeePhone)
      })
      .catch(toastError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * «Kontaktinfo kan hentes fra person i medlemslista» (#9). Nummeret fylles
   * inn ÉN gang, når man velger et medlem og feltet er tomt — det er et
   * forslag, ikke en kobling. Den som lagrer ser og godkjenner nummeret som
   * blir stående, og et medlem som senere endrer profilen sin får ikke det nye
   * nummeret publisert på en gammel konsert uten at noen har bestemt det.
   */
  const pickResponsible = (value: string) => {
    setResponsible(value)
    if (value === OTHER || value === '') return
    const member = members.find((m) => m.id === value)
    if (member?.phone && !contactPhone.trim()) setContactPhone(member.phone)
  }

  const submit = async () => {
    setSaving(true)
    const payload = {
      projectId,
      kind,
      label,
      date,
      time,
      location,
      audience,
      note,
      responsibleUserId: responsible === OTHER || responsible === '' ? null : responsible,
      responsibleName: responsible === OTHER ? responsibleName : null,
      contactPhone,
    }
    try {
      if (item) await updateProjectTime({ data: { id: item.id, ...payload } })
      else await addProjectTime({ data: payload })
      toast(item ? 'Tidspunktet er lagret' : 'Tidspunktet er lagt til')
      onClose()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Endre tidspunkt' : 'Nytt tidspunkt'}
      kicker="Tidsplan"
      mobileFull
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select
              className="field-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as ProjectTimeKind)}
            >
              {PROJECT_TIME_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PROJECT_TIME_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Gjelder">
            <select
              className="field-input"
              value={audience}
              onChange={(e) => setAudience(e.target.value as ProjectTimeAudience)}
            >
              {PROJECT_TIME_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {PROJECT_TIME_AUDIENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dato *">
            <input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Klokkeslett" hint="Kan stå tomt — «lasting på lørdag» er også en avtale">
            <input
              className="field-input"
              value={time}
              maxLength={8}
              inputMode="numeric"
              placeholder="17:00"
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label={kind === 'annet' ? 'Navn *' : 'Egen overskrift'}
          hint={kind === 'annet' ? 'Påkrevd når typen er «Annet»' : 'Valgfri — erstatter typenavnet i lista'}
        >
          <input
            className="field-input"
            value={label}
            maxLength={PRACTICAL_LABEL_MAX}
            placeholder={PROJECT_TIME_KIND_LABELS[kind]}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        <Field label="Sted" hint="Lastingen skjer sjelden der konserten er">
          <input
            className="field-input"
            value={location}
            maxLength={PRACTICAL_LOCATION_MAX}
            placeholder="Tertnes skole, lageret"
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>

        <Field label="Ansvarlig" hint="Den som kjører lastebilen, låser opp eller tar imot">
          <select className="field-input" value={responsible} onChange={(e) => pickResponsible(e.target.value)}>
            <option value="">Ingen</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.partName ? ` · ${member.partName}` : ''}
              </option>
            ))}
            <option value={OTHER}>Annen (skriv navn) …</option>
          </select>
        </Field>

        {responsible === OTHER && (
          <Field label="Navn" hint="For noen utenfra — sjåfør, vaktmester, arrangør">
            <input
              className="field-input"
              value={responsibleName}
              maxLength={PRACTICAL_NAME_MAX}
              onChange={(e) => setResponsibleName(e.target.value)}
            />
          </Field>
        )}

        <Field
          label="Kontaktnummer"
          hint={
            canSeePhone
              ? 'Hentes fra medlemslista når du velger et medlem — og kan overstyres. Vises for alle som ser prosjektet.'
              : 'Vises for alle som ser prosjektet. Skriv bare inn nummer det er avtalt at kan deles.'
          }
        >
          <input
            className="field-input"
            value={contactPhone}
            maxLength={PRACTICAL_PHONE_MAX}
            inputMode="tel"
            placeholder="+47 900 12 345"
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </Field>

        <Field label="Merknad">
          <textarea
            className="field-input min-h-20"
            value={note}
            maxLength={PRACTICAL_NOTE_MAX}
            placeholder="Full uniform. Slagverk lastes først."
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button variant="primary" loading={saving} disabled={!date} onClick={submit} className="w-full sm:w-auto">
            {item ? 'Lagre' : 'Legg til'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
