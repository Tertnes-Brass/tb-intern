import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BoardDocumentRow, BoardUploadButton } from '../../../components/BoardDocuments'
import { BoardTaskRowItem, QuickAddTask } from '../../../components/BoardTasks'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal } from '../../../components/ui'
import type { BoardTaskStatus } from '../../../lib/board'
import { formatDate, formatWeekday } from '../../../lib/format'
import {
  createTask,
  deleteMeeting,
  getMeeting,
  setTaskStatus,
  updateMeeting,
} from '../../../server/board'

export const Route = createFileRoute('/styre/moter/$meetingId')({
  loader: ({ params }) => getMeeting({ data: { id: params.meetingId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne møtet">{error.message}</EmptyState>,
  component: MeetingPage,
})

function MeetingPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const meeting = data.meeting

  const [agenda, setAgenda] = useState(meeting.agenda ?? '')
  const [notes, setNotes] = useState(meeting.notes ?? '')
  const [decisions, setDecisions] = useState(meeting.decisions ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const decisionsRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setAgenda(meeting.agenda ?? '')
    setNotes(meeting.notes ?? '')
    setDecisions(meeting.decisions ?? '')
  }, [meeting])

  const changed =
    agenda !== (meeting.agenda ?? '') ||
    notes !== (meeting.notes ?? '') ||
    decisions !== (meeting.decisions ?? '')

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await updateMeeting({ data: { id: meeting.id, agenda, notes, decisions } })
      toast('Møtet er lagret')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSavingNotes(false)
    }
  }

  const setStatus = async (id: string, status: BoardTaskStatus) => {
    try {
      await setTaskStatus({ data: { id, status } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <div className="space-y-9">
      <header className="rise">
        <Link
          to="/styre/moter"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Møter
        </Link>
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <Kicker>Styremøte</Kicker>
            <h1 className="display-title mt-2 break-words text-[clamp(2rem,5.5vw,3.4rem)] font-semibold italic leading-[1.05] text-ink">
              {meeting.title}
            </h1>
            <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
              {formatWeekday(meeting.date)} {formatDate(meeting.date)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Rediger</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          </div>
        </div>
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      {/* Møtets egen rekkefølge: agenda før, notater under, vedtak etter. */}
      <section className="rise space-y-5" style={{ animationDelay: '80ms' }}>
        <div>
          <h2 className="kicker mb-3">Agenda</h2>
          <div className="sheet p-4 sm:p-5">
            <textarea
              className="field-input min-h-32 leading-relaxed"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder={'1. Regnskap\n2. Uniformer\n3. Eventuelt'}
              aria-label="Agenda"
            />
          </div>
        </div>

        <div>
          <h2 className="kicker mb-3">Notater</h2>
          <div className="sheet p-4 sm:p-5">
            <textarea
              className="field-input min-h-48 leading-relaxed"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={'Hva ble sagt og drøftet.\n\nTom linje gir et nytt avsnitt.'}
              aria-label="Møtenotater"
            />
          </div>
        </div>

        <div>
          <h2 className="kicker mb-3">Vedtak og oppfølging</h2>
          <div className="sheet space-y-3 p-4 sm:p-5">
            <textarea
              ref={decisionsRef}
              className="field-input min-h-32 leading-relaxed"
              value={decisions}
              onChange={(e) => setDecisions(e.target.value)}
              placeholder={'Vedtak: vi går for tilbud B.\nHilde følger opp med leverandøren.'}
              aria-label="Vedtak og oppfølging"
            />
            <DecisionToTask
              meetingId={meeting.id}
              boardProjects={data.boardProjects}
              getSelection={() => {
                const el = decisionsRef.current
                if (!el) return ''
                const picked = el.value.slice(el.selectionStart, el.selectionEnd).trim()
                // Uten markering: ta linja markøren står på. «Lag oppgave av
                // dette» skal virke uten at man først må dra over teksten.
                if (picked) return picked.split('\n')[0]!.trim()
                const before = el.value.slice(0, el.selectionStart)
                const start = before.lastIndexOf('\n') + 1
                const end = el.value.indexOf('\n', el.selectionStart)
                return el.value.slice(start, end === -1 ? undefined : end).trim()
              }}
              onCreated={() => router.invalidate()}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">Avsnitt og linjeskift bevares slik du skriver dem.</p>
          <Button variant="primary" size="sm" onClick={saveNotes} loading={savingNotes} disabled={!changed}>
            Lagre møtet
          </Button>
        </div>
      </section>

      <section className="rise" style={{ animationDelay: '140ms' }}>
        <h2 className="kicker mb-3">Oppgaver fra møtet</h2>
        <div className="mb-3">
          <QuickAddTask
            placeholder="Ny oppgave fra dette møtet"
            onCreate={async (title) => {
              try {
                await createTask({ data: { title, meetingId: meeting.id } })
                toast('Oppgaven er lagt til')
                await router.invalidate()
              } catch (err) {
                toastError(err)
              }
            }}
          />
        </div>
        {data.tasks.length === 0 ? (
          <div className="sheet">
            <EmptyState title="Ingen oppgaver fra dette møtet">
              Skriv inn det som ble fordelt — oppgavene dukker opp både her og på oversikten.
            </EmptyState>
          </div>
        ) : (
          <ul className="sheet overflow-hidden">
            {data.tasks.map((task) => (
              <BoardTaskRowItem
                key={task.id}
                task={task}
                today={data.today}
                hideMeeting
                onToggle={(status) => setStatus(task.id, status)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rise" style={{ animationDelay: '200ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="kicker">Dokumenter</h2>
          <BoardUploadButton
            meetingId={meeting.id}
            label="Last opp til møtet"
            onUploaded={() => router.invalidate()}
          />
        </div>
        {data.documents.length === 0 ? (
          <div className="sheet">
            <EmptyState title="Ingen dokumenter på møtet">
              Innkalling, referat og vedlegg hører hjemme her.
            </EmptyState>
          </div>
        ) : (
          <ul className="sheet overflow-hidden">
            {data.documents.map((doc) => (
              <BoardDocumentRow key={doc.id} doc={doc} />
            ))}
          </ul>
        )}
      </section>

      <EditMeetingModal
        open={editing}
        onClose={() => setEditing(false)}
        meeting={meeting}
        onSaved={() => router.invalidate()}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette møtet?">
        <p className="text-sm text-ink-soft">
          «{meeting.title}» og notatene forsvinner. Oppgavene og dokumentene blir liggende, men mister
          koblingen til møtet.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await deleteMeeting({ data: { id: meeting.id } })
                toast('Møtet er slettet')
                await router.invalidate()
                router.navigate({ to: '/styre/moter' })
              } catch (err) {
                toastError(err)
              }
            }}
          >
            Slett
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function EditMeetingModal({
  open,
  onClose,
  meeting,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  meeting: { id: string; title: string; date: string }
  onSaved: () => Promise<void> | void
}) {
  const [title, setTitle] = useState(meeting.title)
  const [date, setDate] = useState(meeting.date)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(meeting.title)
    setDate(meeting.date)
  }, [meeting])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateMeeting({ data: { id: meeting.id, title, date } })
      toast('Møtet er lagret')
      onClose()
      await onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rediger møtet">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tittel">
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </Field>
        <Field label="Dato">
          <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
            Lagre
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * «Lag oppgave av dette»: henter en linje fra vedtaksfeltet, og lager en
 * oppgave knyttet til møtet (og eventuelt et styreprosjekt). Poenget er at et
 * vedtak ikke skal bli liggende som en setning ingen eier.
 */
function DecisionToTask({
  meetingId,
  boardProjects,
  getSelection,
  onCreated,
}: {
  meetingId: string
  boardProjects: Array<{ id: string; title: string }>
  getSelection: () => string
  onCreated: () => Promise<void> | void
}) {
  const [title, setTitle] = useState('')
  const [boardProjectId, setBoardProjectId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = title.trim()
    if (!value || saving) return
    setSaving(true)
    try {
      await createTask({ data: { title: value, meetingId, boardProjectId: boardProjectId || null } })
      toast('Oppgaven er lagt til')
      setTitle('')
      await onCreated()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line pt-3">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">Lag oppgave av dette</p>
      <div className="flex flex-wrap gap-2">
        <input
          className="field-input min-w-0 flex-1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Hva skal gjøres?"
          aria-label="Oppgave fra vedtak"
          maxLength={200}
        />
        <Button type="button" size="sm" onClick={() => setTitle(getSelection())}>
          Hent fra vedtak
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {boardProjects.length > 0 && (
          <select
            className="field-input min-w-0 flex-1"
            value={boardProjectId}
            onChange={(e) => setBoardProjectId(e.target.value)}
            aria-label="Styreprosjekt for oppgaven"
          >
            <option value="">Uten prosjekt</option>
            {boardProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!title.trim()}>
          Lag oppgave
        </Button>
      </div>
    </form>
  )
}
