import { useCallback, useEffect, useState } from 'react'

/** Hvor lenge et markert svar lyser (samme som `.thread-marked` i styles.css). */
const MARK_MS = 2200

/**
 * Rull til et svar i en tråd og la det lyse kort opp — fra et varsel, etter at
 * man selv har svart, eller fra «Svar til …». Brukes av forumet og
 * kommentarene på veggen.
 *
 * `scrollIntoView` er riktig her (i motsetning til i chatten): tråden ER siden,
 * og i installert iOS-app ruller den nærmeste rullbare forelderen, som er
 * `.app-shell`. `block: 'center'` holder svaret klar av toppmenyen. Rullingen
 * venter én frame, så ruterens egen rulling etter en navigasjon er ferdig
 * først — og så et svar som nettopp ble foldet ut, rekker å finnes i DOM-en.
 */
export function useThreadMark() {
  const [mark, setMark] = useState<{ elementId: string; n: number } | null>(null)

  useEffect(() => {
    if (!mark) return
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      document.getElementById(mark.elementId)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    })
    const timer = window.setTimeout(() => setMark(null), MARK_MS)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [mark])

  /** `n` gjør at samme svar kan markeres to ganger på rad. */
  const markElement = useCallback((elementId: string) => setMark((m) => ({ elementId, n: (m?.n ?? 0) + 1 })), [])
  return { markedId: mark?.elementId ?? null, markElement }
}
