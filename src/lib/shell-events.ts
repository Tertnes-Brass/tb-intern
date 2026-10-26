/**
 * Et lite signal fra en side til skallet: «tellerne kan ha endret seg» (en
 * beskjed er lest, et forumsvar er sett). Skallet henter da `getShellCounts`
 * på nytt. En DOM-hendelse i stedet for en React-kontekst, så sidene ikke
 * trenger å vite hvor skallet bor.
 */
const EVENT = 'tb:shell-counts'

let pending: ReturnType<typeof setTimeout> | null = null

/**
 * Slås sammen: forumet markerer svar som lest ett og ett mens man ruller, og 30
 * leste svar skal bli én henting, ikke 30.
 */
export function refreshShellCounts(): void {
  if (typeof window === 'undefined') return
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    window.dispatchEvent(new Event(EVENT))
  }, 800)
}

export function onShellCountsRefresh(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
