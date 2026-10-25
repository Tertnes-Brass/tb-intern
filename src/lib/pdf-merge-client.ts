import type { ZipDownloadFile } from './zip-client'

/** Hver kilde går gjennom den vanlige fil-gaten. Feil avbryter hele samlingen. */
export async function mergeSelectedPdfs(
  files: ZipDownloadFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (files.length === 0) throw new Error('Velg minst én PDF-fil')
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length)
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(file.fileId)}?download=1`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(response.status === 403 ? 'Ingen tilgang' : response.status === 401 ? 'Innloggingen er utløpt' : 'Kunne ikke hente filen')
      const source = await PDFDocument.load(await response.arrayBuffer())
      if (source.getPageCount() === 0) throw new Error('PDF-en har ingen sider')
      const pages = await merged.copyPages(source, source.getPageIndices())
      for (const page of pages) merged.addPage(page)
    } catch {
      throw new Error(`Kunne ikke samle «${file.name}». Kontroller at filen er en lesbar PDF uten passord, og at du har tilgang. Ingen samlet PDF er lastet ned.`)
    }
    onProgress?.(index + 1, files.length)
  }
  return new Uint8Array(await merged.save())
}
