import { useEffect, useState } from 'react'
import { ATTENDANCE_COMMENT_MAX, type AttendanceStatus } from '../lib/attendance'
import { setMyAttendance } from '../server/event-meta'
import { Icon } from './Icons'
import { toastError } from './toast'
import { BottomSheet, Button } from './ui'

/** Kortere enn `ATTENDANCE_LABELS` — tre knapper skal få plass på én linje. */
const SEGMENTS: Array<{ status: AttendanceStatus; label: string }> = [
  { status: 'attending', label: 'Kommer' },
  { status: 'unsure', label: 'Usikker' },
  { status: 'not_attending', label: 'Kan ikke' },
]

/** Hurtigvalg som fyller ut kommentaren. Ikke et felt i databasen — bare tekst. */
const REASONS = ['Jobb', 'Syk', 'Reise', 'Annet'] as const

export type MyAttendance = { status: AttendanceStatus; comment: string | null } | null

/**
 * «Kommer du?» — tre knapper i ett trykk, og et ark for «Kan ikke» der man kan
 * legge til hvorfor. Skriver til samme rad som detaljsiden og fraværsoversikten
 * (`setMyAttendance`, én status per medlem per forekomst).
 *
 * Svaret vises med en gang (optimistisk); `onSaved` lar kalleren laste data på
 * nytt i bakgrunnen.
 */
export function RsvpControl({
  occurrenceKey,
  eventLabel,
  current,
  onSaved,
  showComment = true,
}: {
  occurrenceKey: string
  /** «Øvelse · onsdag 28. oktober, 19:00» — vises i arket. */
  eventLabel: string
  current: MyAttendance
  onSaved?: () => void | Promise<void>
  /** Detaljsiden har sitt eget kommentarfelt og skjuler linjen her. */
  showComment?: boolean
}) {
  const [mine, setMine] = useState<MyAttendance>(current)
  const [busy, setBusy] = useState<AttendanceStatus | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => setMine(current), [current?.status, current?.comment])

  const write = async (status: AttendanceStatus | null, comment: string | null) => {
    const before = mine
    setMine(status ? { status, comment } : null)
    setBusy(status)
    try {
      await setMyAttendance({ data: { occurrenceKey, status, comment } })
      await onSaved?.()
    } catch (err) {
      setMine(before)
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 rounded-[11px] bg-paper-sunken p-1" role="radiogroup" aria-label="Kommer du?">
        {SEGMENTS.map((seg) => {
          const active = mine?.status === seg.status
          return (
            <button
              key={seg.status}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy !== null}
              onClick={() => {
                if (seg.status === 'not_attending') setSheetOpen(true)
                // Mellom «Kommer» og «Usikker» følger kommentaren med («kommer
                // 19:30»); en fraværsgrunn gjør det ikke.
                else if (!active) void write(seg.status, mine?.status === 'not_attending' ? null : (mine?.comment ?? null))
              }}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-2 text-[0.88rem] font-medium transition-colors disabled:cursor-wait ${
                active
                  ? seg.status === 'not_attending'
                    ? 'bg-paper-raised text-oxblood shadow-[var(--shadow-soft)]'
                    : 'bg-brass text-paper-raised shadow-[var(--shadow-soft)] dark:text-paper'
                  : 'text-ink-soft'
              }`}
            >
              {busy === seg.status ? (
                <span className="spinner" aria-hidden />
              ) : (
                active && seg.status === 'attending' && <Icon name="check" size={16} strokeWidth={2.2} />
              )}
              {seg.label}
            </button>
          )
        })}
      </div>
      {showComment && mine?.comment && (
        <p className="mt-2 text-xs text-ink-soft">
          <span className="text-ink-faint">Kommentar:</span> {mine.comment}
        </p>
      )}
      <AbsenceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eventLabel={eventLabel}
        initialComment={mine?.status === 'not_attending' ? (mine.comment ?? '') : ''}
        onSubmit={async (comment) => {
          setSheetOpen(false)
          await write('not_attending', comment)
        }}
      />
    </>
  )
}

/** Arket bak «Kan ikke»: valgfri grunn og kommentar, så «Registrer fravær». */
function AbsenceSheet({
  open,
  onClose,
  eventLabel,
  initialComment,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  eventLabel: string
  initialComment: string
  onSubmit: (comment: string | null) => Promise<void>
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason(null)
    setText(initialComment)
  }, [open, initialComment])

  const comment = [reason, text.trim()].filter(Boolean).join(' – ') || null
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
      <p className="mb-2 text-[0.8rem] font-medium text-ink-soft">Hvorfor? (valgfritt)</p>
      <div className="flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reason === r}
            onClick={() => setReason(reason === r ? null : r)}
            className={`min-h-10 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors ${
              reason === r ? 'border-brass bg-[var(--brass-soft)] text-brass-strong' : 'border-line-strong text-ink-soft'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
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
        Registrer fravær
      </Button>
    </BottomSheet>
  )
}
