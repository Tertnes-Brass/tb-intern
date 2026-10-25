import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/format'
import {
  offlineStand,
  offlineSupported,
  onOfflineChange,
  removeStandOffline,
  saveStandOffline,
} from '../lib/offline-notes'
import { Icon } from './Icons'
import { toast, toastError } from './toast'

/**
 * Lagre/fjerne et stativ offline. Delt av «Mine noter» og notestativet, så
 * begge viser det samme og bryteren aldri kommer i utakt med cachen.
 */
export function useOfflineStand(project: { id: string; name: string }, fileIds: string[]) {
  const [supported, setSupported] = useState(false)
  const [saved, setSaved] = useState<ReturnType<typeof offlineStand>>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    setSupported(offlineSupported())
    const sync = () => setSaved(offlineStand(project.id))
    sync()
    return onOfflineChange(sync)
  }, [project.id])

  const toggle = async () => {
    if (progress) return
    if (saved) {
      await removeStandOffline(project.id)
      toast('Fjernet fra enheten')
      return
    }
    setProgress({ done: 0, total: fileIds.length })
    try {
      await saveStandOffline(project, fileIds, (done, total) => setProgress({ done, total }))
      toast('Lagret for bruk uten nett')
    } catch (err) {
      toastError(err)
    } finally {
      setProgress(null)
    }
  }

  return { supported, saved, progress, toggle }
}

/** Raden på «Mine noter»: «Tilgjengelig offline · 6 stemmer · 4,2 MB» med bryter. */
export function OfflineStandRow({ project, fileIds }: { project: { id: string; name: string }; fileIds: string[] }) {
  const { supported, saved, progress, toggle } = useOfflineStand(project, fileIds)
  if (!supported || fileIds.length === 0) return null

  const count = fileIds.length === 1 ? '1 stemme' : `${fileIds.length} stemmer`
  const detail = progress
    ? `Lagrer ${progress.done} av ${progress.total} …`
    : saved
      ? `${count} · ${formatBytes(saved.bytes)} på denne enheten`
      : `${count} · for øvelser med dårlig nett`

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!saved}
      onClick={toggle}
      disabled={!!progress}
      className="sheet flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-paper-sunken disabled:cursor-wait"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brass-soft)] text-brass-strong">
        {progress ? <span className="spinner" aria-hidden /> : <Icon name="download" size={20} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold text-ink">Tilgjengelig offline</span>
        <span className="block truncate text-xs text-ink-soft">{detail}</span>
      </span>
      <span
        aria-hidden
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${saved ? 'bg-ok' : 'bg-line-strong'}`}
      >
        <span
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-paper-raised shadow transition-transform ${saved ? 'translate-x-[23px]' : 'translate-x-[3px]'}`}
        />
      </span>
    </button>
  )
}
