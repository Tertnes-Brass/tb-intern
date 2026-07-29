import { useRouter } from '@tanstack/react-router'
import type { PDFDocument } from 'pdf-lib'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildSplitPlan,
  countPages,
  formatPageRanges,
  pageIndices,
  parsePageRanges,
  type ParsedPageRanges,
} from '../lib/pdf-ranges'
import { SECTION_LABELS, SECTION_ORDER, splitPartFileName } from '../lib/taxonomy'
import { isPdfFilename } from '../lib/upload'
import { uploadWorkFile } from '../lib/upload-client'
import { toast, toastError } from './toast'
import { Button, Field, Kicker, Modal, Stamp } from './ui'

/**
 * PDF-splitter (sak #17): deler én samle-PDF opp i én stemmefil per stemme.
 *
 * Alt arbeidet skjer i nettleseren — pdf-lib kopierer sidene, og resultatet
 * lastes opp gjennom den vanlige multipart-flyten, med stemmen satt eksplisitt.
 * Filene som kommer ut er dermed helt vanlige `work_files`, og tilgangsstyringen
 * i `/api/files/$fileId` gjelder uendret.
 *
 * Sideutvalget vises i nettleserens EGEN PDF-leser (blob-URL i en iframe, navigert
 * med `#page=N`). Sideminiatyrer ville krevd en PDF-renderer (`pdfjs-dist`);
 * pdf-lib kan kopiere sider, men ikke tegne dem.
 */

/** Stemmene i besetningen, slik `getWork` gir dem (sortert på sortOrder). */
type SplitterPart = { id: string; nameNo: string; section: string; aliases: string }

/** En fil som alt ligger på verket, og som kan brukes som kilde. */
type SplitterFile = { id: string; fileName: string; kind: string }

type SplitterProps = {
  work: { id: string; title: string }
  allParts: SplitterPart[]
  files: SplitterFile[]
}

/** Kilde-PDF-en, lest og klar. `url` er blob-URL-en forhåndsvisningen bruker. */
type Source = { name: string; url: string; pageCount: number }

/** Én rad i skjemaet: en stemme og et sideuttrykk. */
type Row = { key: number; partId: string; expr: string }

type JobStatus = 'venter' | 'bygger' | 'laster' | 'ferdig' | 'feil'

type Job = {
  partId: string
  partName: string
  fileName: string
  pages: number
  size: number
  loaded: number
  status: JobStatus
  error?: string
}

let nextRowKey = 1

function pagesLabel(n: number): string {
  return `${n} ${n === 1 ? 'side' : 'sider'}`
}

/** Inngangen på verkssiden: én knapp, og modalen under. */
export function PdfSplitterLauncher(props: SplitterProps) {
  const [open, setOpen] = useState(false)

  return (
    <section
      className="rise flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper-raised/60 px-5 py-4"
      style={{ animationDelay: '110ms' }}
    >
      <p className="max-w-xl text-sm text-ink-soft">
        <span className="kicker mr-2">Splitter</span>
        Ligger hele settet i én samle-PDF? Marker sidene per stemme, så lagres de som
        vanlige stemmefiler.
      </p>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Del opp PDF …
      </Button>
      {/* Monteres bare når den er åpen, så all tilstand nullstilles mellom hver runde. */}
      {open && <PdfSplitterModal {...props} onClose={() => setOpen(false)} />}
    </section>
  )
}

