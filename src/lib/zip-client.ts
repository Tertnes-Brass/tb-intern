import { buildZip, zipArchiveName, type ZipEntry } from './zip'

/**
 * Henter flere filer og pakker dem til ett ZIP-arkiv i nettleseren.
 *
 * Hver fil hentes én om gangen gjennom den vanlige fil-ruten
 * `/api/files/:id?download=1`. Det er et bevisst valg: den ruten er den ENESTE
 * reelle porten for filtilgang (se `docs/tilgangsstyring.md`), og den fører
 * også nedlastingsloggen. En ZIP-nedlasting får dermed nøyaktig samme
 * tilgangssjekk og logging som om medlemmet trykket «Last ned» på hver fil.
 */

export type ZipDownloadFile = {
  fileId: string
  /** Ønsket navn inne i arkivet — `buildZip` sanerer og avduplikerer. */
  name: string
}

export type ZipDownloadProgress = {
  /** Antall filer ferdig hentet. */
  done: number
  total: number
  /** Filen som hentes nå, til framdriftsvisningen. */
  current: string | null
}

export type ZipDownloadResult = {
  packed: number
  /** Filer som ikke kunne hentes. Arkivet lages likevel av resten. */
  skipped: Array<{ name: string; reason: string }>
}

function reasonFor(status: number): string {
  if (status === 403) return 'ingen tilgang'
  if (status === 404) return 'filen mangler'
  if (status === 401) return 'innloggingen er utløpt'
  return `serveren svarte ${status}`
}

/** Ber nettleseren lagre blobben under `fileName`. */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noreferrer'
  // Safari krever at lenken ligger i dokumentet før den kan «klikkes».
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Litt slakk før URL-en frigjøres; Safari avbryter ellers nedlastingen.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Laster ned `files` og lagrer dem som `${zipName}.zip`. Én fil som feiler
 * hopper vi over og rapporterer — hele arkivet skal ikke gå tapt fordi ett
 * objekt mangler i R2.
 */
export async function downloadFilesAsZip({
  zipName,
  files,
  onProgress,
}: {
  zipName: string
  files: ZipDownloadFile[]
  onProgress?: (progress: ZipDownloadProgress) => void
}): Promise<ZipDownloadResult> {
  const entries: ZipEntry[] = []
  const skipped: ZipDownloadResult['skipped'] = []

  for (const [i, file] of files.entries()) {
    onProgress?.({ done: i, total: files.length, current: file.name })
    try {
      // `download=1` gir samme logging (access_type = download) som
      // enkeltfil-knappen, og serveren avgjør fortsatt om filen slippes ut.
      const res = await fetch(`/api/files/${encodeURIComponent(file.fileId)}?download=1`, {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(reasonFor(res.status))
      entries.push({ name: file.name, bytes: new Uint8Array(await res.arrayBuffer()) })
    } catch (err) {
      skipped.push({ name: file.name, reason: err instanceof Error ? err.message : 'nedlastingen feilet' })
    }
  }

  onProgress?.({ done: files.length, total: files.length, current: null })
  if (entries.length === 0) throw new Error('Ingen av filene kunne lastes ned')

  saveBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), zipArchiveName(zipName))
  return { packed: entries.length, skipped }
}
