import { authClient } from './auth-client'

/**
 * Logg ut fra denne enheten. Felles for brukermenyen (desktop) og «Meg og mer»
 * (mobil), så begge rydder det samme.
 */
export async function signOutHere(): Promise<void> {
  await authClient.signOut()
}
