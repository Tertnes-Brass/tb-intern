import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PdfSplitterLauncher } from '../../../components/PdfSplitter'
import { WorkEditions } from '../../../components/WorkEditions'
import { WorkFormModal } from '../../../components/WorkForm'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../../components/ui'
import { ZipDownloadButton } from '../../../components/ZipDownload'
import { formatBytes, formatDate, formatDuration } from '../../../lib/format'
import { SECTION_LABELS, SECTION_ORDER } from '../../../lib/taxonomy'
import { ACCEPT_ATTR, MAX_UPLOAD_BYTES, uploadRejectionReason } from '../../../lib/upload'
import { uploadWorkFile } from '../../../lib/upload-client'
import { zipEntryName } from '../../../lib/zip'
import {
  addWorkLink,
  deleteWork,
  deleteWorkFile,
  deleteWorkFiles,
  deleteWorkLink,
  getWork,
  rematchWorkFiles,
  setWorkFilePart,
} from '../../../server/works'

export const Route = createFileRoute('/noter/arkiv/$workId')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canBrowseArchive =
      context.me.permissions.includes('*') ||
      context.me.permissions.includes('archive.viewAll') ||
      context.me.permissions.includes('works.manage')
    if (!canBrowseArchive) throw redirect({ to: '/noter' })
  },
  validateSearch: (search: Record<string, unknown>): { utgave?: string } => ({ utgave: typeof search.utgave === 'string' && search.utgave ? search.utgave : undefined }),
  loaderDeps: ({ search }) => ({ utgave: search.utgave }),
  loader: ({ params, deps }) => getWork({ data: { id: params.workId, editionId: deps.utgave === 'original' ? null : deps.utgave } }),
  component: WorkPage,
})

