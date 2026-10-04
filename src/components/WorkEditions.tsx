import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDate, toOsloDate } from '../lib/format'
import { createWorkEdition, setCurrentWorkEdition, updateWorkEditionNotes, type getWork } from '../server/works'
import { toast, toastError } from './toast'
import { Button, Field, Kicker, Modal, Stamp } from './ui'

type WorkData = Awaited<ReturnType<typeof getWork>>

export function WorkEditions({ data, onSelect }: { data: WorkData; onSelect: (id: string | null) => void }) {
  const router = useRouter()
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesEditionId, setNotesEditionId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const edition = data.editions.find((e) => e.id === data.editionId)!
  const current = data.editionId === data.work.currentEditionId
  const usedIn = data.usedIn.filter((p) => p.editionId === data.editionId)
  return (
    <section className="sheet space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Utgave" className="min-w-0 flex-1 sm:max-w-sm">
          <select className="field-input" value={data.editionId ?? 'original'} disabled={busy} onChange={(e) => onSelect(e.target.value === 'original' ? null : e.target.value)}>
            {data.editions.map((e) => <option key={e.id ?? 'original'} value={e.id ?? 'original'}>{e.name}{e.id === data.work.currentEditionId ? ' · gjeldende' : ''}</option>)}
          </select>
        </Field>
        {data.canManage && <Button onClick={() => { setName(`Utgave ${data.editions.length + 1}`); setNotes(''); setCreating(true) }}>Ny utgave</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Kicker>{edition.name}</Kicker>
        <span className="text-xs text-ink-faint">Opprettet {formatDate(toOsloDate(edition.createdAt.getTime()))}</span>
        {current && <Stamp tone="brass">Gjeldende</Stamp>}
      </div>
      {data.canManage && edition.id !== null && <Button size="sm" disabled={busy} onClick={() => {
        setNotes(edition.notes ?? '')
        setNotesEditionId(edition.id)
        setEditingNotes(true)
      }}>Rediger kommentar</Button>}
      {edition.notes && <p className="whitespace-pre-wrap text-sm text-ink-soft">{edition.notes}</p>}
      <p className="text-sm text-ink-soft">Filene nedenfor tilhører denne utgaven. Nye opplastinger legges i denne utgaven, og tidligere utgaver beholdes.</p>
      {usedIn.length > 0 && <p className="text-sm text-ink-soft">Brukes i: {usedIn.map((p) => p.name).join(' · ')}</p>}
      {data.canManage && !current && <Button loading={busy} disabled={data.files.length === 0} onClick={async () => {
        setBusy(true)
        try {
          await setCurrentWorkEdition({ data: { workId: data.work.id, editionId: data.editionId } })
          toast('Utgaven er gjeldende for nye prosjektkoblinger. Eksisterende prosjekter beholder sin utgave.')
          await router.invalidate()
        } catch (err) { toastError(err) }
        finally { setBusy(false) }
      }}>Sett som gjeldende</Button>}
      {data.canManage && !current && data.files.length === 0 && <p className="text-xs text-ink-faint">Last opp filer før utgaven settes som gjeldende.</p>}
      <Modal open={editingNotes} onClose={() => { if (!busy) setEditingNotes(false) }} title="Rediger kommentar" kicker={edition.name}>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault()
          if (busy || notesEditionId === null) return
          setBusy(true)
          try {
            await updateWorkEditionNotes({ data: { workId: data.work.id, editionId: notesEditionId, notes } })
            setEditingNotes(false)
            toast('Kommentaren er oppdatert')
            await router.invalidate()
          } catch (err) { toastError(err) }
          finally { setBusy(false) }
        }}>
          <Field label="Hva er endret? (valgfritt)"><textarea className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} disabled={busy} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditingNotes(false)}>Avbryt</Button>
            <Button type="submit" variant="primary" loading={busy}>Lagre kommentar</Button>
          </div>
        </form>
      </Modal>
      <Modal open={creating} onClose={() => { if (!busy) setCreating(false) }} title="Ny utgave" kicker={data.work.title}>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault()
          if (busy) return
          setBusy(true)
          try {
            const result = await createWorkEdition({ data: { workId: data.work.id, name, notes } })
            setCreating(false)
            onSelect(result.id)
            toast('Utgaven er opprettet. Last opp de nye notene her.')
          } catch (err) { toastError(err) }
          finally { setBusy(false) }
        }}>
          <Field label="Navn"><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required disabled={busy} /></Field>
          <Field label="Hva er endret? (valgfritt)"><textarea className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} disabled={busy} /></Field>
          <p className="text-sm text-ink-soft">Den nye utgaven starter uten filer. Gamle noter og prosjektvalg beholdes.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>Avbryt</Button><Button type="submit" variant="primary" loading={busy}>Opprett utgave</Button></div>
        </form>
      </Modal>
    </section>
  )
}
