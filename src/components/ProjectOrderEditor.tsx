import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from '@tanstack/react-router'
import { reorderProjectWorks, type ProjectWorkDetail } from '../server/projects'
import { Button } from './ui'
import { toast, toastError } from './toast'

export function ProjectOrderEditor({ projectId, items, onClose }: {
  projectId: string
  items: ProjectWorkDetail[]
  onClose: () => void
}) {
  const router = useRouter()
  const [order, setOrder] = useState(items)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const list = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; width: number; slot: number } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })

  // Keep scrolling and updating the insertion marker even when the pointer
  // stays still near the edge of the list.
  useEffect(() => {
    if (!active) return
    let frame: number
    const tick = () => {
      const container = list.current
      if (container) {
        const bounds = container.getBoundingClientRect()
        const { x, y } = pointer.current
        if (y < bounds.top + 40) container.scrollTop -= 8
        else if (y > bounds.bottom - 40) container.scrollTop += 8
        const rows = Array.from(container.children)
        const next = rows.findIndex(row => {
          const rect = row.getBoundingClientRect()
          return y < rect.top + rect.height / 2
        })
        const slot = next === -1 ? rows.length : next
        setDrag(current => current ? { ...current, x, y, slot } : null)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  const activeIndex = order.findIndex(item => item.workId === active)
  const dropIndex = drag ? Math.max(0, drag.slot - (drag.slot > activeIndex ? 1 : 0)) : 0
  const draggedItem = order.find(item => item.workId === active)
  function endDrag() { setActive(null); setDrag(null) }

  function move(id: string, target: number) {
    setOrder(current => {
      const from = current.findIndex(item => item.workId === id)
      if (from < 0 || target < 0 || target >= current.length || from === target) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(target, 0, item!)
      return next
    })
  }

  return <div className="sheet mt-3 p-3 sm:p-4">
    <p className="mb-3 text-sm text-ink-soft" id="program-order-help">
      Dra i håndtaket for å flytte et verk. Med tastatur: bruk pil opp og ned på håndtaket.
    </p>
    <ol ref={list} className="max-h-[60vh] overflow-y-auto overscroll-contain divide-y divide-line" aria-label="Programrekkefølge">
      {order.map((item, index) => <li key={item.workId} data-order-id={item.workId}
        className={`relative flex min-h-12 items-center gap-3 px-2 transition-colors ${active === item.workId ? 'bg-paper-sunken text-ink-faint' : ''}`}>
        {drag && active && drag.slot === index && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brass"><span className="absolute -top-1 left-0 h-2.5 w-2.5 rounded-full bg-brass" /></span>}
        {drag && active && drag.slot === order.length && index === order.length - 1 && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-brass"><span className="absolute -top-1 left-0 h-2.5 w-2.5 rounded-full bg-brass" /></span>}
        <span className="sr-only">{active === item.workId ? 'Flyttes' : ''}</span>
        <button type="button" disabled={busy} aria-label={`Flytt ${item.title}`} aria-describedby="program-order-help"
          className="grid h-11 w-11 shrink-0 touch-none cursor-grab place-items-center rounded text-ink-soft active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40"
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const target = index + (event.key === 'ArrowUp' ? -1 : 1)
            if (target < 0 || target >= order.length) return
            move(item.workId, target)
            setAnnouncement(`${item.title}: plass ${target + 1} av ${order.length}`)
          }}
          onPointerDown={event => {
            if (event.button !== 0 || busy) return
            pointer.current = { x: event.clientX, y: event.clientY }
            setDrag({ x: event.clientX, y: event.clientY, width: list.current?.clientWidth ?? 300, slot: index })
            event.currentTarget.setPointerCapture(event.pointerId)
            setActive(item.workId)
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            pointer.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerUp={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            event.currentTarget.releasePointerCapture(event.pointerId)
            const rows = Array.from(list.current?.children ?? [])
            const next = rows.findIndex(row => {
              const rect = row.getBoundingClientRect()
              return event.clientY < rect.top + rect.height / 2
            })
            const slot = next === -1 ? rows.length : next
            const target = Math.max(0, slot - (slot > index ? 1 : 0))
            move(item.workId, target)
            endDrag()
            setAnnouncement(`${item.title}: plass ${target + 1} av ${order.length}`)
          }}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}>
          <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden>
            {[4, 10, 16].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
          </svg>
        </button>
        <span className="w-6 shrink-0 text-right font-mono text-xs text-ink-faint">{index + 1}</span>
        <span className="min-w-0 truncate text-sm font-semibold">{item.title}</span>
      </li>)}
    </ol>
    {drag && draggedItem && createPortal(
      <div aria-hidden className="pointer-events-none fixed z-[100] flex items-center gap-3 rounded-lg border border-brass bg-paper-sunken px-4 py-3 text-ink shadow-xl"
        style={{ left: Math.max(8, Math.min(drag.x - 28, window.innerWidth - Math.min(drag.width, 420) - 8)), top: drag.y + 18, width: Math.min(drag.width, 420) }}>
        <span className="text-brass">⠿</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{draggedItem.title}</span>
        <span className="shrink-0 font-mono text-xs text-brass-strong">Plass {dropIndex + 1}</span>
      </div>, document.body)}
    <p className="sr-only" role="status">{announcement}</p>
    <div className="mt-4 flex justify-end gap-2">
      <Button disabled={busy} onClick={onClose}>Avbryt</Button>
      <Button variant="primary" loading={busy} disabled={active !== null} onClick={async () => {
        setBusy(true)
        try {
          await reorderProjectWorks({ data: { projectId, workIds: order.map(item => item.workId) } })
          await router.invalidate()
          toast('Rekkefølgen er lagret')
          onClose()
        } catch (error) { toastError(error) }
        finally { setBusy(false) }
      }}>Lagre rekkefølge</Button>
    </div>
  </div>
}
