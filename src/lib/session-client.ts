import { authClient } from './auth-client'
import { clearOfflineNotes } from './offline-notes'

/**
 * Logg ut fra denne enheten. Felles for brukermenyen (desktop) og «Meg og mer»
 * (mobil), så begge rydder det samme: noter lagret offline skal ikke ligge
 * igjen på en delt iPad etter at eieren har logget ut.
 */
export async function signOutHere(): Promise<void> {
  try {
    await clearOfflineNotes()
  } catch {}
  await authClient.signOut()
}
