import { useEffect, useRef, useState } from 'react'
import {
  MEDIA_DESCRIPTION_MAX,
  MEDIA_TITLE_MAX,
  type MediaVisibility,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
} from '../lib/media'
import { searchMediaWorks } from '../server/media'
import { Button, Field } from './ui'
import { toastError } from './toast'

/**
 * Skjemaet for opplysningene på et medieelement (#32), delt av
 * opprettelsesdialogen på `/media` og redigeringen på `/media/$mediaId`.
 *
 * Delt fordi de to må være enige: valideringen (`sanitizeMediaInput`) er den
 * samme på serveren uansett vei inn, og to skjemaer ville før eller siden gitt
 * to ulike sett med felt for den samme raden.
 *
 * Komponenten kaller `searchMediaWorks` — en serverfunksjon, som er trygt å
 * importere fra en klientkomponent (vite-pluginen bytter den ut med et
 * RPC-kall). Modulene med *levende* eksporter (`media-files.ts`) importeres
 * aldri herfra.
 */

export type MediaFormValues = {
  title: string
  recordedOn: string
  description: string
  visibility: MediaVisibility
  projectId: string
  workId: string
  /** Tittelen på det valgte verket, slik at velgeren kan vise den uten et oppslag. */
  workTitle: string
}

export const EMPTY_MEDIA: MediaFormValues = {
  title: '',
  recordedOn: '',
  description: '',
  visibility: 'intern',
  projectId: '',
  workId: '',
  workTitle: '',
}

export type ProjectOption = { id: string; name: string; eventDate: string | null }

export function MediaForm({
  initial,
  visibilities,
  projectOptions,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  /** Filvelgeren vises kun ved opprettelse — en fil byttes aldri ut senere. */
  fileField,
}: {
  initial: MediaFormValues
  visibilities: MediaVisibility[]
  projectOptions: ProjectOption[]
  submitLabel: string
  busyLabel?: string
  onSubmit: (values: MediaFormValues) => Promise<void>
  onCancel: () => void
  fileField?: React.ReactNode
}) {
  const [values, setValues] = useState<MediaFormValues>(initial)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof MediaFormValues>(key: K, value: MediaFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (saving) return
        setSaving(true)
        try {
          await onSubmit(values)
        } catch (err) {
          toastError(err)
        } finally {
          setSaving(false)
        }
      }}
    >
      {fileField}

      <Field label="Tittel">
        <input
          className="field-input"
          value={values.title}
          maxLength={MEDIA_TITLE_MAX}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Julekonsert 2025 — Gaelforce"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dato" hint="Når opptaket ble gjort — ikke når det ble lagt inn.">
          <input
            className="field-input"
            type="date"
            value={values.recordedOn}
            onChange={(e) => set('recordedOn', e.target.value)}
          />
        </Field>

        <Field label="Tilgangsnivå" hint={VISIBILITY_HINTS[values.visibility]}>
          <select
            className="field-input"
            value={values.visibility}
            onChange={(e) => set('visibility', e.target.value as MediaVisibility)}
          >
            {visibilities.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Prosjekt" hint="Bare publiserte prosjekter kan kobles.">
        <select
          className="field-input"
          value={values.projectId}
          onChange={(e) => set('projectId', e.target.value)}
        >
          <option value="">Ingen kobling</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.eventDate ? ` · ${p.eventDate}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <WorkPicker
        workId={values.workId}
        workTitle={values.workTitle}
        onPick={(work) =>
          setValues((prev) => ({ ...prev, workId: work?.id ?? '', workTitle: work?.title ?? '' }))
        }
      />

      <Field label="Beskrivelse" hint="Hva er dette et opptak av, og hva bør man vite?">
        <textarea
          className="field-input min-h-28"
          value={values.description}
          maxLength={MEDIA_DESCRIPTION_MAX}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Avbryt
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? (busyLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </form>
  )
}

type WorkHit = { id: string; title: string; composer: string | null }

/**
 * Verkssøket. Et fritekstfelt som slår opp i arkivet, ikke en `<select>` med
 * hele katalogen: arkivet kan ha hundrevis av verk, og en nedtrekksliste med
 * dem alle er verken søkbar eller rask å laste.
 *
 * Søket er strupet med en liten pause, slik at hvert tastetrykk ikke blir et
 * kall. Resultatene inneholder kun `{id, title, composer}` — verkslista er ikke
 * hemmelig, men den skal heller ikke bli en full eksport av arkivet.
 */
function WorkPicker({
  workId,
  workTitle,
  onPick,
}: {
  workId: string
  workTitle: string
  onPick: (work: WorkHit | null) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WorkHit[]>([])
  const [open, setOpen] = useState(false)
  // Kun det SISTE svaret får lov til å sette treffene: uten vakten kan et
  // tregt søk på «g» lande etter «gaelforce» og overskrive riktig liste.
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const res = await searchMediaWorks({ data: { q } })
        if (seq.current === mine) setHits(res.works)
      } catch {
        // Et mislykket søk skal ikke velte skjemaet — feltet er valgfritt.
        if (seq.current === mine) setHits([])
      }
    }, 220)
    return () => clearTimeout(timer)
  }, [query])

  if (workId && !open) {
    return (
      <Field label="Verk">
        <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line bg-paper-sunken px-3 py-2">
          <span className="flex-1 text-sm text-ink">{workTitle || 'Valgt verk'}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Bytt
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
            Fjern
          </Button>
        </div>
      </Field>
    )
  }

  return (
    <Field label="Verk" hint="Valgfritt. Søk på tittel eller komponist.">
      <input
        className="field-input"
        type="search"
        value={query}
        placeholder="Søk i arkivet …"
        onChange={(e) => setQuery(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-[9px] border border-line">
          {hits.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                className="w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:bg-paper-sunken"
                onClick={() => {
                  onPick(work)
                  setOpen(false)
                  setQuery('')
                  setHits([])
                }}
              >
                <span className="text-ink">{work.title}</span>
                {work.composer && <span className="text-ink-faint"> · {work.composer}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {workId && (
        <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(false)}>
          Behold «{workTitle}»
        </Button>
      )}
    </Field>
  )
}
