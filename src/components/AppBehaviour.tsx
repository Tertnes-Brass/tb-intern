import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { isIos, isStandalone } from '../lib/pwa'
import { refreshShellCounts } from '../lib/shell-events'
import { Icon } from './Icons'

/** Hvor lenge appen må ha vært i bakgrunnen før den henter data på nytt. */
const RESUME_AFTER_MS = 60_000

/**
 * Det som får nettsiden til å oppføre seg som en app etter at den er
 * installert. Monteres én gang i skallet.
 *
 * - **Tilbake fra bakgrunnen:** en installert app kan ligge i bakgrunnen i
 *   dagevis. Kommer den fram igjen etter mer enn et minutt, lastes rutens data
 *   på nytt, slik at «Neste» og veggen ikke viser gårsdagen.
 * - **`rise` bare første gang:** innlastingsanimasjonen er en velkomst, ikke
 *   noe man skal se ved hvert trykk. Etter første navigasjon får `<html>`
 *   klassen `navigated`, og styles.css slår den av — sideskiftet har sin egen
 *   overgang (View Transitions, `defaultViewTransition` i router.tsx).
 */
export function AppBehaviour() {
  const router = useRouter()

  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt > RESUME_AFTER_MS) {
        hiddenAt = 0
        void router.invalidate()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  useEffect(() => {
    return router.subscribe('onBeforeNavigate', () => {
      document.documentElement.classList.add('navigated')
    })
  }, [router])

  return <PullToRefresh />
}

/** Avstand (px) man må dra før slipp betyr «oppdater». */
const PULL_THRESHOLD = 72
const PULL_MAX = 110

/**
 * Dra ned for å oppdatere — bare i installert app på iOS. Safari har det selv i
 * nettleseren, og Android/Chrome har det i standalone; en installert iOS-app
 * har det ikke, og der er det den første gesten folk prøver når noe ser
 * utdatert ut.
 */
function PullToRefresh() {
  const router = useRouter()
  const [enabled, setEnabled] = useState(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    setEnabled(isIos() && isStandalone())
  }, [])

  useEffect(() => {
    if (!enabled) return

    const onStart = (e: TouchEvent) => {
      if (refreshing || window.scrollY > 0 || e.touches.length !== 1) return
      const target = e.target as HTMLElement
      // Ikke i dialoger, tekstfelt eller noe som ruller selv.
      if (document.querySelector('dialog[open]') || target.closest('textarea, input, select, [data-no-pull]')) return
      start.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
    }
    const onMove = (e: TouchEvent) => {
      if (!start.current) return
      const dy = e.touches[0]!.clientY - start.current.y
      const dx = Math.abs(e.touches[0]!.clientX - start.current.x)
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        start.current = null
        pullRef.current = 0
        setPull(0)
        return
      }
      // Motstand: jo lenger, jo tyngre.
      const distance = Math.min(PULL_MAX, dy * 0.55)
      pullRef.current = distance
      setPull(distance)
    }
    const onEnd = async () => {
      if (!start.current) return
      start.current = null
      const distance = pullRef.current
      pullRef.current = 0
      if (distance < PULL_THRESHOLD) {
        setPull(0)
        return
      }
      setRefreshing(true)
      setPull(PULL_THRESHOLD)
      try {
        await router.invalidate()
        refreshShellCounts()
      } finally {
        setRefreshing(false)
        setPull(0)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, refreshing, router])

  if (!enabled || (pull === 0 && !refreshing)) return null
  const ready = pull >= PULL_THRESHOLD

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{ top: `calc(env(safe-area-inset-top) + 56px + ${Math.max(0, pull - 40)}px)` }}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3.5 py-2 text-xs font-medium text-ink-soft shadow-[var(--shadow-soft)]">
        {refreshing ? (
          <span className="spinner text-brass" aria-hidden />
        ) : (
          <span style={{ transform: `rotate(${(pull / PULL_THRESHOLD) * 270}deg)` }} className="text-brass">
            <Icon name="refresh" size={16} strokeWidth={2} />
          </span>
        )}
        {refreshing ? 'Oppdaterer …' : ready ? 'Slipp for å oppdatere' : 'Dra for å oppdatere'}
      </span>
    </div>
  )
}

/**
 * Stripe under toppen når nettet er borte. Det som står på skjermen er da det
 * som sist ble hentet, og det skal man vite før man stoler på et klokkeslett.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null
  return (
    <div role="status" className="fadein border-b border-line bg-paper-sunken">
      <p className="px-safe mx-auto flex min-h-9 max-w-6xl items-center gap-2 text-[0.8rem] text-ink-soft">
        <Icon name="wifiOff" size={16} className="text-oxblood" />
        Frakoblet — det du ser, kan være utdatert. Lagrede noter virker fortsatt.
      </p>
    </div>
  )
}
