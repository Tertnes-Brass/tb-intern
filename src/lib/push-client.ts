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
  // `serviceWorker.ready` venter for alltid uten en aktiv service worker (i dev,
  // eller hvis installasjonen feilet) — og da ville også utloggingen hengt.
  const existing = await navigator.serviceWorker.getRegistration()
  return existing?.active ? existing : null
}

/** Hvem som slo på varsler på denne enheten — for å kjenne igjen et fornyet abonnement. */
const OWNER_KEY = 'tb-push-owner'

function rememberOwner(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(OWNER_KEY, userId)
    else window.localStorage.removeItem(OWNER_KEY)
  } catch {}
}

function rememberedOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

/** Er abonnementet laget med den samme VAPID-nøkkelen som serveren bruker nå? */
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey
  if (!key) return false
  const a = new Uint8Array(key)
  const b = base64UrlDecode(publicKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
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
export async function enablePush(publicKey: string | null, userId: string): Promise<void> {
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
  // Et abonnement laget med en gammel nøkkel avvises av push-tjenesten for
  // alltid; da må det lages på nytt.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe().catch(() => {})
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlDecode(publicKey) })
  }
  await savePushSubscription({ data: toInput(sub) })
  rememberOwner(userId)
}

/** Slår av for denne enheten: hos push-tjenesten og hos oss. */
export async function disablePush(): Promise<void> {
  rememberOwner(null)
  const sub = await currentPushSubscription()
  if (!sub) return
  await deletePushSubscription({ data: { endpoint: sub.endpoint } }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/**
 * Ved oppstart: oppdater serverens kopi av denne enhetens abonnement, men bare
 * hvis det er brukerens (`refreshPushSubscription`).
 *
 * - Tilhører det en annen bruker, avsluttes det lokalt — ingen får varsler de
 *   ikke selv har slått på.
 * - Finnes det ikke hos oss, men det var DENNE brukeren som slo på varsler her,
 *   har nettleseren fornyet abonnementet i stillhet (ny adresse). Da lagres det
 *   nye. Ellers avsluttes det, så «På/Av» stemmer med hva serveren sender.
 */
export async function resyncPush(userId: string): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
  const sub = await currentPushSubscription()
  if (!sub) return
  const { status } = await refreshPushSubscription({ data: toInput(sub) })
  if (status === 'ok') return
  if (status === 'missing' && rememberedOwner() === userId) {
    await savePushSubscription({ data: toInput(sub) })
    return
  }
  rememberOwner(null)
  await sub.unsubscribe().catch(() => {})
}
