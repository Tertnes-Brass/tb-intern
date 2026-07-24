import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '../db'
import { newId } from '../lib/id'

export type FileAccessType = 'view' | 'download'

export type FileAccessActor =
  | { kind: 'user'; id: string }
  | { kind: 'share'; id: string }

/**
 * PDF-visere kan sende flere range-forespørsler og reloads for samme åpning.
 * Én bruker/delingslenke + fil + tilgangstype logges derfor høyst én gang i
 * et rullerende vindu på 60 sekunder.
 */
export const FILE_ACCESS_DEDUP_WINDOW_MS = 60_000

/**
 * Bare appens eksplisitte `?download=1` kan identifiseres sikkert som
 * nedlasting. En PDF-visers egen nedlastingsknapp kan bruke allerede hentede
 * bytes uten en ny request, så all annen strømming registreres som visning.
 */
export function accessTypeForRequestUrl(url: URL): FileAccessType {
  return url.searchParams.get('download') === '1' ? 'download' : 'view'
}

type FileAccessLogQueryInput = {
  id: string
  actor: FileAccessActor
  workFileId: string
  accessType: FileAccessType
  at: Date
}

/**
 * Én INSERT ... WHERE NOT EXISTS-operasjon gjør dedupliseringen atomisk i
 * SQLite/D1, også når en viewer sender flere forespørsler parallelt.
 */
export function buildFileAccessLogQuery(input: FileAccessLogQueryInput): SQL {
  const userId = input.actor.kind === 'user' ? input.actor.id : null
  const shareLinkId = input.actor.kind === 'share' ? input.actor.id : null
  const actorPredicate =
    input.actor.kind === 'user'
      ? sql`user_id = ${input.actor.id}`
      : sql`share_link_id = ${input.actor.id}`
  const at = input.at.getTime()
  const cutoff = at - FILE_ACCESS_DEDUP_WINDOW_MS

  return sql`
    INSERT INTO download_log (id, user_id, share_link_id, work_file_id, access_type, at)
    SELECT ${input.id}, ${userId}, ${shareLinkId}, ${input.workFileId}, ${input.accessType}, ${at}
    WHERE NOT EXISTS (
      SELECT 1
      FROM download_log
      WHERE work_file_id = ${input.workFileId}
        AND access_type = ${input.accessType}
        AND ${actorPredicate}
        AND at >= ${cutoff}
    )
  `
}

export async function logFileAccess(
  d: Pick<Db, 'run'>,
  input: {
    actor: FileAccessActor
    workFileId: string
    accessType: FileAccessType
    at?: Date
  },
): Promise<void> {
  await d.run(
    buildFileAccessLogQuery({
      id: newId(),
      actor: input.actor,
      workFileId: input.workFileId,
      accessType: input.accessType,
      at: input.at ?? new Date(),
    }),
  )
}
