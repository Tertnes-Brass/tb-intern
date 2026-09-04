import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { MediaForm, type MediaFormValues } from '../../components/MediaForm'
import { toast, toastError } from '../../components/toast'
import { Button, Kicker, Modal, Stamp } from '../../components/ui'
import { formatBytes, formatDate, formatDateTime } from '../../lib/format'
import { MEDIA_KIND_LABELS, type MediaKind, VISIBILITY_HINTS, VISIBILITY_LABELS } from '../../lib/media'
import { mediaDownloadUrl, mediaFileUrl } from '../../lib/media-client'
import { deleteMediaItem, getMediaItem, updateMedia } from '../../server/media'

/**
 * Ett medieelement (#32) — og svaret på #23.
 *
 * Saken var at avspillingsvinduet ble for lite på telefon når man trykket
 * «Lytt» i en liste. Løsningen er ikke en større boks i lista, men en EGEN side
 * per element: spilleren får hele skjermbredden, tittelen og konteksten står
 * rundt den, og lenken kan deles. En liste er for å finne noe; en side er for å
 * høre på det.
 *
 * Alt på siden er lesbart for enhver som har lov til å se elementet — gaten er
 * `getMediaItem`, som avviser med samme melding for «finnes ikke» og «ikke
 * tilgang». Knappene som endrer noe vises kun ved `canEdit`, og det er
 * kosmetikk: hver serverfunksjon i `src/server/media.ts` gater seg selv.
 */
export const Route = createFileRoute('/media/$mediaId')({
  loader: ({ params }) => getMediaItem({ data: { id: params.mediaId } }),
  component: MediaDetailPage,
})

