import { useEffect, useState } from 'react'
import {
  ABSENCE_REASONS,
  ATTENDANCE_COMMENT_MAX,
  type AbsenceReason,
  type AttendanceStatus,
  composeAbsenceComment,
  effectiveStatus,
  splitAbsenceComment,
} from '../lib/attendance'
import { setMyAttendance } from '../server/event-meta'
import { Icon } from './Icons'
import { toastError } from './toast'
import { BottomSheet, Button } from './ui'

export type MyAttendance = { status: AttendanceStatus; comment: string | null } | null

const HEADLINE: Record<AttendanceStatus, string> = {
  attending: 'Vi regner med deg',
  not_attending: 'Du har meldt fravær',
  unsure: 'Du har svart «usikker»',
}

/**
 * Oppmøte der fravær er unntaket: alle regnes som kommer, og det eneste man
 * trenger å trykke er «Kan ikke komme». Det åpner et ark med valgfri grunn og
 * kommentar. Etterpå kan fraværet endres, eller angres med «Jeg kommer likevel»
 * (som fjerner raden — ingen rad betyr kommer).
 *
 * Skriver til samme rad som detaljsiden og fraværsoversikten
 * (`setMyAttendance`, én status per medlem per forekomst). Svaret vises med en
 * gang (optimistisk); `onSaved` lar kalleren laste data på nytt i bakgrunnen.
 */
export function RsvpControl({
  occurrenceKey,
  eventLabel,
  current,
  onSaved,
  compact = false,
}: {
  occurrenceKey: string
  /** «Øvelse · onsdag 28. oktober, 19:00» — vises i arket. */
  eventLabel: string
  current: MyAttendance
  onSaved?: () => void | Promise<void>
  /**
   * Tett variant for «Neste»-modulen på Hjem: når man regnes som kommer, er
   * det én linje — status til venstre, «Kan ikke komme» til høyre — uten
   * forklaringen under (knappen sier det selv). Andre statuser vises som før.
   */
  compact?: boolean
}) {
  const [mine, setMine] = useState<MyAttendance>(current)
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => setMine(current), [current?.status, current?.comment])

  const status = effectiveStatus(mine?.status)

  const write = async (next: AttendanceStatus | null, comment: string | null) => {
    const before = mine
    setMine(next ? { status: next, comment } : null)
    setBusy(true)
    try {
      await setMyAttendance({ data: { occurrenceKey, status: next, comment } })
      await onSaved?.()
    } catch (err) {
      setMine(before)
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const detail =
    status === 'attending'
      ? 'Trykk bare hvis du ikke kan komme.'
      : (mine?.comment ?? (status === 'unsure' ? 'Gi beskjed når du vet om du kan komme.' : 'Ingen kommentar.'))

  const sheet = (
    <AbsenceSheet
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      eventLabel={eventLabel}
      editing={status === 'not_attending'}
      initialComment={status === 'not_attending' ? (mine?.comment ?? '') : ''}
      onSubmit={async (comment) => {
        setSheetOpen(false)
        await write('not_attending', comment)
      }}
    />
  )

  if (compact && status === 'attending') {
    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5" aria-live="polite">
            <StatusMark status={status} small />
            <p className="min-w-0 text-[0.9rem] font-semibold leading-snug text-ink">{HEADLINE[status]}</p>
          </div>
          <Button className="shrink-0" disabled={busy} onClick={() => setSheetOpen(true)}>
            Kan ikke komme
          </Button>
        </div>
        {sheet}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3" aria-live="polite">
          <StatusMark status={status} />
          <div className="min-w-0">
            <p className={`text-[0.95rem] font-semibold leading-snug ${status === 'not_attending' ? 'text-oxblood' : 'text-ink'}`}>
              {HEADLINE[status]}
            </p>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-ink-soft">{detail}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {status === 'attending' ? (
            <Button disabled={busy} onClick={() => setSheetOpen(true)}>
              Kan ikke komme
            </Button>
          ) : (
            <>
              <Button
                variant={status === 'not_attending' ? 'ghost' : 'secondary'}
                disabled={busy}
                onClick={() => setSheetOpen(true)}
              >
                {status === 'not_attending' ? 'Endre' : 'Kan ikke komme'}
              </Button>
              <Button loading={busy} onClick={() => void write(null, null)}>
                {status === 'not_attending' ? 'Jeg kommer likevel' : 'Jeg kommer'}
              </Button>
            </>
          )}
        </div>
      </div>
      {sheet}
    </>
  )
}

