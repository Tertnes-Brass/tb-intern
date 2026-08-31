import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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

  const [notes, setNotes] = useState(meeting.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => setNotes(meeting.notes ?? ''), [meeting])

  const notesChanged = notes !== (meeting.notes ?? '')

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await updateMeeting({ data: { id: meeting.id, notes } })
      toast('Notatene er lagret')
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

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <h2 className="kicker mb-3">Notater</h2>
        <div className="sheet space-y-3 p-4 sm:p-5">
          <textarea
            className="field-input min-h-56 leading-relaxed"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={'Saksliste, vedtak og hva som ble avtalt.\n\nTom linje gir et nytt avsnitt.'}
            aria-label="Møtenotater"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">Avsnitt og linjeskift bevares slik du skriver dem.</p>
            <Button variant="primary" size="sm" onClick={saveNotes} loading={savingNotes} disabled={!notesChanged}>
              Lagre notater
            </Button>
          </div>
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
