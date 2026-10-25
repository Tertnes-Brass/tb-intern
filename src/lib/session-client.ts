import { authClient } from './auth-client'
import { clearOfflineNotes } from './offline-notes'
import { disablePush } from './push-client'

/**
 * Logg ut fra denne enheten. Felles for brukermenyen (desktop) og «Meg og mer»
 * (mobil), så begge rydder det samme — en delt iPad skal ikke beholde noe av
 * forrige bruker:
 *
 * - varsler: abonnementet slettes hos oss (mens økten ennå gjelder) og hos
 *   push-tjenesten, ellers ville neste bruker fått forrige brukers varsler;
 * - noter lagret offline, og tallet på app-ikonet.
 *
 * Ryddingen skal aldri hindre selve utloggingen.
 */
export async function signOutHere(): Promise<void> {
  await Promise.allSettled([disablePush(), clearOfflineNotes(), clearBadge()])
  await authClient.signOut()
}

async function clearBadge(): Promise<void> {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
  await nav.clearAppBadge?.()
}