/** Stemmenavnet som brukes i ZIP-filnavnet — samme etikett som fillisten viser. */
function zipLabelFor(file: WorkData['files'][number]): string {
  if (file.kind === 'score') return 'Partitur'
  if (file.kind === 'audio') return file.label ?? 'Lydfil'
  return file.partName ?? 'Uplassert'
}

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

  // Hele verket som ett arkiv, i samme rekkefølge som fillisten under.
  // Partituret tas bare med når brukeren har scores.view — fil-gaten ville
  // ellers avvist det, og filen bare blitt hoppet over.
  const zipFiles = data.files
    .filter((f) => f.kind !== 'score' || data.canViewScore)
    .map((f, i) => ({
      fileId: f.id,
      name: zipEntryName([String(i + 1).padStart(2, '0'), w.title, zipLabelFor(f)], f.fileName),
    }))

  return (
    <div className="space-y-10">
      <header className="rise">
        <Link to="/noter/arkiv" className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong">
          ← Arkivet
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="display-title text-4xl font-semibold italic leading-tight text-ink sm:text-5xl">
              {w.title}
            </h1>
            {w.subtitle && (
              <p className="display-title mt-1 text-xl italic text-ink-soft sm:text-2xl">{w.subtitle}</p>
            )}
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
          {w.status === 'archived' && <Stamp tone="oxblood">Arkivert</Stamp>}
          {w.genre && <Stamp tone="brass">{w.genre}</Stamp>}
          {w.grade && <Stamp>Grad {w.grade}</Stamp>}
          {w.durationSec ? <Stamp>{formatDuration(w.durationSec)} min</Stamp> : null}
          {w.publisher && <Stamp>{w.publisher}</Stamp>}
          {w.acquiredYear && <Stamp>Anskaffet {w.acquiredYear}</Stamp>}
          {w.archiveNumber && <Stamp tone="brass">Arkivnummer {w.archiveNumber}</Stamp>}
          {w.physicalLocation && <Stamp tone="oxblood">{w.physicalLocation}</Stamp>}
          <Stamp tone={partFileCount >= totalParts ? 'brass' : partFileCount > 0 ? 'neutral' : 'oxblood'}>
            {partFileCount}/{totalParts} stemmer
          </Stamp>
        </div>

        <div className="mt-5">
          <ZipDownloadButton label="Last ned alle filer (ZIP)" zipName={w.title} files={zipFiles} />
        </div>

        {w.notes && (
          <p className="mt-4 max-w-2xl rounded-xl border border-line bg-paper-sunken/50 px-4 py-3 text-sm leading-relaxed text-ink-soft">
            <span className="kicker mr-2">NB</span>
            {w.notes}
          </p>
        )}
      </header>

      <WorkEditions key={w.id} data={data} onSelect={(editionId) => { void router.navigate({ to: '/noter/arkiv/$workId', params: { workId: w.id }, search: { utgave: editionId ?? 'original' } }) }} />

      {data.canManage && <UploadZone key={`upload:${w.id}:${data.editionId}`} workId={w.id} editionId={data.editionId} />}

      {data.canManage && <PdfSplitterLauncher key={`splitter:${w.id}:${data.editionId}`} editionId={data.editionId} work={w} allParts={data.allParts} files={data.files} />}

      <FilesSection key={`files:${w.id}:${data.editionId}`} data={data} />

      <LinksSection data={data} />

      {data.usedIn.length > 0 && (
        <section className="rise">
          <Kicker className="mb-3">Brukt i prosjekter</Kicker>
          <ul className="flex flex-wrap gap-2">
            {data.usedIn.map((p) => (
              <li key={p.id}>
                <Link to="/noter/prosjekter/$projectId" params={{ projectId: p.id }} className="link-quiet">
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
          Dette sletter verket, alle utgaver med tilhørende filer og koblingene til prosjekter.
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
                router.navigate({ to: '/noter/arkiv' })
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

type UploadJob = {
  id: number
  name: string
  size: number
  loaded: number
  status: 'venter' | 'laster' | 'ferdig' | 'feil'
  error?: string
}

function UploadZone({ workId, editionId }: { workId: string; editionId: string | null }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [uploading, setUploading] = useState(false)

  const upload = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (uploading || files.length === 0) return

    // Filer som uansett vil bli avvist merkes med begrunnelse med én gang, i
    // stedet for å bli forkastet i stillhet slik det skjedde før.
    const rejections = files.map((f) => uploadRejectionReason(f))
    setJobs(
      files.map((f, id) => ({
        id,
        name: f.name,
        size: f.size,
        loaded: 0,
        status: rejections[id] ? 'feil' : 'venter',
        error: rejections[id] ?? undefined,
      })),
    )
    setUploading(true)

    const update = (id: number, patch: Partial<UploadJob>) =>
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))

    // Én fil om gangen: hver fil sendes allerede som mange delkall, og
    // parallelle filer ville bare gjort framdriften uleselig.
    let ok = 0
    let unmatched = 0
    const errors: string[] = files.flatMap((f, i) => (rejections[i] ? [`${f.name}: ${rejections[i]}`] : []))

    for (const [id, file] of files.entries()) {
      if (rejections[id]) continue
      update(id, { status: 'laster' })
      try {
        const saved = await uploadWorkFile({
          workId,
          editionId,
          file,
          onProgress: (loaded) => update(id, { loaded }),
        })
        ok++
        if (!saved.partId) unmatched++
        update(id, { status: 'ferdig', loaded: file.size })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'opplastingen feilet'
        errors.push(`${file.name}: ${message}`)
        update(id, { status: 'feil', error: message })
      }
    }

    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
    // Behold bare det som gikk galt på skjermen — de vellykkede dukker opp i
    // fillisten under.
    setJobs((prev) => prev.filter((j) => j.status === 'feil'))

    if (ok > 0) {
      toast(
        `${ok} ${ok === 1 ? 'fil' : 'filer'} lastet opp` +
          (unmatched > 0 ? ` — ${unmatched} trenger stemmevalg` : ', stemmer gjenkjent fra filnavn') +
          (errors.length > 0 ? ` · ${errors.length} feilet` : ''),
        errors.length > 0 ? 'error' : 'ok',
      )
      await router.invalidate()
    } else {
      toast(
        errors.length === 1 ? errors[0]! : `Ingen av de ${files.length} filene ble lastet opp`,
        'error',
      )
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
        accept={ACCEPT_ATTR}
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
            «Gaelforce – 2nd Cornet.pdf» havner på 2. kornett. Maks{' '}
            {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB per fil.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
            … eller velg filer
          </Button>
        </>
      )}

      {jobs.length > 0 && (
        <ul className="mt-5 space-y-2 text-left">
          {jobs.map((j) => {
            const percent = j.size > 0 ? Math.round((j.loaded / j.size) * 100) : 0
            return (
              <li key={j.id} className="rounded-xl border border-line bg-paper-raised/70 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-ink">{j.name}</span>
                  <span
                    className={`shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.14em] ${
                      j.status === 'feil' ? 'text-danger' : 'text-ink-faint'
                    }`}
                  >
                    {j.status === 'feil'
                      ? 'Avvist'
                      : j.status === 'ferdig'
                        ? 'Ferdig'
                        : j.status === 'laster'
                          ? `${percent} %`
                          : 'Venter'}
                  </span>
                </div>
                {j.status === 'laster' && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-sunken">
                    <div
                      className="h-full bg-brass transition-[width] duration-200"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}
                {j.error && <p className="mt-1 text-xs leading-relaxed text-danger">{j.error}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------- Filliste ----------

type WorkData = Awaited<ReturnType<typeof getWork>>

function FilesSection({ data }: { data: WorkData }) {
  const router = useRouter()
  const [rematching, setRematching] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const query = fileQuery.trim().toLocaleLowerCase('nb-NO')
  const visibleFiles = data.files.filter((f) => [f.fileName, zipLabelFor(f)].some((value) => value.toLocaleLowerCase('nb-NO').includes(query)))
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selectedFiles = visibleFiles.filter((f) => selectedIds.includes(f.id))
  const closeSelection = () => { setSelecting(false); setSelectedIds([]) }
  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => data.files.some((f) => f.id === id)))
    setConfirmDelete(false)
  }, [data.files, data.work.id])
  const sections = new Map<string, typeof data.files>()
  for (const f of visibleFiles) {
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
      <div className="sheet space-y-3 p-4">
        <Field label="Filtrer filer" hint="Søk i filnavn og stemmenavn i denne utgaven.">
          <input type="search" className="field-input" value={fileQuery} placeholder="For eksempel Conselho 3 …" disabled={deleting} onChange={(e) => {
            setFileQuery(e.target.value)
            setSelectedIds([])
            setConfirmDelete(false)
          }} />
        </Field>
        <p className="text-sm text-ink-soft" role="status">Viser {visibleFiles.length} av {data.files.length} filer</p>
        {fileQuery && <Button size="sm" variant="ghost" disabled={deleting} onClick={() => { setFileQuery(''); setSelectedIds([]); setConfirmDelete(false) }}>Nullstill filter</Button>}
      </div>
      {data.canManage && (
        <div className="sheet flex flex-wrap items-center gap-3 p-4">
          <Button onClick={() => selecting ? closeSelection() : setSelecting(true)} disabled={deleting}>
            {selecting ? 'Avslutt valg' : 'Velg flere filer'}
          </Button>
          {selecting && <>
            <Button size="sm" onClick={() => setSelectedIds(visibleFiles.filter((f) => f.kind === 'part' || f.kind === 'score').slice(0, 100).map((f) => f.id))}>Velg alle notefiler</Button>
            <Button size="sm" disabled={visibleFiles.length === 0} onClick={() => setSelectedIds(visibleFiles.slice(0, 100).map((f) => f.id))}>{visibleFiles.length > 100 ? 'Velg de første 100 viste' : 'Velg alle viste'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Fjern valg</Button>
            <span className="text-sm text-ink-soft" role="status">{selectedFiles.length} filer valgt</span>
            <Button variant="danger" disabled={selectedFiles.length === 0} onClick={() => setConfirmDelete(true)}>Slett valgte ({selectedFiles.length})</Button>
            <p className="w-full text-xs text-ink-soft">Velg opptil 100 filer blant treffene. «Velg alle viste» tar med alle filtyper. Valget tømmes når filteret endres.</p>
          </>}
        </div>
      )}
      <Modal open={confirmDelete} onClose={() => { if (!deleting) setConfirmDelete(false) }} title={`Slette ${selectedFiles.length} filer?`} kicker={data.work.title}>
        <p className="mb-3 text-sm text-ink-soft">De valgte filene slettes permanent. Stykket og prosjektkoblingene beholdes. Handlingen kan ikke angres.</p>
        <ul className="mb-5 max-h-60 space-y-2 overflow-y-auto text-sm">
          {selectedFiles.map((f) => <li key={f.id}><span className="font-semibold">{zipLabelFor(f)}</span><span className="block break-all text-xs text-ink-soft">{f.fileName}</span></li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button variant="danger" loading={deleting} disabled={selectedFiles.length === 0} onClick={async () => {
            setDeleting(true)
            try {
              const result = await deleteWorkFiles({ data: { workId: data.work.id, fileIds: selectedFiles.map((f) => f.id) } })
              setConfirmDelete(false)
              closeSelection()
              toast(`${result.deleted} filer er slettet`)
              await router.invalidate()
            } catch (err) { toastError(err) }
            finally { setDeleting(false) }
          }}>Slett {selectedFiles.length} filer</Button>
        </div>
      </Modal>
      {visibleFiles.length === 0 && <div className="sheet"><EmptyState title="Ingen filer matcher filteret">Prøv et annet filnavn eller stemmenavn.</EmptyState></div>}
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
                      const res = await rematchWorkFiles({ data: { workId: data.work.id, editionId: data.editionId } })
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
                <FileRow key={f.id} file={f} data={data} onChanged={() => router.invalidate()}
                  selecting={data.canManage && selecting} selected={selectedIds.includes(f.id)}
                  selectionDisabled={deleting || (!selectedIds.includes(f.id) && selectedFiles.length >= 100)}
                  onSelect={(checked) => setSelectedIds((ids) => checked ? [...ids, f.id] : ids.filter((id) => id !== f.id))} />
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
  selecting,
  selected,
  selectionDisabled,
  onSelect,
}: {
  file: WorkData['files'][number]
  data: WorkData
  onChanged: () => void
  selecting: boolean
  selected: boolean
  selectionDisabled: boolean
  onSelect: (checked: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const name = file.kind === 'score' ? 'Partitur' : file.kind === 'audio' ? (file.label ?? 'Lydfil') : (file.partName ?? 'Uplassert')

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-x-4 sm:px-5">
      {selecting && <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm sm:shrink-0">
        <input type="checkbox" className="h-5 w-5 accent-brass" checked={selected} disabled={selectionDisabled}
          aria-label={`Velg ${name}: ${file.fileName}`} onChange={(e) => onSelect(e.target.checked)} />
        <span className="sm:hidden">Velg fil</span>
      </label>}
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
          {data.canManage && !selecting && (
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
