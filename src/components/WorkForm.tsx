import { useEffect, useState } from 'react'
import type { works } from '../db/schema'
import { formatDuration, parseDurationToSec } from '../lib/format'
import { createWork, updateWork } from '../server/works'
import { toast, toastError } from './toast'
import { Button, Field, Modal } from './ui'

type Work = typeof works.$inferSelect

type FormState = {
  title: string
  subtitle: string
  archiveNumber: string
  composer: string
  arranger: string
  publisher: string
  genre: string
  grade: string
  duration: string
  physicalLocation: string
  acquiredYear: string
  notes: string
}

const empty: FormState = {
  title: '',
  subtitle: '',
  archiveNumber: '',
  composer: '',
  arranger: '',
  publisher: '',
  genre: '',
  grade: '',
  duration: '',
  physicalLocation: '',
  acquiredYear: '',
  notes: '',
}

export function WorkFormModal({
  open,
  onClose,
  onSaved,
  work,
}: {
  open: boolean
  onClose: () => void
  onSaved: (id: string) => void | Promise<void>
  work?: Work
}) {
  const [form, setForm] = useState<FormState>(empty)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(
      work
        ? {
            title: work.title,
            subtitle: work.subtitle ?? '',
            archiveNumber: work.archiveNumber ?? '',
            composer: work.composer ?? '',
            arranger: work.arranger ?? '',
            publisher: work.publisher ?? '',
            genre: work.genre ?? '',
            grade: work.grade ? String(work.grade) : '',
            duration: formatDuration(work.durationSec),
            physicalLocation: work.physicalLocation ?? '',
            acquiredYear: work.acquiredYear ? String(work.acquiredYear) : '',
            notes: work.notes ?? '',
          }
        : empty,
    )
  }, [open, work])

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast('Verket må ha en tittel', 'error')
      return
    }
    const durationSec = parseDurationToSec(form.duration)
    if (form.duration.trim() && durationSec == null) {
      toast('Varighet skrives som «4:30»', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        subtitle: form.subtitle || undefined,
        archiveNumber: form.archiveNumber || undefined,
        composer: form.composer || undefined,
        arranger: form.arranger || undefined,
        publisher: form.publisher || undefined,
        genre: form.genre || undefined,
        grade: form.grade ? Number(form.grade) : null,
        durationSec,
        physicalLocation: form.physicalLocation || undefined,
        acquiredYear: form.acquiredYear ? Number(form.acquiredYear) : null,
        notes: form.notes || undefined,
      }
      if (work) {
        await updateWork({ data: { id: work.id, ...payload } })
        toast('Verket er oppdatert')
        await onSaved(work.id)
      } else {
        const res = await createWork({ data: payload })
        toast('Verket er lagt i arkivet')
        await onSaved(res.id)
      }
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
      title={work ? 'Rediger verk' : 'Nytt verk'}
      kicker={work ? work.title : 'Arkivet'}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tittel *">
          <input className="field-input" value={form.title} onChange={set('title')} placeholder="F.eks. «Where Eagles Sing»" autoFocus />
        </Field>
        <Field label="Undertittel">
          <input className="field-input" value={form.subtitle} onChange={set('subtitle')} placeholder="Valgfri undertittel" />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="Komponist" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.composer} onChange={set('composer')} placeholder="Paul Lovatt-Cooper" />
          </Field>
          <Field label="Arrangør" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.arranger} onChange={set('arranger')} placeholder="" />
          </Field>
          <Field label="Forlag" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.publisher} onChange={set('publisher')} />
          </Field>
          <Field label="Sjanger" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.genre} onChange={set('genre')} placeholder="Konsertåpner, hymne, marsj …" />
          </Field>
          <Field label="Vanskelighetsgrad">
            <select className="field-input" value={form.grade} onChange={set('grade')}>
              <option value="">Ikke satt</option>
              {[1, 2, 3, 4, 5].map((g) => (
                <option key={g} value={g}>
                  Grad {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Varighet" hint="minutter:sekunder">
            <input className="field-input" value={form.duration} onChange={set('duration')} placeholder="4:30" />
          </Field>
          <Field label="Fysisk plassering" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.physicalLocation} onChange={set('physicalLocation')} placeholder="Skap 2 · Mappe 014" />
          </Field>
          <Field label="Arkivnummer" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.archiveNumber} onChange={set('archiveNumber')} placeholder="F.eks. 014" autoComplete="off" />
          </Field>
          <Field label="Anskaffet år" className="col-span-2 sm:col-span-1">
            <input className="field-input" value={form.acquiredYear} onChange={set('acquiredYear')} placeholder="2024" inputMode="numeric" enterKeyHint="done" autoComplete="off" />
          </Field>
        </div>
        <Field label="Notater">
          <textarea className="field-input min-h-20 resize-y" value={form.notes} onChange={set('notes')} placeholder="Interne merknader — mangler, kopier, solister …" />
        </Field>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto">
            {work ? 'Lagre endringer' : 'Opprett verk'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
