/**
 * Innlegg som er åpnet i denne økten. Veggen viser forrige versjon av lista
 * med en gang og henter ny i bakgrunnen (`preloadStaleTime: Infinity`), så uten
 * denne ville et innlegg man nettopp leste stått som «Ulest» et øyeblikk når
 * man går tilbake. Serveren (`post_reads`) er fortsatt sannheten — dette skjuler
 * bare merket til neste svar kommer.
 */
const seen = new Set<string>()

export function rememberPostRead(id: string): void {
  seen.add(id)
}

export function seenThisSession(id: string): boolean {
  return seen.has(id)
}
