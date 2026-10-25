import { useSyncExternalStore } from 'react'

type Toast = { id: number; message: string; kind: 'ok' | 'error' }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(message: string, kind: Toast['kind'] = 'ok') {
  const id = nextId++
  toasts = [...toasts, { id, message, kind }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 3800)
}

export function toastError(err: unknown) {
  const message = err instanceof Error ? err.message : 'Noe gikk galt'
  toast(message.replace(/^Error:\s*/, ''), 'error')
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  )
  if (items.length === 0) return null
  return (
    <div className="toast-stack pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rise pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm shadow-[var(--shadow-lift)] ${
            t.kind === 'error'
              ? 'border-danger/40 bg-paper-raised text-danger'
              : 'border-line-strong bg-paper-raised text-ink'
          }`}
        >
          {t.kind === 'ok' ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden className="text-brass">
              <path d="M2 7l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path d="M6.5 3.5v4M6.5 9.8v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
