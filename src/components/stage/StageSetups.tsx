import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { formatDate, formatDateTime } from '../../lib/format'
import { STAGE_TITLE_MAX } from '../../lib/stage-scene'
import { STAGE_SIZE_LIMITS, STAGE_TEMPLATES, type StageTemplateId } from '../../lib/stage-templates'
import { createStageSetup, listStageSetupSources } from '../../server/stage-setups'
import type { StageSetupSummary } from '../../server/stage-setup-store'
import { toastError } from '../toast'
import { Button, Field, Modal } from '../ui'

/**
 * Sceneoppsettene på prosjektsiden. Medlemmene ser dem (og kan åpne dem for å
 * se hvor de sitter); `stage.manage` kan lage nye. Seksjonen er skjult når det
 * ikke finnes noe å vise og den som ser siden ikke kan lage noe.
 */
export function StageSetupsSection({
  projectId,
  setups,
  canEdit,
}: {
  projectId: string
  setups: StageSetupSummary[]
  canEdit: boolean
}) {
  const [creating, setCreating] = useState(false)
  if (!canEdit && setups.length === 0) return null

  return (
    <section className="rise" style={{ animationDelay: '145ms' }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="kicker">Sceneoppsett</h2>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            + Nytt oppsett
          </Button>
        )}
      </div>
      {setups.length === 0 ? (
        <div className="sheet px-5 py-4">
          <p className="text-[0.9rem] leading-relaxed text-ink-soft">
            Tegn hvordan korpset og slagverket skal stå — og send det til arrangøren som PDF, med utstyrslisten
            ferdig talt opp.
          </p>
        </div>
      ) : (
        <ul className="sheet overflow-hidden">
          {setups.map((s) => (
            <li key={s.id} className="hairline-row">
              <Link
                to="/noter/oppsett/$setupId"
                params={{ setupId: s.id }}
                preload={false}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-paper-sunken/70"
              >
                <span className="min-w-0 flex-1">
                  <span className="display-title block truncate text-[1.02rem] font-semibold text-ink">{s.title}</span>
                  <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-faint">
                    Endret {formatDateTime(s.updatedAt)}
                    {s.updatedByName ? ` · ${s.updatedByName}` : ''}
                  </span>
                </span>
                <span className="link-brass shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.14em]">
                  {canEdit ? 'Rediger' : 'Åpne'} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && <CreateStageSetupModal projectId={projectId} open={creating} onClose={() => setCreating(false)} />}
    </section>
  )
}

type Source = 'copy' | StageTemplateId

function CreateStageSetupModal({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [source, setSource] = useState<Source>('brass-band')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [width, setWidth] = useState('12')
  const [depth, setDepth] = useState('8')
  const [copies, setCopies] = useState<Awaited<ReturnType<typeof listStageSetupSources>> | null>(null)
  const [copyId, setCopyId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSource('brass-band')
    setTitle(STAGE_TEMPLATES[0].title)
    setTitleTouched(false)
    setWidth(String(STAGE_TEMPLATES[0].size.width))
    setDepth(String(STAGE_TEMPLATES[0].size.depth))
    setCopyId('')
  }, [open])

  useEffect(() => {
    if (!open || source !== 'copy' || copies) return
    listStageSetupSources()
      .then((rows) => {
        setCopies(rows)
        if (rows[0]) setCopyId(rows[0].id)
      })
      .catch(toastError)
  }, [open, source, copies])

  const choose = (next: Source) => {
    setSource(next)
    const template = STAGE_TEMPLATES.find((t) => t.id === next)
    if (template) {
      setWidth(String(template.size.width))
      setDepth(String(template.size.depth))
    }
    if (!titleTouched) {
      const copy = copies?.find((c) => c.id === copyId)
      setTitle(template?.title ?? copy?.title ?? '')
    }
  }

  const meters = (value: string) => Number(value.replace(',', '.'))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { id } = await createStageSetup({
        data: {
          projectId,
          title,
          source:
            source === 'copy'
              ? { type: 'copy', setupId: copyId }
              : { type: 'template', template: source, width: meters(width), depth: meters(depth) },
        },
      })
      onClose()
      await router.navigate({ to: '/noter/oppsett/$setupId', params: { setupId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const sizeValid = [width, depth].every((v) => {
    const n = meters(v)
    return Number.isFinite(n) && n >= STAGE_SIZE_LIMITS.min && n <= STAGE_SIZE_LIMITS.max
  })
  const canSubmit = title.trim() && (source === 'copy' ? !!copyId : sizeValid)

  const option = (value: Source, label: string, hint: string) => (
    <label
      key={value}
      className={`flex cursor-pointer gap-3 rounded-[10px] border px-3.5 py-3 transition-colors ${
        source === value ? 'border-brass bg-[var(--brass-soft)]' : 'border-line hover:border-line-strong'
      }`}
    >
      <input
        type="radio"
        name="stage-source"
        className="mt-1 accent-[var(--brass)]"
        checked={source === value}
        onChange={() => choose(value)}
      />
      <span>
        <span className="block text-[0.9rem] font-medium text-ink">{label}</span>
        <span className="block text-[0.78rem] leading-snug text-ink-soft">{hint}</span>
      </span>
    </label>
  )

  return (
    <Modal open={open} onClose={onClose} title="Nytt sceneoppsett" kicker="Prosjekt">
      <form onSubmit={submit} className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[0.8rem] font-medium text-ink-soft">Start fra</legend>
          {STAGE_TEMPLATES.map((t) => option(t.id, t.label, t.hint))}
          {option('copy', 'Et tidligere oppsett', 'Kopier tegning og merknader fra et annet prosjekt')}
        </fieldset>

        {source === 'copy' ? (
          <Field label="Oppsett">
            {copies === null ? (
              <p className="text-sm text-ink-faint">Henter …</p>
            ) : copies.length === 0 ? (
              <p className="text-sm text-ink-faint">Det finnes ingen andre oppsett ennå.</p>
            ) : (
              <select
                className="field-input"
                value={copyId}
                onChange={(e) => {
                  setCopyId(e.target.value)
                  const copy = copies.find((c) => c.id === e.target.value)
                  if (copy && !titleTouched) setTitle(copy.title)
                }}
              >
                {copies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.projectName}
                    {c.eventDate ? ` (${formatDate(c.eventDate)})` : ''} — {c.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Scenebredde (m)">
              <input className="field-input" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
            </Field>
            <Field label="Scenedybde (m)">
              <input className="field-input" inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Navn">
          <input
            className="field-input"
            value={title}
            maxLength={STAGE_TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
            placeholder="Korpsoppsett, Slagverk, NM-scenen …"
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit} className="w-full sm:w-auto">
            Lag oppsett
          </Button>
        </div>
      </form>
    </Modal>
  )
}
