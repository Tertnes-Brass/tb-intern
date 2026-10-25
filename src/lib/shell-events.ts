/**
 * Et lite signal fra en side til skallet: «tellerne kan ha endret seg» (en
 * beskjed er lest, et forumsvar er sett). Skallet henter da `getShellCounts`
 * på nytt. En DOM-hendelse i stedet for en React-kontekst, så sidene ikke
 * trenger å vite hvor skallet bor.
 */
const EVENT = 'tb:shell-counts'

export function refreshShellCounts(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onShellCountsRefresh(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
