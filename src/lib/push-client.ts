import { deletePushSubscription, getPushConfig, savePushSubscription } from '../server/push'
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

/** Ber om lov, abonnerer og lagrer abonnementet hos oss. Kaster med en norsk melding. */
export async function enablePush(): Promise<void> {
  const reg = await registration()
  if (!reg) throw new Error('Varsler krever at appen er installert og lastet på nytt.')
  const { publicKey } = await getPushConfig()
  if (!publicKey) throw new Error('Varsler er ikke satt opp på serveren ennå.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Varsler er blokkert for Intern. Slå dem på i innstillingene på telefonen.'
        : 'Du må tillate varsler for å slå dem på.',
    )
  }
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
 * Ved oppstart: har enheten et abonnement og lov til å vise varsler, sendes det
 * til serveren på nytt. Det retter opp et abonnement nettleseren har fornyet i
 * stillhet, eller en rad som ble slettet etter en 410.
 */
export async function resyncPush(): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
  const sub = await currentPushSubscription()
  if (sub) await savePushSubscription({ data: toInput(sub) }).catch(() => {})
}
