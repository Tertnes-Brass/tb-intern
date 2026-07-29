import { useState } from 'react'
import { downloadFilesAsZip, type ZipDownloadFile } from '../lib/zip-client'
import { zipArchiveName } from '../lib/zip'
import { toast, toastError } from './toast'
import { Button } from './ui'

/**
 * Knapp som henter en samling filer og lagrer dem som ett ZIP-arkiv.
 *
 * Filene hentes én om gangen gjennom `/api/files/:id?download=1`, så
 * tilgangssjekken og nedlastingsloggen er de samme som for enkeltfiler — se
 * `src/lib/zip-client.ts`. Selve pakkingen skjer i nettleseren.
 */
export function ZipDownloadButton({
  label,
  zipName,
  files,
  variant = 'secondary',
  size = 'sm',
  className = '',
}: {
  label: string
  /** Navnet på arkivet, uten «.zip» — vanligvis prosjektet eller verket. */
  zipName: string
  files: ZipDownloadFile[]
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
  className?: string
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  if (files.length === 0) return null

  const run = async () => {
    setProgress({ done: 0, total: files.length })
    try {
      const res = await downloadFilesAsZip({
        zipName,
        files,
        onProgress: ({ done, total }) => setProgress({ done, total }),
      })
      const archive = zipArchiveName(zipName)
      if (res.skipped.length > 0) {
        // Én manglende fil skal ikke velte hele arkivet — si hvilke som mangler.
        const names = res.skipped.slice(0, 3).map((s) => s.name).join(', ')
        const rest = res.skipped.length > 3 ? ` +${res.skipped.length - 3} flere` : ''
        toast(
          `«${archive}» ble lastet ned med ${res.packed} ${res.packed === 1 ? 'fil' : 'filer'} — ` +
            `hoppet over ${names}${rest}`,
          'error',
        )
      } else {
        toast(`«${archive}» lastet ned — ${res.packed} ${res.packed === 1 ? 'fil' : 'filer'}`)
      }
    } catch (err) {
      toastError(err)
    } finally {
      setProgress(null)
    }
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <Button variant={variant} size={size} loading={!!progress} onClick={run} aria-busy={!!progress}>
        {progress ? `Pakker ${progress.done} av ${progress.total} …` : label}
      </Button>
      {progress && (
        <span className="block h-1 overflow-hidden rounded-full bg-paper-sunken" aria-hidden>
          <span className="block h-full bg-brass transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </span>
      )}
    </span>
  )
}
