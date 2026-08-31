import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardDocumentRow, BoardUploadButton } from '../../../components/BoardDocuments'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Kicker, Modal } from '../../../components/ui'
import { formatDate } from '../../../lib/format'
import { deleteDocument, listDocuments, updateDocument } from '../../../server/board'

export const Route = createFileRoute('/styre/dokumenter/')({
  loader: () => listDocuments(),
  component: DocumentsPage,
})

function DocumentsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState<{ id: string; title: string } | null>(null)

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Styrearbeidet</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Dokumenter</h1>
        </div>
        <BoardUploadButton onUploaded={() => router.invalidate()} />
      </header>

      {data.documents.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '80ms' }}>
          <EmptyState title="Ingen dokumenter ennå">
            Referater, budsjetter og kontrakter. Filene kan bare åpnes av dem som har styretilgang.
          </EmptyState>
        </div>
      ) : (
        <ul className="sheet rise overflow-hidden" style={{ animationDelay: '80ms' }}>
          {data.documents.map((doc) => (
            <BoardDocumentRow
              key={doc.id}
              doc={doc}
              showMeeting
              onDelete={() => setPending({ id: doc.id, title: doc.title })}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="field-input"
                  aria-label={`Tittel for ${doc.fileName}`}
                  defaultValue={doc.title}
                  maxLength={200}
                  // Tittelen lagres når feltet forlates — ett felt, ingen
                  // lagre-knapp per rad.
                  onBlur={async (e) => {
                    const title = e.target.value.trim()
                    if (!title || title === doc.title) return
                    try {
                      await updateDocument({ data: { id: doc.id, title } })
                      await router.invalidate()
                    } catch (err) {
                      toastError(err)
                    }
                  }}
                />
                <select
                  className="field-input"
                  aria-label={`Møte for ${doc.title}`}
                  value={doc.meetingId ?? ''}
                  onChange={async (e) => {
                    try {
                      await updateDocument({ data: { id: doc.id, meetingId: e.target.value || null } })
                      await router.invalidate()
                    } catch (err) {
                      toastError(err)
                    }
                  }}
                >
                  <option value="">Ikke knyttet til et møte</option>
                  {data.meetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatDate(m.date)} · {m.title}
                    </option>
                  ))}
                </select>
              </div>
            </BoardDocumentRow>
          ))}
        </ul>
      )}

      <Modal open={pending !== null} onClose={() => setPending(null)} title="Slette dokumentet?">
        <p className="text-sm text-ink-soft">
          «{pending?.title}» slettes både fra oversikten og fra lageret. Dette kan ikke angres.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setPending(null)}>Avbryt</Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!pending) return
              try {
                await deleteDocument({ data: { id: pending.id } })
                toast('Dokumentet er slettet')
                setPending(null)
                await router.invalidate()
              } catch (err) {
                toastError(err)
              }
            }}
          >
            Slett
          </Button>
        </div>
      </Modal>
    </div>
  )
}
