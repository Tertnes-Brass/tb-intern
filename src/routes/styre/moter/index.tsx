import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../../components/ui'
import { formatDate, formatWeekday } from '../../../lib/format'
import { createMeeting, listMeetings } from '../../../server/board'

export const Route = createFileRoute('/styre/moter/')({
  loader: () => listMeetings(),
  component: MeetingsPage,
})

function MeetingsPage() {
  const data = Route.useLoaderData()
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Styrearbeidet</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Møter</h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nytt møte
        </Button>
      </header>

      {data.meetings.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '80ms' }}>
          <EmptyState
            title="Ingen møter ennå"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Opprett det første
              </Button>
            }
          >
            Et møte samler saksliste, notater, oppgavene som ble fordelt og papirene som hører til.
          </EmptyState>
        </div>
      ) : (
        <ul className="rise grid gap-3 sm:grid-cols-2" style={{ animationDelay: '80ms' }}>
          {data.meetings.map((m) => (
            <li key={m.id}>
              <Link
                to="/styre/moter/$meetingId"
                params={{ meetingId: m.id }}
                className={`sheet sheet-hover link-quiet flex h-full items-center gap-5 px-5 py-4 ${
                  m.date < data.today ? 'opacity-80' : ''
                }`}
              >
                <span className="flex w-12 shrink-0 flex-col items-center" aria-hidden>
                  <span className="display-title tabular text-[1.7rem] font-semibold leading-none text-ink">
                    {Number(m.date.slice(8, 10))}
                  </span>
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-brass">
                    {formatDate(m.date).split(' ')[1]?.slice(0, 3)}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="display-title block truncate text-[1.15rem] font-semibold">{m.title}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {formatWeekday(m.date)} {formatDate(m.date)}
                    {m.taskCount > 0 ? ` · ${m.taskCount} oppgaver` : ''}
                    {m.documentCount > 0 ? ` · ${m.documentCount} dokumenter` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {!m.hasNotes && <Stamp tone="oxblood">Uten notater</Stamp>}
                  {m.openTaskCount > 0 && (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-brass">
                      {m.openTaskCount} åpne
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewMeetingModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewMeetingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { id } = await createMeeting({ data: { title, date } })
      toast('Møtet er opprettet')
      onClose()
      setTitle('')
      await router.invalidate()
      router.navigate({ to: '/styre/moter/$meetingId', params: { meetingId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nytt styremøte">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tittel">
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Styremøte oktober"
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
            Opprett
          </Button>
        </div>
      </form>
    </Modal>
  )
}
