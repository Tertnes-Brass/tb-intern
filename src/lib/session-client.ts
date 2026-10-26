import { authClient } from './auth-client'
import { forgetMe } from './me-client'
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
  // Høyst tre sekunder: en hengende service worker eller et tregt nett skal
  // aldri stå i veien for å komme seg ut.
  await Promise.race([
    Promise.allSettled([disablePush(), clearOfflineNotes(), clearBadge()]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
  await authClient.signOut()
  forgetMe()
}

async function clearBadge(): Promise<void> {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
  await nav.clearAppBadge?.()
}
