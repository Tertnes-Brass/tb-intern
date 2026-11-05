import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeDraft, encodeDraft, sameDraft } from '../../lib/drafts'

/**
 * Tar vare på det man skriver, på enheten (`localStorage`), mens man skriver.
 * Reglene og nøkkelformatet bor i `src/lib/drafts.ts`; her er bare lagringen.
 *
 * - Ved første visning leses utkastet under `storageKey`. Finnes det, og er
 *   det noe annet enn utgangspunktet (`initial`), får kalleren det i
 *   `onRestore`, og `restored` sier når det ble lagret — skjermen viser
 *   «Gjenopprettet utkast fra kl. 14:32 · Forkast».
 * - Endringer lagres etter `delay` ms uten tastetrykk, og straks når siden
 *   skjules eller komponenten forsvinner (navigasjon, omlasting av appen).
 * - Er teksten tilbake ved utgangspunktet, slettes utkastet.
 * - `clear()` etter vellykket innsending; `discard()` når man forkaster.
 *
 * `localStorage` kan mangle eller kaste (privat vindu, full lagring) — da
 * fungerer skjemaet som før, bare uten utkast.
 */
export function useLocalDraft<T>({
  storageKey,
  value,
  initial,
  validate,
  onRestore,
  base,
  delay = 600,
}: {
  /** `draftKey(...)` — med brukerens id. Uten nøkkel lagres ingenting. */
  storageKey: string | null | undefined
  value: T
  /** Hvordan «ingen endringer» ser ut. */
  initial: T
  validate: (data: unknown) => data is T
  onRestore: (data: T) => void
  /** Versjonen av det som redigeres (innleggets `updatedAt`). */
  base?: number | null
  delay?: number
}) {
  const [restored, setRestored] = useState<{ savedAt: number; stale: boolean } | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const latest = useRef({ value, initial, base, storageKey })
  latest.current = { value, initial, base, storageKey }
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore
  const validateRef = useRef(validate)
  validateRef.current = validate
  /** Et øyeblikksbilde som IKKE skal lagres (utgangspunktet ved oppstart, eller rett etter innsending). */
  const quiet = useRef<{ value: T } | null>({ value: initial })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const write = useCallback(() => {
    timer.current = null
    const { value, initial, base, storageKey } = latest.current
    if (!storageKey) return
    if (quiet.current && sameDraft(quiet.current.value, value)) return
    try {
      if (sameDraft(value, initial)) {
        window.localStorage.removeItem(storageKey)
        setSavedAt(null)
      } else {
        const now = Date.now()
        window.localStorage.setItem(storageKey, encodeDraft(value, now, base))
        setSavedAt(now)
      }
    } catch {
      // Ingen lagring tilgjengelig: skjemaet virker likevel.
    }
  }, [])

  // Les utkastet når skrivefeltet vises (og når nøkkelen bytter).
  useEffect(() => {
    quiet.current = { value: latest.current.initial }
    setRestored(null)
    setSavedAt(null)
    if (!storageKey) return
    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(storageKey)
    } catch {
      return
    }
    const stored = decodeDraft(raw, validateRef.current)
    if (!stored) {
      if (raw) {
        try {
          window.localStorage.removeItem(storageKey)
        } catch {
          // Uviktig.
        }
      }
      return
    }
    if (sameDraft(stored.data, latest.current.initial)) return
    const currentBase = latest.current.base
    setRestored({ savedAt: stored.savedAt, stale: currentBase != null && stored.base != null && stored.base !== currentBase })
    setSavedAt(stored.savedAt)
    onRestoreRef.current(stored.data)
  }, [storageKey])

  // Lagre etter en pause i skrivingen.
  const serialized = JSON.stringify(value)
  useEffect(() => {
    if (!storageKey) return
    if (quiet.current && sameDraft(quiet.current.value, latest.current.value)) return
    quiet.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(write, delay)
  }, [serialized, storageKey, delay, write])

  // Ikke mist de siste tastetrykkene: lagre straks når siden skjules eller feltet forsvinner.
  useEffect(() => {
    const flush = () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      write()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [write])

  const remove = useCallback((next: T) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    quiet.current = { value: next }
    setRestored(null)
    setSavedAt(null)
    const key = latest.current.storageKey
    if (!key) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Uviktig.
    }
  }, [])

  /** Etter vellykket innsending: utkastet er brukt opp. Det som står i feltet nå lagres ikke på nytt. */
  const clear = useCallback(() => remove(latest.current.value), [remove])
  /** «Forkast»: kalleren nullstiller feltene til `initial`. */
  const discard = useCallback(() => remove(latest.current.initial), [remove])

  return { restored, savedAt, clear, discard }
}
