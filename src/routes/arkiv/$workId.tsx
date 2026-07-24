import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { WorkFormModal } from '../../components/WorkForm'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { formatBytes, formatDate, formatDuration } from '../../lib/format'
import { SECTION_LABELS, SECTION_ORDER } from '../../lib/taxonomy'
import {
  addWorkLink,
  deleteWork,
  deleteWorkFile,
  deleteWorkLink,
  getWork,
  rematchWorkFiles,
  setWorkFilePart,
} from '../../server/works'

export const Route = createFileRoute('/arkiv/$workId')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canBrowseArchive =
      context.me.permissions.includes('*') ||
      context.me.permissions.includes('archive.viewAll') ||
      context.me.permissions.includes('works.manage')
    if (!canBrowseArchive) throw redirect({ to: '/' })
  },
  loader: ({ params }) => getWork({ data: { id: params.workId } }),
  component: WorkPage,
})

function WorkPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const w = data.work

  const composerLine = [w.composer, w.arranger ? `arr. ${w.arranger}` : null].filter(Boolean).join(' · ')
  const partFileCount = data.files.filter((f) => f.kind === 'part').length
  const totalParts = data.allParts.filter((p) => p.section !== 'score').length

  return (
    <div className="space-y-10">
      <header className="rise">
        <Link to="/arkiv" className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong">
          ← Arkivet
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="display-title text-4xl font-semibold italic leading-tight text-ink sm:text-5xl">
              {w.title}
            </h1>
            {composerLine && <p className="mt-2 text-[0.95rem] text-ink-soft">{composerLine}</p>}
          </div>
          {data.canManage && (
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => setEditing(true)}>Rediger</Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Slett
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {w.genre && <Stamp tone="brass">{w.genre}</Stamp>}
          {w.grade && <Stamp>Grad {w.grade}</Stamp>}
          {w.durationSec ? <Stamp>{formatDuration(w.durationSec)} min</Stamp> : null}
          {w.publisher && <Stamp>{w.publisher}</Stamp>}
          {w.acquiredYear && <Stamp>Anskaffet {w.acquiredYear}</Stamp>}
          {w.physicalLocation && <Stamp tone="oxblood">{w.physicalLocation}</Stamp>}
          <Stamp tone={partFileCount >= totalParts ? 'brass' : partFileCount > 0 ? 'neutral' : 'oxblood'}>
            {partFileCount}/{totalParts} stemmer
          </Stamp>
        </div>

        {w.notes && (
          <p className="mt-4 max-w-2xl rounded-xl border border-line bg-paper-sunken/50 px-4 py-3 text-sm leading-relaxed text-ink-soft">
            <span className="kicker mr-2">NB</span>
            {w.notes}
          </p>
        )}
      </header>

      {data.canManage && <UploadZone workId={w.id} />}

      <FilesSection data={data} />

      <LinksSection data={data} />

      {data.usedIn.length > 0 && (
        <section className="rise">
          <Kicker className="mb-3">Brukt i prosjekter</Kicker>
          <ul className="flex flex-wrap gap-2">
            {data.usedIn.map((p) => (
              <li key={p.id}>
                <Link to="/prosjekter/$projectId" params={{ projectId: p.id }} className="link-quiet">
                  <Stamp className="cursor-pointer transition-colors hover:border-brass hover:text-brass-strong">
                    {p.name}
                    {p.eventDate ? ` · ${formatDate(p.eventDate)}` : ''}
                  </Stamp>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <WorkFormModal
        open={editing}
        onClose={() => setEditing(false)}
        work={w}
        onSaved={async () => {
          setEditing(false)
          await router.invalidate()
        }}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette verket?" kicker={w.title}>
        <p className="mb-5 text-sm leading-relaxed text-ink-soft">
          Dette sletter verket, alle {data.files.length} tilhørende filer og koblingene til prosjekter.
          Handlingen kan ikke angres.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </Button>
          <Button
            variant="danger"
            loading={deleting}
            onClick={async () => {
              setDeleting(true)
              try {
                await deleteWork({ data: { id: w.id } })
                toast('Verket er slettet')
                router.navigate({ to: '/arkiv' })
              } catch (err) {
                toastError(err)
                setDeleting(false)
              }
            }}
          >
            Slett verket
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// ---------- Opplasting ----------

function UploadZone({ workId }: { workId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fd = new FormData()
    fd.append('workId', workId)
    for (const f of files) fd.append('files', f)
    // Sidetelling skjer i nettleseren (gratis CPU) — Workers-gratisplanen
    // har ikke budsjett til full PDF-parsing per request.
    try {
      const { PDFDocument } = await import('pdf-lib')
      const counts: Record<string, number> = {}
      for (const f of files) {
        if (!/\.pdf$/i.test(f.name)) continue
        try {
          const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })
          counts[f.name] = doc.getPageCount()
        } catch {}
      }
      fd.append('pageCounts', JSON.stringify(counts))
    } catch {}
    setUploading(true)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = (await res.json()) as { uploaded?: Array<{ partId: string | null }>; error?: string }
      if (!res.ok || !json.uploaded) throw new Error(json.error ?? 'Opplastingen feilet')
      const unmatched = json.uploaded.filter((u) => !u.partId).length
      toast(
        json.uploaded.length === 0
          ? 'Ingen gyldige filer (PDF eller lyd)'
          : `${json.uploaded.length} ${json.uploaded.length === 1 ? 'fil' : 'filer'} lastet opp` +
              (unmatched > 0 ? ` — ${unmatched} trenger stemmevalg` : ', stemmer gjenkjent fra filnavn'),
        json.uploaded.length === 0 ? 'error' : 'ok',
      )
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section
      className={`rise relative rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-200 ${
        dragOver ? 'scale-[1.005] border-brass bg-[var(--brass-soft)]' : 'border-line-strong bg-paper-raised/60'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        upload(e.dataTransfer.files)
      }}
      style={{ animationDelay: '80ms' }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.mp3,.m4a,.wav,.ogg"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-2 py-1">
          <span className="spinner text-brass" style={{ width: '1.4em', height: '1.4em' }} />
          <p className="text-sm text-ink-soft">Laster opp og gjenkjenner stemmer …</p>
        </div>
      ) : (
        <>
          <p className="display-title text-lg font-semibold text-ink">
            Slipp notefiler her
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
            PDF per stemme eller lydfiler. Stemmen gjenkjennes automatisk fra filnavnet —
            «Gaelforce – 2nd Cornet.pdf» havner på 2. kornett.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
            … eller velg filer
          </Button>
        </>
      )}
    </section>
  )
}

// ---------- Filliste ----------

type WorkData = Awaited<ReturnType<typeof getWork>>

function FilesSection({ data }: { data: WorkData }) {
  const router = useRouter()
  const [rematching, setRematching] = useState(false)
  const sections = new Map<string, typeof data.files>()
  for (const f of data.files) {
    const key =
      f.kind === 'audio' ? 'audio' : f.kind === 'other' || !f.partSection ? 'other' : f.partSection
    const list = sections.get(key) ?? []
    list.push(f)
    sections.set(key, list)
  }

  const order = ['other', ...SECTION_ORDER, 'audio']
  const labels: Record<string, string> = { ...SECTION_LABELS, other: 'Uplassert — velg stemme', audio: 'Lyd' }

  if (data.files.length === 0) {
    return (
      <section className="sheet rise">
        <EmptyState title="Ingen filer ennå">
          {data.canManage
            ? 'Slipp PDF-ene i feltet over, så sorteres de på stemme automatisk.'
            : 'Arkivaren har ikke lastet opp noter for dette verket ennå.'}
        </EmptyState>
      </section>
    )
  }

  return (
    <section className="rise space-y-6" style={{ animationDelay: '140ms' }}>
      {order
        .filter((key) => sections.has(key))
        .map((key) => (
          <div key={key}>
            <div className="mb-2 flex items-baseline gap-3">
              <h2 className={`kicker ${key === 'other' ? '!text-oxblood' : ''}`}>{labels[key]}</h2>
              <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
              {key === 'other' && data.canManage && (
                <button
                  disabled={rematching}
                  onClick={async () => {
                    setRematching(true)
                    try {
                      const res = await rematchWorkFiles({ data: { workId: data.work.id } })
                      toast(
                        res.matched > 0
                          ? `${res.matched} av ${res.total} ${res.total === 1 ? 'fil' : 'filer'} plassert`
                          : 'Fant ingen treff — legg til alias under Innstillinger',
                        res.matched > 0 ? 'ok' : 'error',
                      )
                      router.invalidate()
                    } catch (err) {
                      toastError(err)
                    } finally {
                      setRematching(false)
                    }
                  }}
                  className="shrink-0 cursor-pointer font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong disabled:opacity-50"
                >
                  {rematching ? 'Gjenkjenner …' : 'Gjenkjenn på nytt'}
                </button>
              )}
            </div>
            <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
              {sections.get(key)!.map((f) => (
                <FileRow key={f.id} file={f} data={data} onChanged={() => router.invalidate()} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  )
}

function FileRow({
  file,
  data,
  onChanged,
}: {
  file: WorkData['files'][number]
  data: WorkData
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const name = file.kind === 'score' ? 'Partitur' : file.kind === 'audio' ? (file.label ?? 'Lydfil') : (file.partName ?? 'Uplassert')

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-x-4 sm:px-5">
      <span className="min-w-0 flex-1">
        <span className={`block text-[0.92rem] font-semibold ${file.kind === 'other' ? 'text-oxblood' : 'text-ink'}`}>
          {name}
        </span>
        <span className="block truncate font-mono text-[0.66rem] text-ink-faint">
          {file.fileName}
          {file.pageCount ? ` · ${file.pageCount} s.` : ''} · {formatBytes(file.fileSize)}
        </span>
      </span>

      <div className="flex w-full items-center justify-between gap-2 sm:contents">
        {data.canManage && file.kind !== 'audio' && (
          <select
            className="field-input min-w-0 flex-1 !py-2 !text-base sm:!w-auto sm:!flex-none sm:!py-1.5 sm:!text-xs"
            value={file.partId ?? ''}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true)
              try {
                await setWorkFilePart({ data: { fileId: file.id, partId: e.target.value || null } })
                toast('Stemme oppdatert')
                onChanged()
              } catch (err) {
                toastError(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            <option value="">Velg stemme …</option>
            {data.allParts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameNo}
              </option>
            ))}
          </select>
        )}

        <span className="flex shrink-0 items-center gap-1.5">
          <a
            href={`/api/files/${file.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Åpne
          </a>
          <a
            href={`/api/files/${file.id}?download=1`}
            download={file.fileName}
            className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            Last ned
          </a>
          {data.canManage && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await deleteWorkFile({ data: { fileId: file.id } })
                  toast('Filen er slettet')
                  onChanged()
                } catch (err) {
                  toastError(err)
                } finally {
                  setBusy(false)
                }
              }}
              className="ml-1 inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
            >
              Slett
            </button>
          )}
        </span>
      </div>
    </li>
  )
}

// ---------- Lyttelenker ----------

function LinksSection({ data }: { data: WorkData }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)

  return (
    <section className="rise" style={{ animationDelay: '200ms' }}>
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="kicker">Lytt</h2>
        <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
      </div>

      {data.links.length === 0 && !data.canManage ? (
        <p className="text-sm text-ink-faint">Ingen lyttelenker ennå.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.links.map((l) => (
            <li key={l.id} className="flex items-center gap-3">
              <Stamp tone={l.kind === 'youtube' ? 'oxblood' : 'neutral'}>{l.kind}</Stamp>
              <a href={l.url} target="_blank" rel="noreferrer" className="link-brass min-w-0 truncate text-sm">
                {l.label ?? l.url}
              </a>
              {data.canManage && (
                <button
                  onClick={async () => {
                    try {
                      await deleteWorkLink({ data: { linkId: l.id } })
                      router.invalidate()
                    } catch (err) {
                      toastError(err)
                    }
                  }}
                  className="-mx-2 -my-1.5 inline-flex items-center px-3 py-2.5 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-danger"
                >
                  fjern
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.canManage && (
        <form
          className="mt-4 flex max-w-xl flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!url.trim()) return
            setAdding(true)
            try {
              await addWorkLink({ data: { workId: data.work.id, url: url.trim(), label: label.trim() || undefined } })
              setUrl('')
              setLabel('')
              toast('Lenke lagt til')
              await router.invalidate()
            } catch (err) {
              toastError(err)
            } finally {
              setAdding(false)
            }
          }}
        >
          <Field label="Lenke (YouTube, Spotify …)" className="min-w-56 flex-1">
            <input className="field-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
          </Field>
          <Field label="Etikett" className="w-44">
            <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Black Dyke Band" />
          </Field>
          <Button type="submit" loading={adding} className="mb-px">
            Legg til
          </Button>
        </form>
      )}
    </section>
  )
}
