import { useState } from 'react'
import { mergeSelectedPdfs } from '../lib/pdf-merge-client'
import { zipArchiveName } from '../lib/zip'
import type { ZipDownloadFile } from '../lib/zip-client'
import { toast, toastError } from './toast'
import { Button } from './ui'

export function PdfDownloadButton({ name, files }: { name: string; files: ZipDownloadFile[] }) {
  const [progress, setProgress] = useState<string | null>(null)
  if (files.length === 0) return null
  return <Button size="sm" variant="secondary" loading={progress !== null} aria-busy={progress !== null} onClick={async () => {
    setProgress('Samler PDF …')
    try {
      const bytes = await mergeSelectedPdfs(files, (done, total) => setProgress(`Samler ${done} av ${total} …`))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = zipArchiveName(name).replace(/\.zip$/, '.pdf')
      link.rel = 'noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      toast(`Samlet PDF lastet ned — ${files.length} filer`)
    } catch (error) { toastError(error) }
    finally { setProgress(null) }
  }}>{progress ?? 'Last ned valgte som PDF'}</Button>
}
