import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { setProjectWorkEdition, type ProjectWorkDetail } from '../server/projects'
import { toast, toastError } from './toast'
import { Button, Field, Modal } from './ui'

export function ProjectWorkEdition({ projectId, item }: { projectId: string; item: ProjectWorkDetail }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const name = item.editions?.find((e) => e.id === pending)?.name
  return (
    <div className="mt-2 max-w-xs">
      <Field label="Utgave i dette prosjektet">
        <select className="field-input !py-1.5 !text-sm" aria-label={`Utgave for ${item.title}`} value={item.editionId ?? 'original'} disabled={busy} onChange={(e) => setPending(e.target.value === 'original' ? null : e.target.value)}>
          {item.editions?.map((e) => <option key={e.id ?? 'original'} value={e.id ?? 'original'}>{e.name}</option>)}
        </select>
      </Field>
      <Modal open={pending !== undefined} onClose={() => { if (!busy) setPending(undefined) }} title="Bytte utgave?" kicker={item.title}>
        <p className="mb-5 text-sm text-ink-soft">Prosjektet og vikarlenkene vil bruke filene i «{name}». Dette endrer notene som medlemmene får i prosjektet.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setPending(undefined)}>Avbryt</Button>
          <Button variant="primary" loading={busy} onClick={async () => {
            if (pending === undefined) return
            setBusy(true)
            try {
              await setProjectWorkEdition({ data: { projectId, workId: item.workId, editionId: pending } })
              setPending(undefined)
              toast('Prosjektets utgave er oppdatert')
              await router.invalidate()
            } catch (err) { toastError(err) }
            finally { setBusy(false) }
          }}>Bytt utgave</Button>
        </div>
      </Modal>
    </div>
  )
}
