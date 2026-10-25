import { deletePushSubscription, refreshPushSubscription, savePushSubscription } from '../server/push'
import { base64UrlDecode } from './web-push'
import { isIos, isStandalone } from './pwa'

/**
 * Web Push i nettleseren: slå på, slå av, og hold serveren oppdatert. Selve
 * visningen av varselet gjør service workeren (`public/sw.js`).
 *
 * På iPhone/iPad virker push bare når appen er lagt på Hjem-skjermen (iOS 16.4+);
 * i Safari-fanen finnes ikke `PushManager` i det hele tatt.
 */
export type PushSupport =
  /** Kan slås på her. */
  | 'supported'
  /** iOS i Safari: må legges på Hjem-skjermen først. */
  | 'needs-install'
  /** Nettleseren kan ikke (eller service workeren er ikke registrert, som i `pnpm dev`). */
  | 'unsupported'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!hasApis) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  return 'supported'
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  // Uten registrert service worker (dev) ville `ready` ventet for alltid.
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) return null
  return navigator.serviceWorker.ready
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

function toInput(sub: PushSubscription) {
  const json = sub.toJSON()
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } }
}

/**
 * Ber om lov, abonnerer og lagrer abonnementet hos oss. Kaster med en norsk
 * melding.
 *
 * `publicKey` hentes på forhånd (når kortet vises): iOS krever at
 * tillatelsesdialogen åpnes direkte fra trykket, og en nettverksrunde først kan
 * få Safari til å avvise den i stillhet. Derfor er `requestPermission` det
 * første som skjer her.
 */
export async function enablePush(publicKey: string | null): Promise<void> {
  if (!publicKey) throw new Error('Varsler er ikke satt opp på serveren ennå.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Varsler er blokkert for Intern. Slå dem på i innstillingene på telefonen.'
        : 'Du må tillate varsler for å slå dem på.',
    )
  }
  const reg = await registration()
  if (!reg) throw new Error('Varsler krever at appen er installert og lastet på nytt.')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlDecode(publicKey) })
  }
  await savePushSubscription({ data: toInput(sub) })
}

/** Slår av for denne enheten: hos push-tjenesten og hos oss. */
export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  await deletePushSubscription({ data: { endpoint: sub.endpoint } }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/**
 * Ved oppstart: oppdater serverens kopi av denne enhetens abonnement, men bare
 * hvis det allerede er brukerens (`refreshPushSubscription`). Finnes det ikke
 * hos oss, eller tilhører det en annen bruker, avsluttes det lokalt — da
 * stemmer «På/Av» i appen med hva serveren faktisk sender, og ingen får varsler
 * de ikke selv har slått på.
 */
export async function resyncPush(): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
  const sub = await currentPushSubscription()
  if (!sub) return
  const { status } = await refreshPushSubscription({ data: toInput(sub) })
  if (status !== 'ok') await sub.unsubscribe().catch(() => {})
}
