/**
 * Ren logikk for prosjektkommentarer (#27) — hvordan flate rader blir tråder,
 * hvem som får slette hva, og hvordan en tråd beskrives. Ingen server- eller
 * DOM-avhengigheter.
 *
 * Dette er bevisst IKKE et forum. Modellen er ett spørsmål med svar under, på
 * det prosjektet spørsmålet gjelder — ett nivå, ingen kategorier, ingen egen
 * inngang. Saken ber uttrykkelig om det lette første steget, og om at det skal
 * kunne vokse: alt som skiller dette fra et forum er REGLER (ett svarnivå,
 * ingen egne sider), ikke datamodellen.
 */

/** Maks lengde på en kommentar. Samme tak som kommentarene på veggen. */
export const PROJECT_COMMENT_MAX = 4_000

export type ProjectCommentAuthor = { id: string | null; name: string }

/** Én rad slik den kommer fra databasen, uansett om den er en tråd eller et svar. */
export type ProjectCommentRow = {
  id: string
  /** NULL = tråden selv (spørsmålet). Ellers id-en til tråden svaret hører til. */
  parentId: string | null
  body: string
  author: ProjectCommentAuthor
  createdAt: number
  /** Kun meningsfull på en tråd. Satt = spørsmålet er markert som avklart. */
  resolvedAt: number | null
  resolvedByName: string | null
}

export type ProjectCommentThread = ProjectCommentRow & {
  replies: ProjectCommentRow[]
}

/**
 * Flate rader → tråder.
 *
 * Rekkefølgen er et produktvalg, ikke en tilfeldighet: **åpne spørsmål først,
 * avklarte etterpå**, og innenfor hver gruppe det nyeste øverst. Prosjektsiden
 * leses av to slags folk — den som lurer på noe, og den som skal svare — og
 * begge er tjent med at det ubesvarte ligger der øyet lander først. Svarene i en
 * tråd står derimot alltid kronologisk: en samtale leses forfra.
 *
 * Et svar uten tråd (som ikke kan oppstå — fremmednøkkelen cascader) faller
 * bort i stedet for å bli en tråd av seg selv. Funksjonen er total: den svarer
 * på en hvilken som helst liste uten å kaste.
 */
export function threadsFrom(rows: ProjectCommentRow[]): ProjectCommentThread[] {
  const threads = new Map<string, ProjectCommentThread>()
  for (const row of rows) {
    if (row.parentId === null) threads.set(row.id, { ...row, replies: [] })
  }
  for (const row of rows) {
    if (row.parentId === null) continue
    threads.get(row.parentId)?.replies.push(row)
  }
  for (const thread of threads.values()) {
    thread.replies.sort((a, b) => a.createdAt - b.createdAt)
  }
  return [...threads.values()].sort((a, b) => {
    const aOpen = a.resolvedAt === null
    const bOpen = b.resolvedAt === null
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    return b.createdAt - a.createdAt
  })
}

/**
 * Egen kommentar, eller en med `projects.manage` (moderering).
 *
 * Samme regel som `canDeleteComment` på veggen, med én forskjell som følger av
 * modellen: sletter du en TRÅD, forsvinner svarene med den (cascade). Det er
 * med vilje — en tråd modereres som en tråd — og det er derfor UI-et sier fra
 * om det før man trykker.
 */
export function canDeleteProjectComment(
  me: { id: string } | null,
  comment: { author: { id: string | null } },
  canManage: boolean,
): boolean {
  if (!me) return false
  if (canManage) return true
  return comment.author.id !== null && comment.author.id === me.id
}

/**
 * Å svare og å markere som avklart er STABENS handlinger (`projects.manage`).
 *
 * Alle medlemmer kan spørre, og alle kan skrive en ny kommentar i tråden sin —
 * men «dette er besvart» er et svar på vegne av prosjektet, ikke en mening. Uten
 * skillet ville den som spurte kunnet lukke sitt eget spørsmål før noen rakk å
 * se det, og «avklart» ville sluttet å bety noe.
 */
export function canAnswerProjectThread(canManage: boolean): boolean {
  return canManage
}

/** «Avklart» / «Åpent spørsmål» — statusen på en tråd, i ett ord til stempelet. */
export function threadStatusLabel(thread: { resolvedAt: number | null }): string {
  return thread.resolvedAt === null ? 'Åpent' : 'Avklart'
}

/** «Ingen svar ennå», «1 svar», «3 svar». */
export function replyCountLabel(n: number): string {
  if (n <= 0) return 'Ingen svar ennå'
  return n === 1 ? '1 svar' : `${n} svar`
}

/**
 * Hvor mange tråder som venter på svar. Tallet stab faktisk trenger: en
 * kommentar som er besvart er ikke en oppgave lenger.
 */
export function openThreadCount(threads: Array<{ resolvedAt: number | null }>): number {
  return threads.filter((t) => t.resolvedAt === null).length
}

/** «2 spørsmål venter på svar», «1 spørsmål venter på svar», tom streng ved null. */
export function openThreadsLabel(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? '1 spørsmål venter på svar' : `${n} spørsmål venter på svar`
}
