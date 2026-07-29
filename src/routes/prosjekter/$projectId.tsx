import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ProjectFormModal } from '../../components/ProjectForm'
import { RepertoireList } from '../../components/Repertoire'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { ZipDownloadButton } from '../../components/ZipDownload'
import { formatDate, formatDuration, formatWeekday, relativeDays } from '../../lib/format'
import { zipEntryName } from '../../lib/zip'
import {
  addWorkToProject,
  deleteProject,
  getProject,
  moveWorkInProject,
  removeWorkFromProject,
  searchWorksForPicker,
  updateProject,
} from '../../server/projects'
import { createShare, listShares, revokeShare } from '../../server/shares'

export const Route = createFileRoute('/prosjekter/$projectId')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getProject({ data: { id: params.projectId } }),
  errorComponent: ({ error }) => (
    <EmptyState title="Kunne ikke åpne prosjektet">{error.message}</EmptyState>
  ),
  component: ProjectPage,
})

function ProjectPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const p = data.project
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const totalDuration = data.repertoire.reduce((acc, r) => acc + (r.durationSec ?? 0), 0)

  // Egne stemmer for hele prosjektet, i programrekkefølge:
  // «01 - Where Eagles Sing - 2. kornett.pdf». Serveren har allerede filtrert
  // myFiles på det medlemmet faktisk har tilgang til.
  const myProjectFiles = data.repertoire.flatMap((r, i) =>
    r.myFiles.map((f) => ({
      fileId: f.id,
      name: zipEntryName([String(i + 1).padStart(2, '0'), r.title, f.partName], f.fileName),
    })),
  )

  const togglePublish = async () => {
    setPublishing(true)
    try {
      await updateProject({ data: { id: p.id, isPublished: !p.isPublished } })
      toast(p.isPublished ? 'Prosjektet er avpublisert' : 'Publisert! Medlemmene ser det nå')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="space-y-10">
      <header className="rise">
        <Link
          to="/prosjekter"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Prosjekter
        </Link>

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>
                {p.kind === 'konsert' ? 'Konsert' : p.kind === 'konkurranse' ? 'Konkurranse' : p.kind}
                {p.eventDate ? ` · ${relativeDays(p.eventDate)}` : ''}
              </Kicker>
              {!p.isPublished && <Stamp tone="oxblood">Utkast — kun synlig for stab</Stamp>}
            </div>
            <h1 className="display-title mt-2 break-words [hyphens:auto] text-[clamp(2.4rem,6vw,4rem)] font-semibold italic leading-[1] text-ink">
              {p.name}
            </h1>
            {p.description && (
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">{p.description}</p>
            )}
            <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
              {p.eventDate ? `${formatWeekday(p.eventDate)} ${formatDate(p.eventDate)}` : 'Dato ikke satt'}
              {p.venue ? ` · ${p.venue}` : ''}
              {totalDuration > 0 ? ` · ca. ${Math.round(totalDuration / 60)} min musikk` : ''}
            </p>
          </div>

          {data.canManage && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant={p.isPublished ? 'secondary' : 'primary'} onClick={togglePublish} loading={publishing}>
                {p.isPublished ? 'Avpubliser' : 'Publiser'}
              </Button>
              <Button onClick={() => setEditing(true)}>Rediger</Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Slett
              </Button>
            </div>
          )}
        </div>

        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      <section className="rise" style={{ animationDelay: '100ms' }}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="kicker">Program</h2>
          <div className="flex flex-wrap items-start gap-2">
            <ZipDownloadButton
              label="Last ned mine stemmer (ZIP)"
              zipName={`${p.name} — mine stemmer`}
              files={myProjectFiles}
            />
            {data.canManage && (
              <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
                + Legg til verk
              </Button>
            )}
          </div>
        </div>

        {data.repertoire.length === 0 ? (
          <div className="sheet mt-3">
            <EmptyState
              title="Programmet er tomt"
              action={
                data.canManage ? (
                  <Button variant="primary" onClick={() => setPickerOpen(true)}>
                    Legg til første verk
                  </Button>
                ) : undefined
              }
            >
              {data.canManage
                ? 'Hent verk fra arkivet og sett dem i rekkefølge.'
                : 'Repertoaret er ikke satt opp ennå.'}
            </EmptyState>
          </div>
        ) : (
          <RepertoireList
            items={data.repertoire}
            manage={
              data.canManage
                ? (item, i) => (
                    <ManageRowButtons
                      projectId={p.id}
                      workId={item.workId}
                      isFirst={i === 0}
                      isLast={i === data.repertoire.length - 1}
                    />
                  )
                : undefined
            }
          />
        )}
      </section>

      {data.canShare && <SharesSection projectId={p.id} myParts={data.myParts} repertoire={data.repertoire} />}

      <ProjectFormModal
        open={editing}
        onClose={() => setEditing(false)}
        project={p}
        onSaved={async () => {
          setEditing(false)
          await router.invalidate()
        }}
      />

      <WorkPicker projectId={p.id} open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette prosjektet?" kicker={p.name}>
        <p className="mb-5 text-sm leading-relaxed text-ink-soft">
          Prosjektet og vikarlenkene fjernes. Verkene blir liggende trygt i arkivet.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await deleteProject({ data: { id: p.id } })
                toast('Prosjektet er slettet')
                router.navigate({ to: '/prosjekter' })
              } catch (err) {
                toastError(err)
              }
            }}
          >
            Slett prosjektet
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// ---------- Rekkefølge/fjern-knapper ----------

