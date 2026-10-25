/**
 * Klientsiden av PWA-en: registrering av service workeren, «er appen
 * installert?» og installasjonsforespørselen på Android/Chrome. Ingen
 * React her — komponentene abonnerer på det de trenger.
 *
 * Service workeren selv bor i `public/sw.js` (uten byggesteg).
 */

/** `BeforeInstallPromptEvent` finnes bare i Chromium og har ingen typer i lib.dom. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

function notifyInstall() {
  for (const listener of installListeners) listener()
}

/**
 * Kalles én gang fra rotdokumentet. `beforeinstallprompt` kommer bare én gang
 * per sidelasting, så den må fanges før noen komponent rekker å spørre.
 */
export function initPwa(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
    notifyInstall()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    notifyInstall()
  })

  // Bare i produksjonsbygget: i `pnpm dev` deler localhost-porten opprinnelse
  // med alt annet som kjører der, og en service worker ville fulgt med.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('[pwa] service worker ble ikke registrert:', err)
      })
    }
    // Hydreringen er ofte ferdig etter `load`; da venter vi ikke på den.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return installPrompt
}

export function onInstallPromptChange(listener: () => void): () => void {
  installListeners.add(listener)
  return () => installListeners.delete(listener)
}

export async function promptInstall(): Promise<boolean> {
  const event = installPrompt
  if (!event) return false
  installPrompt = null
  notifyInstall()
  await event.prompt()
  const choice = await event.userChoice
  return choice.outcome === 'accepted'
}

/** Kjører appen fra Hjem-skjermen (eller som installert app på desktop)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS før display-mode ble støttet i Safari.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone/iPad, også iPad som utgir seg for å være en Mac. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
}
