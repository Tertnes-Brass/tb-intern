import { useState, type ReactNode } from 'react'
import { Button, Modal } from '../ui'

/**
 * Bekreftelse før en ødeleggende handling i administrasjonsflatene
 * (trekk tilbake en invitasjon, slett en stemme eller rolle). Handlingen
 * står i ActionMenu sin nederste, røde rad — dette er steget etter den, så
 * ett feiltrykk aldri gjør noe som ikke kan angres. På telefon er dialogen et
 * bunnark (Modal), og knappene står fullbredde innen tommelens rekkevidde.
 */
export function ConfirmDialog({
  open,
  title,
  kicker,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: ReactNode
  kicker?: string
  children: ReactNode
  /** Verbet på knappen, f.eks. «Trekk tilbake» — aldri bare «OK». */
  confirmLabel: string
  /** Kaster den, blir dialogen stående (feilen vises av kalleren). */
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      // Kalleren har allerede vist feilen; arket blir stående.
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} kicker={kicker}>
      <div className="text-sm leading-relaxed text-ink-soft">{children}</div>
      <div className="flex flex-col-reverse gap-2 pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy} className="w-full sm:w-auto">
          Avbryt
        </Button>
        <Button type="button" variant="danger" loading={busy} onClick={() => void confirm()} className="w-full sm:w-auto">
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