function ManageRowButtons({
  projectId,
  workId,
  isFirst,
  isLast,
}: {
  projectId: string
  workId: string
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'grid h-9 w-9 sm:h-8 sm:w-8 cursor-pointer place-items-center rounded-md text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-30 disabled:pointer-events-none'

  return (
    <>
      <button
        className={btn}
        disabled={busy || isFirst}
        aria-label="Flytt opp"
        onClick={() => act(() => moveWorkInProject({ data: { projectId, workId, direction: 'up' } }))}
      >
        <Arrow dir="up" />
      </button>
      <button
        className={btn}
        disabled={busy || isLast}
        aria-label="Flytt ned"
        onClick={() => act(() => moveWorkInProject({ data: { projectId, workId, direction: 'down' } }))}
      >
        <Arrow dir="down" />
      </button>
      <button
        className={`${btn} ml-1 hover:!bg-danger/10 hover:!text-danger`}
        disabled={busy}
        aria-label="Fjern fra programmet"
        onClick={() => act(() => removeWorkFromProject({ data: { projectId, workId } }))}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </>
  )
}

function Arrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}>
      <path d="M5.5 9.5v-8M2 5l3.5-3.5L9 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---------- Verk-velger ----------

function WorkPicker({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; title: string; composer: string | null; durationSec: number | null }>>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await searchWorksForPicker({ data: { q: q || undefined, excludeProjectId: projectId } })
        if (!cancelled) setResults(res.works)
      } catch (err) {
        if (!cancelled) toastError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, open, projectId])

  return (
    <Modal open={open} onClose={onClose} title="Legg til verk" kicker="Fra arkivet">
      <input
        type="search"
        className="field-input mb-3"
        placeholder="Søk i arkivet …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
      />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {loading && results.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">Søker …</p>
        ) : results.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">
            {q ? `Ingen treff på «${q}»` : 'Alt i arkivet er allerede i programmet'}
          </p>
        ) : (
          results.map((w) => (
            <button
              key={w.id}
              disabled={addingId !== null}
              onClick={async () => {
                setAddingId(w.id)
                try {
                  await addWorkToProject({ data: { projectId, workId: w.id } })
                  toast(`«${w.title}» lagt til i programmet`)
                  await router.invalidate()
                  setResults((r) => r.filter((x) => x.id !== w.id))
                } catch (err) {
                  toastError(err)
                } finally {
                  setAddingId(null)
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-paper-sunken disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="display-title block truncate text-[1rem] font-semibold">{w.title}</span>
                <span className="block text-xs text-ink-soft">{w.composer ?? '—'}</span>
              </span>
              {addingId === w.id ? (
                <span className="spinner text-brass" />
              ) : (
                <span className="font-mono text-[0.64rem] text-ink-faint">{formatDuration(w.durationSec)}</span>
              )}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

// ---------- Vikardeling ----------

type ShareRow = Awaited<ReturnType<typeof listShares>>['shares'][number]

function SharesSection({
  projectId,
  myParts,
  repertoire,
}: {
  projectId: string
  myParts: Array<{ id: string; nameNo: string }>
  repertoire: Array<{ partFiles: Array<{ partId: string | null; partName: string | null; partSort: number }> }>
}) {
  const [shares, setShares] = useState<ShareRow[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = async () => {
    try {
      const res = await listShares({ data: { projectId } })
      setShares(res.shares)
    } catch (err) {
      toastError(err)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Stemmer som finnes i programmet (til velgeren)
  const partOptions = new Map<string, { id: string; name: string; sort: number }>()
  for (const r of repertoire) {
    for (const f of r.partFiles) {
      if (f.partId && f.partName) partOptions.set(f.partId, { id: f.partId, name: f.partName, sort: f.partSort })
    }
  }
  const sortedPartOptions = [...partOptions.values()].sort((a, b) => a.sort - b.sort)

  const now = Date.now()

  return (
    <section className="rise" style={{ animationDelay: '160ms' }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="kicker">Vikarlenker</h2>
        <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)} disabled={sortedPartOptions.length === 0}>
          + Del med vikar
        </Button>
      </div>

      {shares === null ? (
        <p className="py-3 text-sm text-ink-faint">Laster …</p>
      ) : shares.length === 0 ? (
        <p className="py-2 text-sm text-ink-soft">
          Ingen delinger ennå. En vikarlenke gir tilgang til valgte stemmer for akkurat dette prosjektet —
          uten innlogging, og den slutter å virke automatisk.
        </p>
      ) : (
        <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
          {shares.map((s) => {
            const dead = !!s.revokedAt || s.expiresAt < now
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 sm:px-5">
                <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <span className={`block text-[0.92rem] font-semibold ${dead ? 'text-ink-faint line-through' : 'text-ink'}`}>
                    {s.recipientName}
                  </span>
                  <span className="block font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
                    {s.partNames.join(' · ')}
                  </span>
                </span>
                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                  <span className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
                    {s.revokedAt
                      ? 'Trukket tilbake'
                      : s.expiresAt < now
                        ? 'Utløpt'
                        : `Utløper ${new Date(s.expiresAt).toLocaleDateString('nb-NO')}`}
                    {s.lastUsedAt ? ` · sist åpnet ${new Date(s.lastUsedAt).toLocaleDateString('nb-NO')}` : ' · ikke åpnet'}
                  </span>
                  {!dead && (
                    <button
                      onClick={async () => {
                        try {
                          await revokeShare({ data: { shareId: s.id } })
                          toast('Lenken er trukket tilbake')
                          refresh()
                        } catch (err) {
                          toastError(err)
                        }
                      }}
                      className="-mx-2 -my-1.5 inline-flex shrink-0 items-center px-3 py-2.5 font-mono text-[0.64rem] uppercase tracking-wide text-danger/80 transition-colors hover:text-danger"
                    >
                      Trekk tilbake
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CreateShareModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        partOptions={sortedPartOptions}
        defaultPartIds={myParts.map((p) => p.id)}
        onCreated={refresh}
      />
    </section>
  )
}

function CreateShareModal({
  open,
  onClose,
  projectId,
  partOptions,
  defaultPartIds,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  partOptions: Array<{ id: string; name: string }>
  defaultPartIds: string[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [days, setDays] = useState('30')
  const [saving, setSaving] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setSelected(new Set(defaultPartIds.filter((id) => partOptions.some((p) => p.id === id))))
    setDays('30')
    setResultUrl(null)
    setCopied(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    if (!name.trim() || selected.size === 0) {
      toast('Navn og minst én stemme må velges', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await createShare({
        data: { projectId, recipientName: name.trim(), partIds: [...selected], days: Number(days) },
      })
      setResultUrl(`${window.location.origin}/v/${res.token}`)
      onCreated()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={resultUrl ? 'Lenken er klar' : 'Del med vikar'} kicker="Vikartilgang">
      {resultUrl ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Send lenken til <strong className="text-ink">{name}</strong> på SMS eller Messenger.
            Av sikkerhetsgrunner vises den <em>kun nå</em> — vi lagrer bare et fingeravtrykk av den.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-xs text-ink-soft">
              {resultUrl}
            </code>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resultUrl)
                  setCopied(true)
                  toast('Kopiert til utklippstavlen')
                } catch {
                  toast('Kunne ikke kopiere — merk teksten manuelt', 'error')
                }
              }}
            >
              {copied ? 'Kopiert ✓' : 'Kopier'}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Lukk
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Vikarens navn *">
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ola Nordmann" autoFocus />
          </Field>
          <Field label="Stemmer *" hint="Vikaren ser kun disse stemmene — pluss eventuelle lydfiler">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {partOptions.map((p) => {
                const active = selected.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={active}
                    className={`cursor-pointer rounded-[7px] border px-2.5 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] transition-all ${
                      active
                        ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                        : 'border-line-strong text-ink-faint hover:border-brass/50 hover:text-ink-soft'
                    }`}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Gyldig i">
            <select className="field-input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">7 dager</option>
              <option value="14">14 dager</option>
              <option value="30">30 dager</option>
              <option value="60">60 dager</option>
            </select>
          </Field>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
              Avbryt
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} className="w-full sm:w-auto">
              Lag lenke
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
