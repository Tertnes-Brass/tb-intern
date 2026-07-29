import {
  PDF_PARSE_LIMIT,
  createPdfPageCounter,
  isPdfFilename,
  uploadRejectionReason,
} from './upload'

export type UploadedFile = {
  id: string
  fileName: string
  kind: string
  partId: string | null
  partName: string | null
  pageCount: number | null
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !json) throw new Error(json?.error ?? `Serveren svarte ${res.status}`)
  return json
}

/**
 * Laster opp én fil som en R2 multipart-opplasting: åpne økt, send filen bit
 * for bit, sett sammen til slutt. Ingen av requestene bærer mer enn én bit, så
 * størrelsen på filen er ikke lenger begrenset av request- eller minnetaket på
 * Workers.
 *
 * `onProgress` kalles med antall byte sendt så langt, etter hver bit.
 *
 * `partId` settes bare av kallere som allerede VET hvilken stemme filen er —
 * PDF-splitteren. Uten den gjetter serveren fra filnavnet, som før.
 */
export async function uploadWorkFile({
  workId,
  file,
  partId,
  onProgress,
}: {
  workId: string
  file: File
  partId?: string
  onProgress?: (loaded: number) => void
}): Promise<UploadedFile> {
  const reason = uploadRejectionReason(file)
  if (reason) throw new Error(reason)

  const isPdf = isPdfFilename(file.name)

  // Små PDF-er tolkes presist med pdf-lib. Store ville låst nettleseren, og
  // telles i stedet strømmende mens bitene uansett leses nedenfor.
  let pageCount: number | null = null
  const streamCounter = isPdf && file.size > PDF_PARSE_LIMIT ? createPdfPageCounter() : null
  if (isPdf && !streamCounter) {
    try {
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
      pageCount = doc.getPageCount()
    } catch {
      // Kryptert eller ødelagt PDF — la sidetallet stå tomt.
    }
  }

  const { token, partSize } = await call<{ token: string; partSize: number }>('/api/upload/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workId, fileName: file.name, fileSize: file.size }),
  })

  try {
    const uploaded: Array<{ partNumber: number; etag: string }> = []
    let offset = 0
    for (let partNumber = 1; offset < file.size; partNumber++) {
      const chunk = await file.slice(offset, offset + partSize).arrayBuffer()
      streamCounter?.push(new Uint8Array(chunk))

      uploaded.push(
        await call<{ partNumber: number; etag: string }>(
          `/api/upload/part?token=${encodeURIComponent(token)}&part=${partNumber}`,
          { method: 'PUT', body: chunk },
        ),
      )

      offset += chunk.byteLength
      onProgress?.(offset)
    }

    const { file: saved } = await call<{ file: UploadedFile }>('/api/upload/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        parts: uploaded,
        pageCount: streamCounter ? streamCounter.result() : pageCount,
        partId: partId ?? null,
      }),
    })
    return saved
  } catch (err) {
    // La ikke halvferdige deler bli liggende igjen i bøtta.
    void fetch('/api/upload/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => {})
    throw err
  }
}
