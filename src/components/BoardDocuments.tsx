import { type ReactNode, useRef, useState } from 'react'
import { boardDocumentUrl, uploadBoardDocument } from '../lib/board-client'
import { formatBytes, formatDateTime } from '../lib/format'
import { toast, toastError } from './toast'
import { Button } from './ui'

export type BoardDocumentItem = {
  id: string
  title: string
  fileName: string
  size: number
  createdAt: number
  uploadedByName: string | null
  meetingId?: string | null
  meetingTitle?: string | null
}

/**
 * Opplastingsknapp for styredokumenter. Filen sendes rett til den gatede
 * `PUT`-ruten; tittelen blir filnavnet med mindre man skriver noe annet.
 */
export function BoardUploadButton({
  meetingId,
  onUploaded,
  label = 'Last opp dokument',
}: {
  meetingId?: string | null
  onUploaded: () => Promise<void> | void
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            await uploadBoardDocument({ file, meetingId })
            toast('Dokumentet er lastet opp')
            await onUploaded()
          } catch (err) {
            toastError(err)
          } finally {
            setBusy(false)
          }
        }}
      />
      <Button variant="primary" loading={busy} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
    </>
  )
}

/** Én rad i dokumentlista: åpne, last ned og (valgfritt) slett. */
export function BoardDocumentRow({
  doc,
  onDelete,
  showMeeting,
  children,
}: {
  doc: BoardDocumentItem
  onDelete?: () => void
  showMeeting?: boolean
  /** Ekstra felt under raden, f.eks. møtekoblingen på dokumentoversikten. */
  children?: ReactNode
}) {
  const meta = [
    formatBytes(doc.size),
    doc.uploadedByName ?? 'Ukjent',
    formatDateTime(doc.createdAt),
    ...(showMeeting && doc.meetingTitle ? [doc.meetingTitle] : []),
  ]
  return (
    <li className="hairline-row px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <a
            href={boardDocumentUrl(doc.id)}
            target="_blank"
            rel="noreferrer"
            className="link-brass block truncate text-[0.95rem] font-medium"
          >
            {doc.title}
          </a>
          <span className="mt-0.5 block truncate text-xs text-ink-soft">
            {doc.fileName} · {meta.join(' · ')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={boardDocumentUrl(doc.id, true)}
            className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-brass-strong"
          >
            Last ned
          </a>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-danger"
            >
              Slett
            </button>
          )}
        </div>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </li>
  )
}