function MediaDetailPage() {
  const { item, canEdit, projectOptions, visibilities } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const initial: MediaFormValues = {
    title: item.title,
    recordedOn: item.recordedOn ?? '',
    description: item.description ?? '',
    visibility: item.visibility,
    projectId: item.projectId ?? '',
    workId: item.workId ?? '',
    workTitle: item.workTitle ?? '',
  }

  return (
    <div className="space-y-8">
      <div className="rise">
        <Link to="/media" search={{}} className="link-quiet text-sm text-ink-faint hover:text-ink">
          ← Media
        </Link>
      </div>

      <header className="rise flex flex-wrap items-end justify-between gap-4" style={{ animationDelay: '40ms' }}>
        <div className="min-w-0">
          <Kicker className="mb-2">{MEDIA_KIND_LABELS[item.kind]}</Kicker>
          <h1 className="display-title text-3xl font-semibold italic text-ink sm:text-4xl">{item.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Stamp>{item.recordedOn ? formatDate(item.recordedOn) : 'Uten dato'}</Stamp>
            {item.visibility !== 'intern' && (
              <Stamp
                tone={item.visibility === 'styre' ? 'oxblood' : 'brass'}
                title={VISIBILITY_HINTS[item.visibility]}
              >
                {VISIBILITY_LABELS[item.visibility]}
              </Stamp>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Rediger</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          </div>
        )}
      </header>

      {/* Avspillingsvinduet. Egen «sheet» i full bredde, uten padding rundt
          selve mediet på telefon — det er hele poenget med #23. */}
      <section className="sheet rise overflow-hidden" style={{ animationDelay: '80ms' }}>
        <MediaPlayer id={item.id} kind={item.kind} title={item.title} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint">
            {item.fileName} · {formatBytes(item.size)}
          </p>
          <a href={mediaDownloadUrl(item.id)} className="link-quiet text-sm text-ink-soft hover:text-brass-strong">
            Last ned
          </a>
        </div>
      </section>

      {item.description && (
        <section className="sheet rise p-5 sm:p-6" style={{ animationDelay: '120ms' }}>
          <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">{item.description}</p>
        </section>
      )}

      <section className="sheet rise p-5 sm:p-6" style={{ animationDelay: '160ms' }}>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Detail label="Prosjekt">
            {item.projectId && item.projectName ? (
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to="/noter/prosjekter/$projectId"
                  params={{ projectId: item.projectId }}
                  className="link-quiet text-brass-strong hover:underline"
                >
                  {item.projectName}
                </Link>
                <Link
                  to="/media"
                  search={{ prosjekt: item.projectId }}
                  className="link-quiet text-xs text-ink-faint hover:text-ink"
                >
                  (alt fra prosjektet)
                </Link>
              </span>
            ) : (
              <span className="text-ink-faint">Ingen kobling</span>
            )}
          </Detail>

          <Detail label="Verk">
            {item.workId && item.workTitle ? (
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to="/noter/arkiv/$workId"
                  params={{ workId: item.workId }}
                  className="link-quiet text-brass-strong hover:underline"
                >
                  {item.workTitle}
                </Link>
                {item.workComposer && <span className="text-ink-faint">· {item.workComposer}</span>}
                <Link
                  to="/media"
                  search={{ verk: item.workId }}
                  className="link-quiet text-xs text-ink-faint hover:text-ink"
                >
                  (alle opptak av verket)
                </Link>
              </span>
            ) : (
              <span className="text-ink-faint">Ingen kobling</span>
            )}
          </Detail>

          <Detail label="Lagt inn av">{item.uploaderName ?? <span className="text-ink-faint">Ukjent</span>}</Detail>

          <Detail label="Lagt inn">{formatDateTime(item.createdAt)}</Detail>
        </dl>
      </section>

      {canEdit && (
        <>
          <Modal
            open={editing}
            onClose={() => setEditing(false)}
            title="Rediger media"
            kicker={item.title}
            wide
            mobileFull
          >
            <p className="mb-5 text-sm text-ink-soft">
              Filen byttes ikke ut — en ny fil er et nytt opptak, og en lenke noen har delt skal fortsette å peke på
              det den pekte på.
            </p>
            <MediaForm
              initial={initial}
              visibilities={visibilities}
              projectOptions={projectOptions}
              submitLabel="Lagre"
              onCancel={() => setEditing(false)}
              onSubmit={async (values) => {
                await updateMedia({
                  data: {
                    id: item.id,
                    title: values.title,
                    recordedOn: values.recordedOn || null,
                    description: values.description || null,
                    visibility: values.visibility,
                    projectId: values.projectId || null,
                    workId: values.workId || null,
                  },
                })
                toast('Endringene er lagret')
                setEditing(false)
                await router.invalidate()
              }}
            />
          </Modal>

          <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette dette?">
            <p className="text-sm text-ink-soft">
              «{item.title}» og selve filen slettes for godt. Det kan ikke angres.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Avbryt
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await deleteMediaItem({ data: { id: item.id } })
                    toast('Medieelementet er slettet')
                    await router.invalidate()
                    await navigate({ to: '/media', search: {} })
                  } catch (err) {
                    toastError(err)
                  }
                }}
              >
                Slett
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint">{label}</dt>
      <dd className="mt-1 text-[0.95rem] text-ink">{children}</dd>
    </div>
  )
}

/**
 * Selve spilleren. Nettleserens egne kontroller, ikke våre egne: de er kjente,
 * de er tilgjengelige med tastatur og skjermleser, og de har en spolestripe som
 * fungerer så lenge serveren svarer på `Range` — det gjør `/api/media/$mediaId`.
 *
 * `preload="metadata"` henter lengden uten å laste ned hele opptaket. Å hente
 * 90 MB fordi noen ÅPNET en side ville vært dyrt for både korpset og
 * mobilabonnementet.
 */
function MediaPlayer({ id, kind, title }: { id: string; kind: MediaKind; title: string }) {
  const src = mediaFileUrl(id)

  if (kind === 'bilde') {
    return <img src={src} alt={title} className="max-h-[75vh] w-full bg-paper-sunken object-contain" />
  }

  if (kind === 'video') {
    return (
      <video src={src} controls preload="metadata" playsInline className="max-h-[75vh] w-full bg-ink">
        Nettleseren din kan ikke spille av denne videoen.
      </video>
    )
  }

  return (
    <div className="bg-paper-sunken px-4 py-8 sm:px-6">
      <audio src={src} controls preload="metadata" className="w-full">
        Nettleseren din kan ikke spille av dette opptaket.
      </audio>
    </div>
  )
}