function PdfSplitterModal({ work, allParts, files, onClose }: SplitterProps & { onClose: () => void }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Kildedokumentet holdes utenfor state: det er stort, og skal aldri utløse
  // en ny render. pdf-lib kopierer sider ut av det samme dokumentet flere ganger.
  const docRef = useRef<PDFDocument | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [reading, setReading] = useState(false)
  const [existingId, setExistingId] = useState('')
  const [rows, setRows] = useState<Row[]>([{ key: 0, partId: '', expr: '' }])
  const [previewPage, setPreviewPage] = useState(1)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [running, setRunning] = useState(false)

  // Blob-URL-en frigis når kilden byttes og når modalen lukkes.
  useEffect(() => {
    if (!source) return
    return () => URL.revokeObjectURL(source.url)
  }, [source])

  const partById = useMemo(() => new Map(allParts.map((p) => [p.id, p])), [allParts])
  const partName = (id: string) => partById.get(id)?.nameNo ?? id

  // Stemmevalget grupperes på seksjon, i besetningens rekkefølge. Ukjente
  // seksjoner (egendefinerte stemmer) havner til slutt i stedet for å falle ut.
  const bySection = useMemo(() => {
    const map = new Map<string, SplitterPart[]>()
    for (const p of allParts) map.set(p.section, [...(map.get(p.section) ?? []), p])
    return map
  }, [allParts])
  const sectionKeys = useMemo(() => {
    const known: string[] = SECTION_ORDER.filter((s) => bySection.has(s))
    return [...known, ...[...bySection.keys()].filter((s) => !known.includes(s))]
  }, [bySection])

  const pdfCandidates = files.filter((f) => f.kind !== 'audio' && isPdfFilename(f.fileName))

  const parsedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        parsed: source ? parsePageRanges(row.expr, source.pageCount) : null,
      })),
    [rows, source],
  )

  const plan = useMemo(() => {
    if (!source) return null
    return buildSplitPlan(
      parsedRows.flatMap((r) => {
        if (!r.partId || !r.parsed || !r.parsed.ok) return []
        return [{ partId: r.partId, ranges: r.parsed.ranges }]
      }),
      source.pageCount,
    )
  }, [parsedRows, source])

  const hasRowError = parsedRows.some((r) => r.parsed && !r.parsed.ok)
  const missingPart = parsedRows.some((r) => !r.partId && r.expr.trim() !== '')
  const finished = jobs != null && !running
  const canRun = !!plan && plan.parts.length > 0 && !hasRowError && !missingPart && !running

  const setRow = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const jumpToFirstPage = (parsed: ParsedPageRanges | null) => {
    if (parsed?.ok && parsed.ranges.length > 0) setPreviewPage(parsed.ranges[0].from)
  }

  /** Leser bytene, teller sidene med pdf-lib og setter opp forhåndsvisningen. */
  const openSource = async (name: string, bytes: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    try {
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      if (doc.getPageCount() < 1) throw new Error('PDF-en har ingen sider')
      docRef.current = doc
      setSource({ name, url, pageCount: doc.getPageCount() })
      setPreviewPage(1)
      setJobs(null)
    } catch {
      URL.revokeObjectURL(url)
      docRef.current = null
      toast('Klarte ikke lese PDF-en — den kan være kryptert eller ødelagt', 'error')
    }
  }

  const readLocal = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    if (!isPdfFilename(file.name)) {
      toast('Splitteren tar bare PDF', 'error')
      return
    }
    setReading(true)
    try {
      await openSource(file.name, await file.arrayBuffer())
    } finally {
      setReading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const readExisting = async () => {
    const chosen = pdfCandidates.find((f) => f.id === existingId)
    if (!chosen) return
    setReading(true)
    try {
      // Hentes gjennom den vanlige fil-gaten, så tilgangskontrollen er den samme
      // som ellers — splitteren har ingen egen vei inn til bytene.
      const res = await fetch(`/api/files/${chosen.id}`)
      if (!res.ok) throw new Error('Klarte ikke hente filen fra arkivet')
      await openSource(chosen.fileName, await res.arrayBuffer())
    } catch (err) {
      toastError(err)
    } finally {
      setReading(false)
    }
  }

  /** Bygger én PDF per stemme og laster dem opp, én om gangen. */
  const run = async () => {
    const doc = docRef.current
    if (!doc || !plan || plan.parts.length === 0) return
    const { PDFDocument } = await import('pdf-lib')

    const planned: Job[] = plan.parts.map((part) => {
      const def = partById.get(part.partId)
      return {
        partId: part.partId,
        partName: def?.nameNo ?? part.partId,
        // Filnavnet velges slik at navnegjenkjenningen ville landet på samme
        // stemme som arkivaren valgte — se splitPartFileName.
        fileName: def ? splitPartFileName(work.title, def, allParts) : `${part.partId}.pdf`,
        pages: part.pageCount,
        size: 0,
        loaded: 0,
        status: 'venter',
      }
    })
    setJobs(planned)
    setRunning(true)

    const update = (i: number, patch: Partial<Job>) =>
      setJobs((prev) => prev?.map((j, n) => (n === i ? { ...j, ...patch } : j)) ?? prev)

    // Én stemme om gangen: hver fil sendes allerede som flere delkall, og
    // parallelle opplastinger ville bare gjort framdriften uleselig.
    let ok = 0
    const errors: string[] = []
    for (const [i, part] of plan.parts.entries()) {
      const job = planned[i]
      update(i, { status: 'bygger' })
      try {
        const out = await PDFDocument.create()
        for (const page of await out.copyPages(doc, pageIndices(part.ranges))) out.addPage(page)
        // pdf-lib skriver alltid til en vanlig ArrayBuffer; typen er bare bredere
        // (SharedArrayBuffer) enn det BlobPart godtar.
        const bytes = (await out.save()) as Uint8Array<ArrayBuffer>
        const file = new File([bytes], job.fileName, { type: 'application/pdf' })
        update(i, { status: 'laster', size: file.size })
        await uploadWorkFile({
          workId: work.id,
          file,
          partId: part.partId,
          onProgress: (loaded) => update(i, { loaded }),
        })
        update(i, { status: 'ferdig', loaded: file.size })
        ok++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'splittingen feilet'
        errors.push(`${job.partName}: ${message}`)
        update(i, { status: 'feil', error: message })
      }
    }

    setRunning(false)
    if (ok > 0) {
      toast(
        `${ok} ${ok === 1 ? 'stemme' : 'stemmer'} lagret` +
          (errors.length > 0 ? ` · ${errors.length} feilet` : ''),
        errors.length > 0 ? 'error' : 'ok',
      )
      await router.invalidate()
    } else {
      toast(errors[0] ?? 'Ingen stemmer ble lagret', 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title="Del opp samle-PDF" kicker={work.title} wide mobileFull>
      <div className="space-y-5">
        <section>
          <Kicker className="mb-2">1 · Kilde-PDF</Kicker>
          {source ? (
            <div className="flex flex-wrap items-center gap-2">
              <Stamp tone="brass">{pagesLabel(source.pageCount)}</Stamp>
              <span className="min-w-0 flex-1 truncate font-mono text-[0.68rem] text-ink-faint">
                {source.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={running}
                onClick={() => {
                  docRef.current = null
                  setSource(null)
                  setJobs(null)
                }}
              >
                Bytt PDF
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                variant="secondary"
                size="sm"
                loading={reading}
                onClick={() => fileInputRef.current?.click()}
              >
                Velg PDF fra maskinen …
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => readLocal(e.target.files)}
              />
              {pdfCandidates.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="… eller en PDF som alt ligger på verket" className="min-w-56 flex-1">
                    <select
                      className="field-input"
                      value={existingId}
                      onChange={(e) => setExistingId(e.target.value)}
                    >
                      <option value="">Velg fil …</option>
                      {pdfCandidates.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.fileName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mb-px"
                    disabled={!existingId}
                    loading={reading}
                    onClick={readExisting}
                  >
                    Hent
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {source && (
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <Kicker>2 · Forhåndsvisning</Kicker>
              <span className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  className="cursor-pointer font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong"
                >
                  ← forrige
                </button>
                <span className="tabular font-mono text-[0.66rem] text-ink-faint">
                  side {previewPage} av {source.pageCount}
                </span>
                <button
                  onClick={() => setPreviewPage((p) => Math.min(source.pageCount, p + 1))}
                  className="cursor-pointer font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong"
                >
                  neste →
                </button>
              </span>
            </div>
            {/* `key` tvinger iframen til å lastes på nytt: bare å endre #page= på
                en URL nettleseren alt viser flytter ikke alltid visningen. */}
            <iframe
              key={previewPage}
              src={`${source.url}#page=${previewPage}`}
              title="Forhåndsvisning av kilde-PDF"
              className="h-[46vh] min-h-52 w-full rounded-xl border border-line bg-paper-sunken"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Vises i nettleserens egen PDF-leser.{' '}
              <a className="link-brass" href={source.url} target="_blank" rel="noreferrer">
                Åpne i egen fane
              </a>{' '}
              om den ikke lar seg bla i her.
            </p>
          </section>
        )}

        {source && (
          <section>
            <Kicker className="mb-2">3 · Stemmer og sider</Kicker>
            <ul className="space-y-2">
              {parsedRows.map((r) => (
                <li key={r.key} className="rounded-xl border border-line bg-paper-raised/70 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="field-input min-w-40 flex-1 !py-1.5 !text-xs sm:!w-52 sm:!flex-none"
                      value={r.partId}
                      disabled={running}
                      onChange={(e) => setRow(r.key, { partId: e.target.value })}
                    >
                      <option value="">Velg stemme …</option>
                      {sectionKeys.map((s) => (
                        <optgroup
                          key={s}
                          label={SECTION_LABELS[s as keyof typeof SECTION_LABELS] ?? s}
                        >
                          {bySection.get(s)?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nameNo}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      className="field-input min-w-32 flex-1 !py-1.5 !text-xs"
                      value={r.expr}
                      disabled={running}
                      placeholder="1-3, 7, 9-11"
                      autoComplete="off"
                      onChange={(e) => setRow(r.key, { expr: e.target.value })}
                    />
                    <button
                      onClick={() => jumpToFirstPage(r.parsed)}
                      className="cursor-pointer px-1 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong"
                    >
                      vis
                    </button>
                    <button
                      disabled={running || rows.length === 1}
                      onClick={() => setRows((prev) => prev.filter((row) => row.key !== r.key))}
                      className="cursor-pointer px-1 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-danger disabled:opacity-40"
                    >
                      fjern
                    </button>
                  </div>
                  {r.parsed && !r.parsed.ok ? (
                    <p className="mt-1.5 text-xs text-danger">{r.parsed.error}</p>
                  ) : r.parsed?.ok && r.parsed.ranges.length > 0 ? (
                    <p className="mt-1.5 text-xs text-ink-faint">
                      {formatPageRanges(r.parsed.ranges)} · {pagesLabel(countPages(r.parsed.ranges))}
                      {!r.partId && <span className="text-oxblood"> · velg stemme</span>}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={running}
              onClick={() => setRows((prev) => [...prev, { key: nextRowKey++, partId: '', expr: '' }])}
            >
              + Legg til stemme
            </Button>
          </section>
        )}

        {plan && source && (
          <section className="space-y-1.5 rounded-xl border border-line bg-paper-sunken/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>4 · Dette blir lagret</Kicker>
              <Stamp tone={plan.parts.length > 0 ? 'brass' : 'neutral'}>
                {plan.parts.length} {plan.parts.length === 1 ? 'fil' : 'filer'}
              </Stamp>
              <Stamp>
                {plan.assignedPageCount} av {source.pageCount} sider brukt
              </Stamp>
            </div>
            {plan.overlaps.length > 0 && (
              <p className="text-xs leading-relaxed text-oxblood">
                Overlapp:{' '}
                {plan.overlaps
                  .map(
                    (o) =>
                      `${partName(o.partA)} og ${partName(o.partB)} deler side ${formatPageRanges(
                        o.pages.map((page) => ({ from: page, to: page })),
                      )}`,
                  )
                  .join(' · ')}
                . Sidene havner i begge filene.
              </p>
            )}
            {plan.unassigned.length > 0 && (
              <p className="text-xs leading-relaxed text-ink-faint">
                Ingen stemme på side {formatPageRanges(plan.unassigned)} — de blir ikke med.
              </p>
            )}
          </section>
        )}

        {jobs && (
          <section>
            <Kicker className="mb-2">Framdrift</Kicker>
            <ul className="space-y-2">
              {jobs.map((j) => {
                const percent = j.size > 0 ? Math.round((j.loaded / j.size) * 100) : 0
                return (
                  <li
                    key={j.partId}
                    className="rounded-xl border border-line bg-paper-raised/70 px-3.5 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-ink">
                        {j.partName}{' '}
                        <span className="text-ink-faint">· {pagesLabel(j.pages)}</span>
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.14em] ${
                          j.status === 'feil' ? 'text-danger' : 'text-ink-faint'
                        }`}
                      >
                        {j.status === 'feil'
                          ? 'Feilet'
                          : j.status === 'ferdig'
                            ? 'Ferdig'
                            : j.status === 'laster'
                              ? `${percent} %`
                              : j.status === 'bygger'
                                ? 'Bygger'
                                : 'Venter'}
                      </span>
                    </div>
                    <span className="block truncate font-mono text-[0.62rem] text-ink-faint">
                      {j.fileName}
                    </span>
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
          </section>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={running} className="w-full sm:w-auto">
            {finished ? 'Lukk' : 'Avbryt'}
          </Button>
          {/* Etter en runde er knappen «Ferdig» — en ny splitt av samme utvalg
              ville bare lagd duplikater. Ny runde: lukk og åpne på nytt. */}
          <Button
            variant="primary"
            loading={running}
            disabled={!finished && !canRun}
            onClick={finished ? onClose : run}
            className="w-full sm:w-auto"
          >
            {finished
              ? 'Ferdig'
              : plan && plan.parts.length > 0
                ? `Splitt og lagre ${plan.parts.length} ${plan.parts.length === 1 ? 'fil' : 'filer'}`
                : 'Splitt og lagre'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
