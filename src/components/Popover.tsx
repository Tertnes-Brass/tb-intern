import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Et lite panel som åpner seg fra en knapp — GIF-velgeren og reaksjonsmenyen.
 *
 * På datamaskin står det ved knappen (over når det er plass, ellers under, og
 * aldri utenfor skjermen). På telefon er det et bunnark over tastaturet og
 * fanelinjen, som Modal i ui.tsx. Det rendres i `document.body` (portal): i
 * installert iOS-app ruller innholdet inne i `.app-shell`, og et panel der inne
 * ville blitt klippet av skallet.
 *
 * Lukkes med Escape, med et trykk utenfor (ikke på knappen — den veksler selv)
 * og når knappen forsvinner. Fokus går tilbake til knappen.
 */
export function Popover({
  anchor,
  open,
  onClose,
  label,
  width = 360,
  height = 420,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** Skjermleserens navn på panelet. */
  label: string
  width?: number
  /** Høyden på datamaskin; på telefon tar arket det det trenger, opptil 75 % av skjermen. */
  height?: number
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [sheet, setSheet] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const phone = window.matchMedia('(max-width: 639px)').matches
      setSheet(phone)
      const rect = anchor.current?.getBoundingClientRect()
      if (phone || !rect) return setPos(null)
      const margin = 8
      const w = Math.min(width, window.innerWidth - margin * 2)
      const left = Math.min(Math.max(margin, rect.left), window.innerWidth - w - margin)
      const above = rect.top - height - 6
      const below = rect.bottom + 6
      const top = above >= margin ? above : Math.min(below, window.innerHeight - height - margin)
      setPos({ left, top: Math.max(margin, top) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, width, height])

  useEffect(() => {
    if (!open) return
    const returnTo = anchor.current
    // Hadde panelet fokus, går fokus tilbake til knappen når det lukkes —
    // ellers havner det på <body>, og tastaturbrukeren mister plassen sin.
    let hadFocus = false
    const el = panel.current
    const onFocusIn = () => {
      hadFocus = true
    }
    el?.addEventListener('focusin', onFocusIn)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      el?.removeEventListener('focusin', onFocusIn)
      const lost = !document.activeElement || document.activeElement === document.body || !!el?.contains(document.activeElement)
      if (hadFocus && lost && returnTo?.isConnected) returnTo.focus()
    }
  }, [open, anchor])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <>
      {sheet && <div className="fixed inset-0 z-[80] bg-black/30" aria-hidden />}
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        className={
          sheet
            ? 'pb-safe fixed inset-x-0 bottom-0 z-[81] flex max-h-[75dvh] flex-col overflow-hidden rounded-t-[16px] border-t border-line bg-paper-raised shadow-[var(--shadow-lift)]'
            : 'fixed z-[81] flex flex-col overflow-hidden rounded-[12px] border border-line bg-paper-raised shadow-[var(--shadow-lift)]'
        }
        style={sheet ? { height: Math.min(height + 40, 640) } : pos ? { left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 16), height } : { visibility: 'hidden' }}
      >
        {sheet && <span className="sheet-grab mx-auto mt-2 mb-1 block shrink-0" aria-hidden />}
        {children}
      </div>
    </>,
    document.body,
  )
}