function StatusMark({ status, small = false }: { status: AttendanceStatus; small?: boolean }) {
  const tone =
    status === 'not_attending'
      ? 'bg-oxblood/10 text-oxblood'
      : status === 'unsure'
        ? 'bg-paper-sunken text-ink-soft'
        : 'bg-[var(--brass-soft)] text-brass-strong'
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${small ? 'h-7 w-7' : 'h-9 w-9'} ${tone}`} aria-hidden>
      {status === 'unsure' ? (
        <span className="display-title text-base font-semibold leading-none">?</span>
      ) : (
        <Icon name={status === 'not_attending' ? 'close' : 'check'} size={small ? 14 : 16} strokeWidth={2.2} />
      )}
    </span>
  )
}

/** Arket bak «Kan ikke komme»: valgfri grunn og kommentar, så «Meld fravær». */
function AbsenceSheet({
  open,
  onClose,
  eventLabel,
  editing,
  initialComment,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  eventLabel: string
  /** Fraværet finnes allerede — knappen sier «Lagre», ikke «Meld fravær». */
  editing: boolean
  initialComment: string
  onSubmit: (comment: string | null) => Promise<void>
}) {
  const [reason, setReason] = useState<AbsenceReason | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const initial = splitAbsenceComment(initialComment)
    setReason(initial.reason)
    setText(initial.text)
  }, [open, initialComment])

  const comment = composeAbsenceComment(reason, text)
  const tooLong = (comment?.length ?? 0) > ATTENDANCE_COMMENT_MAX

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Kan ikke komme"
      header={
        <div className="flex items-start justify-between gap-4 pb-1">
          <div>
            <h2 className="display-title text-[1.6rem] font-semibold leading-tight text-ink">Kan ikke komme</h2>
            <p className="mt-0.5 text-sm text-ink-soft">{eventLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="-mr-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-faint active:bg-paper-sunken"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      }
    >
      <AbsenceReasonPicker value={reason} onChange={setReason} />
      <label className="mt-5 block">
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">Kommentar</span>
        <textarea
          className="field-input min-h-[84px] resize-none"
          placeholder="F.eks. «rekker kanskje siste halvtime»"
          value={text}
          maxLength={ATTENDANCE_COMMENT_MAX}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="mt-1.5 text-xs text-ink-faint">Dirigenten, fraværsansvarlig og gruppelederen din ser kommentaren.</p>
      {tooLong && <p className="mt-1 text-xs text-danger">Kommentaren er for lang.</p>}
      <Button
        variant="primary"
        className="mt-5 min-h-12 w-full text-[0.95rem]"
        loading={saving}
        disabled={tooLong}
        onClick={async () => {
          setSaving(true)
          try {
            await onSubmit(comment)
          } finally {
            setSaving(false)
          }
        }}
      >
        {editing ? 'Lagre' : 'Meld fravær'}
      </Button>
    </BottomSheet>
  )
}

/** Hurtigvalgene for grunn. Deles med registreringen på /fravaer. */
export function AbsenceReasonPicker({
  value,
  onChange,
}: {
  value: AbsenceReason | null
  onChange: (next: AbsenceReason | null) => void
}) {
  return (
    <>
      <p className="mb-2 text-[0.8rem] font-medium text-ink-soft">Hvorfor? (valgfritt)</p>
      <div className="flex flex-wrap gap-2">
        {ABSENCE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={value === r}
            onClick={() => onChange(value === r ? null : r)}
            className={`min-h-10 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors ${
              value === r ? 'border-brass bg-[var(--brass-soft)] text-brass-strong' : 'border-line-strong text-ink-soft'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </>
  )
}
