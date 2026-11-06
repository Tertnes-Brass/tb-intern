import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toOsloDate } from '../lib/format'
import { MAX_PINNED_POSTS, MAX_PIN_DAYS, addDays, pinDurationLabel, pinUntilRejection } from '../lib/pins'
import { setPostPinned } from '../server/posts'
import { Segmented } from './Segmented'
import { toast, toastError } from './toast'
import { Button, Field, Modal } from './ui'

type Duration = 'open' | 'date'

/**
 * Fest et innlegg øverst på veggen, eller endre hvor lenge det står der.
 * Brukes fra «Administrer» på innlegget og fra ⋯ på raden i «Festet».
 * Løsning går ikke via dialogen — den er en egen, angrebar handling i menyen.
 *
 * Varigheten er enten «til noen løsner det» eller en dato (til og med den
 * dagen). Taket håndheves av serveren; dialogen sier bare at det finnes.
 */
export function PinDialog({
  open,
  onClose,
  post,
}: {
  open: boolean
  onClose: () => void
  post: { id: string; heading: string; pinned: boolean; pinnedUntil: string | null }
}) {
  const router = useRouter()
  const today = toOsloDate(Date.now())
  const [duration, setDuration] = useState<Duration>(post.pinnedUntil ? 'date' : 'open')
  const [until, setUntil] = useState(post.pinnedUntil ?? addDays(today, 7))
  const [busy, setBusy] = useState(false)

  // Åpnes dialogen på nytt, skal den vise innleggets nåværende valg.
  useEffect(() => {
    if (!open) return
    setDuration(post.pinnedUntil ? 'date' : 'open')
    setUntil(post.pinnedUntil ?? addDays(toOsloDate(Date.now()), 7))
  }, [open, post.pinnedUntil])

  const chosen = duration === 'date' ? until : null
  const rejection = pinUntilRejection(chosen, today)

  const save = async () => {
    if (rejection) return
    setBusy(true)
    try {
      await setPostPinned({ data: { id: post.id, pinned: true, until: chosen } })
      toast(post.pinned ? 'Festingen er endret' : 'Festet øverst på veggen')
      onClose()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={post.pinned ? 'Endre festingen' : 'Feste innlegget?'}
      kicker="Veggen"
      subtitle={post.heading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Avbryt
          </Button>
          <Button variant="primary" className="flex-1" onClick={() => void save()} loading={busy} disabled={!!rejection}>
            {post.pinned ? 'Lagre' : 'Fest innlegget'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        Festede innlegg står øverst på veggen for alle som kan se dem — fint for øvingstider, praktisk informasjon og
        viktige beskjeder før en konsert. Inntil {MAX_PINNED_POSTS} kan være festet samtidig.
      </p>
      <div className="mt-5 space-y-4">
        <Segmented<Duration>
          label="Hvor lenge"
          value={duration}
          onChange={setDuration}
          stretch
          options={[
            { value: 'open', label: 'Til noen løsner det' },
            { value: 'date', label: 'Til en dato' },
          ]}
        />
        {duration === 'date' && (
          <Field label="Festet til og med" hint={rejection ?? pinDurationLabel(until, today)}>
            <input
              type="date"
              className="field-input"
              value={until}
              min={today}
              max={addDays(today, MAX_PIN_DAYS)}
              onChange={(e) => setUntil(e.target.value)}
              required
            />
          </Field>
        )}
      </div>
    </Modal>
  )
}

/** «Løsne» fra en meny: ingen bekreftelse — det kan festes igjen med ett trykk. */
export async function unpinPost(id: string, invalidate: () => Promise<unknown>): Promise<void> {
  try {
    await setPostPinned({ data: { id, pinned: false } })
    toast('Innlegget er løsnet fra toppen av veggen')
    await invalidate()
  } catch (err) {
    toastError(err)
  }
}
