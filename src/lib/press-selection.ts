/**
 * Langt trykk på en knapp skal ikke markere tekst.
 *
 * Holder man fingeren på en knapp, en lenke eller en fane i iOS, er ikke selve
 * kontrollen markerbar — så iOS markerer i stedet den nærmeste teksten (eller
 * hele siden) og viser «Kopier · Slå opp». I en installert app ser det ut som en
 * feil. Reglene her avgjør når en markering som begynner skal stoppes
 * (`selectstart`), og brukes av `AppBehaviour` i skallet:
 *
 * - bare når det siste trykket var med finger eller penn (aldri mus — da er det
 *   en bevisst markering med pekeren),
 * - bare når trykket begynte på en kontroll, og ikke i et tekstfelt,
 * - bare kort tid etter trykket (iOS markerer etter ~0,5 s),
 * - og aldri når markeringen er i et tekstfelt (markør, lim inn).
 *
 * Holder man fingeren på vanlig tekst — et innlegg, en kommentar — markeres den
 * som før.
 */

/** Det man trykker på som er en kontroll, ikke tekst. */
export const PRESS_CONTROLS =
  'button, a[href], label, summary, select, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], .hit, .tab-link'

/** Felt der markering alltid er lov. */
export const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'

/** Hvor lenge etter at fingeren traff en kontroll en markering stoppes. */
export const PRESS_WINDOW_MS = 2000

export type Press = { control: boolean; at: number }

/** Et nytt trykk: `null` for mus (da gjelder ingen av reglene). */
export function pressFrom(pointerType: string, pressedControl: boolean, pressedEditable: boolean, at: number): Press | null {
  if (pointerType === 'mouse') return null
  return { control: pressedControl && !pressedEditable, at }
}

/** Skal markeringen som begynner nå, stoppes? */
export function blocksSelection(press: Press | null, selectionInEditable: boolean, now: number): boolean {
  return !!press && press.control && !selectionInEditable && now - press.at < PRESS_WINDOW_MS
}
