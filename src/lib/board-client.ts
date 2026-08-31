/** Klientsiden av dokumentopplastingen i styreområdet. */

/** Speiler `BOARD_MAX_UPLOAD_BYTES` på serveren — serveren er fasit. */
export const BOARD_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type UploadedBoardDocument = {
  id: string
  title: string
  fileName: string
  size: number
}

/**
 * Laster opp ett styredokument med én `PUT` mot `/api/board-files/upload`.
 * Filen er kroppen; tittel, filnavn og møte følger i søkestrengen. Ruten er
 * gated på `board.manage`, og bytene kan bare hentes tilbake gjennom
 * `/api/board-files/$documentId`.
 */
export async function uploadBoardDocument(input: {
  file: File
  title?: string
  meetingId?: string | null
}): Promise<UploadedBoardDocument> {
  if (input.file.size === 0) throw new Error('Filen er tom')
  if (input.file.size > BOARD_MAX_UPLOAD_BYTES) throw new Error('Filen er større enn 25 MB')

  const params = new URLSearchParams({ name: input.file.name })
  if (input.title?.trim()) params.set('title', input.title.trim())
  if (input.meetingId) params.set('meetingId', input.meetingId)

  const res = await fetch(`/api/board-files/upload?${params}`, {
    method: 'PUT',
    headers: { 'content-type': input.file.type || 'application/octet-stream' },
    body: input.file,
  })
  const json = (await res.json().catch(() => null)) as
    | { document?: UploadedBoardDocument; error?: string }
    | null
  if (!res.ok || !json?.document) throw new Error(json?.error ?? `Serveren svarte ${res.status}`)
  return json.document
}

/** Lenken som viser dokumentet, og den som laster det ned. */
export function boardDocumentUrl(id: string, download = false): string {
  return `/api/board-files/${id}${download ? '?download=1' : ''}`
}
