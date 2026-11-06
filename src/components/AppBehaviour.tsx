import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { appScrollTop } from '../lib/app-scroll'
import { claimOfflineNotes } from '../lib/offline-notes'
import { resyncPush } from '../lib/push-client'
import { EDITABLE, PRESS_CONTROLS, type Press, blocksSelection, pressFrom } from '../lib/press-selection'
import { isIos, isStandalone } from '../lib/pwa'
import { refreshShellCounts } from '../lib/shell-events'
import { Icon } from './Icons'
import { toast } from './toast'

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
 *   klassen `navigated`, og styles.css slår den av — sideskift skal være
 *   umiddelbare.
 *
 * - **Langt trykk på en knapp markerer ikke tekst:** holder man fingeren på en
 *   knapp, en lenke eller en fane, markerer iOS ellers teksten ved siden av —
 *   eller hele siden — og viser «Kopier · Slå opp». Mens fingeren holder på en
 *   kontroll, har `<html>` klassen `press-no-select` (ingenting kan markeres),
 *   og en markering som likevel kommer fra et slikt trykk, fjernes. iOS sender
 *   ikke `selectstart` for denne markeringen, så det går ikke å stoppe den der.
 *   Reglene er i `src/lib/press-selection.ts`; tekst i innlegg og kommentarer
 *   markeres som før.
 *
 * «Dra for å oppdatere» (`PullToRefresh`) bor i toppmenyen i `Shell.tsx`.
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
        // Uten nett ville en ny lasting byttet ut siden med en feilside; da er
        // det bedre å vise det vi har (med frakoblet-stripen over).
        if (navigator.onLine) void router.invalidate()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  useEffect(() => {
    const root = document.documentElement
    let press: Press | null = null
    let release = 0
    const unlock = () => {
      window.clearTimeout(release)
      root.classList.remove('press-no-select')
    }
    const elementOf = (node: EventTarget | Node | null | undefined) =>
      node instanceof Element ? node : node instanceof Node ? node.parentElement : null
    const onPointerDown = (e: PointerEvent) => {
      const el = elementOf(e.target)
      press = pressFrom(e.pointerType, !!el?.closest(PRESS_CONTROLS), !!el?.closest(EDITABLE), performance.now())
      window.clearTimeout(release)
      root.classList.toggle('press-no-select', !!press?.control)
    }
    // iOS kan avbryte trykket (pointercancel) like før den markerer, så låsen
    // står litt etter at fingeren er borte.
    const onPointerEnd = () => {
      window.clearTimeout(release)
      release = window.setTimeout(unlock, 700)
    }
    const inEditable = (node: Node | null | undefined) => !!elementOf(node)?.closest(EDITABLE)
    const onSelectStart = (e: Event) => {
      if (blocksSelection(press, inEditable(e.target as Node), performance.now())) e.preventDefault()
    }
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      if (blocksSelection(press, inEditable(selection.anchorNode), performance.now())) selection.removeAllRanges()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    document.addEventListener('pointerup', onPointerEnd, { capture: true, passive: true })
    document.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: true })
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      unlock()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  useEffect(() => {
    return router.subscribe('onBeforeNavigate', () => {
      document.documentElement.classList.add('navigated')
    })
  }, [router])

  return null
}

/** Avstand (px) man må dra før slipp betyr «oppdater». */
const PULL_THRESHOLD = 72
const PULL_MAX = 110

/**
 * Dra ned for å oppdatere — bare i installert app på iOS. Safari har det selv i
 * nettleseren, og Android/Chrome har det i standalone; en installert iOS-app
 * har det ikke, og der er det den første gesten folk prøver når noe ser
 * utdatert ut.
 *
 * Rendres inni toppmenyen og står OVER den: iOS drar selv hele siden ned (med
 * toppmenyen) når man drar fra toppen, og beskjeden dukker opp i det tomme
 * feltet som åpner seg over menyen, slik som i en vanlig app. I ro ligger den
 * over toppen av skallet og synes ikke. Mens den oppdaterer, går messinglinjen
 * under menyen (som ved navigasjon) — da har iOS allerede lukket feltet.
 */
export function PullToRefresh() {
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
      if (refreshing || appScrollTop() > 0 || e.touches.length !== 1) return
      const target = e.target as HTMLElement
      // Ikke i dialoger, tekstfelt eller noe som ruller selv.
      if (document.querySelector('dialog[open]') || target.closest('textarea, input, select, [data-no-pull]')) return
      start.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
    }
    const onMove = (e: TouchEvent) => {
      if (!start.current) return
      const dy = e.touches[0]!.clientY - start.current.y
      const dx = Math.abs(e.touches[0]!.clientX - start.current.x)
      if (dy <= 0 || dx > dy || appScrollTop() > 0) {
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
        if (navigator.onLine) {
          await router.invalidate()
          refreshShellCounts()
        } else {
          toast('Du er uten nett — prøv igjen når du har dekning.', 'error')
        }
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

  if (refreshing) {
    return (
      <>
        <div aria-hidden className="nav-progress is-active" />
        <span role="status" className="sr-only">
          Oppdaterer …
        </span>
      </>
    )
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-3"
      style={{ opacity: Math.min(1, pull / 40) }}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3.5 py-2 text-xs font-medium text-ink-soft shadow-[var(--shadow-soft)]">
        <span style={{ transform: `rotate(${(pull / PULL_THRESHOLD) * 270}deg)` }} className="text-brass">
          <Icon name="refresh" size={16} strokeWidth={2} />
        </span>
        {ready ? 'Slipp for å oppdatere' : 'Dra for å oppdatere'}
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

/**
 * Delt enhet: noter lagret av en annen bruker slettes, og et push-abonnement
 * som ikke er denne brukerens avsluttes (`claimOfflineNotes`/`resyncPush`).
 * Monteres i roten for ALLE ruter med innlogget bruker — også notestativet,
 * som ikke har skallet.
 */
export function SessionGuards({ userId }: { userId: string }) {
  useEffect(() => {
    void claimOfflineNotes(userId).catch(() => {})
    void resyncPush(userId).catch(() => {})
  }, [userId])
  return null
}
