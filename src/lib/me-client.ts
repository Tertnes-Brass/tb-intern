import type { Me } from '../server/access'
import { getMe } from '../server/auth'

/**
 * Hvem som er innlogget, for rotens `beforeLoad` — uten å la hvert trykk vente
 * på serveren.
 *
 * Ruteren kjører `beforeLoad` ved HVER navigasjon, og alt annet (loaderne)
 * venter på den. Et blokkerende `getMe` ga derfor én ekstra rundtur til
 * serveren per trykk, også til sider som allerede lå i cachen. Her svarer vi med
 * det vi vet, og spør serveren i bakgrunnen (stale-while-revalidate). Har svaret
 * endret seg (rolle, navn, utløpt økt), varsles ruteren, som kjører alt på nytt
 * med det nye svaret.
 *
 * Dette er bare visningen: tilgangen håndheves fortsatt i hver server function.
 * Vi venter likevel på serveren
 * - på serveren (SSR) — der ville en modulvariabel vært delt mellom brukere;
 * - når vi ikke vet om noen er innlogget (første gang, eller etter utlogging);
 * - på innloggingssidene, som videresender en innlogget bruker til `/`: et
 *   gammelt svar der kunne gitt en løkke mellom `/login` og `/`.
 */

const AUTH_PAGES = new Set(['/login', '/glemt-passord', '/tilbakestill-passord'])

let known: { me: Me | null } | null = null
let revalidating: Promise<void> | null = null
let onChange: (() => void) | null = null
/** Økes ved utlogging, så et svar som var underveis ikke legger forrige bruker tilbake. */
let generation = 0

export async function loadMe({ pathname, preload }: { pathname: string; preload: boolean }): Promise<Me | null> {
  if (typeof window === 'undefined') return getMe()
  if (!known?.me || AUTH_PAGES.has(pathname)) {
    const asked = generation
    const me = await getMe()
    if (asked === generation) known = { me }
    return me
  }
  // En forhåndslasting (fingeren på en lenke) skal ikke gi et eget kall.
  if (!preload) revalidate()
  return known.me
}

function revalidate() {
  if (revalidating) return
  const asked = generation
  revalidating = getMe()
    .then((me) => {
      if (asked !== generation) return
      const before = known?.me ?? null
      known = { me }
      if (JSON.stringify(before) !== JSON.stringify(me)) onChange?.()
    })
    // Uten nett: behold det vi vet; serverkallene på siden sier ifra selv.
    .catch(() => {})
    .finally(() => {
      revalidating = null
    })
}

/**
 * Svaret serveren ga ved første sidelasting (fra hydreringen). Overskriver
 * aldri et nyere svar.
 */
export function primeMe(me: Me | null) {
  if (!known) known = { me }
}

/** Ruteren som skal kjøre alt på nytt når svaret endrer seg. */
export function onMeChange(listener: () => void): () => void {
  onChange = listener
  return () => {
    if (onChange === listener) onChange = null
  }
}

/** Ved utlogging: neste navigasjon spør serveren og venter på svaret. */
export function forgetMe() {
  known = null
  generation++
}
