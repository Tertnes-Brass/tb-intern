import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  MAX_PERCUSSION_ITEMS_PER_WORK,
  PERCUSSION_INSTRUMENTS,
  PERCUSSION_INSTRUMENT_MAX,
  PERCUSSION_ITEM_NOTE_MAX,
  percussionPartOptions,
  type PercussionNeed,
} from '../lib/work-percussion'
import type { WorkPercussionRow } from '../server/work-percussion'
import { addWorkPercussion, removeWorkPercussion, updateWorkPercussion } from '../server/work-percussion'
import { toast, toastError } from './toast'
import { Button, Field, Stamp } from './ui'

/**
 * Slagverksinstrumentene et verk krever (#34).
 *
 * Lista bor på verket og gjenbrukes hver gang stykket settes opp — det er hele
 * poenget: slagverkerne skal slippe å lese instrumentene ut av PDF-ene på nytt.
 * Registreringen er manuell nå; et framtidig forslag fra PDF/OCR skriver de
 * samme radene og trenger ingen endring her.
 */

type PartOption = { id: string; nameNo: string; section: string; sortOrder: number }

const DATALIST_ID = 'slagverksinstrumenter'

/** Forslagslista i skjemaet — fri tekst er fortsatt lov, dette er bare hjelp. */
function InstrumentSuggestions() {
  return (
    <datalist id={DATALIST_ID}>
      {PERCUSSION_INSTRUMENTS.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  )
}

/** Én instrumentlinje slik den leses: navn, stemme som stempel, notat under. */
function PercussionItem({ item }: { item: WorkPercussionRow }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[0.92rem] font-semibold text-ink">{item.instrument}</span>
        {item.partName && <Stamp tone="brass">{item.partName}</Stamp>}
      </span>
      {item.note && <span className="mt-0.5 block text-[0.82rem] leading-snug text-ink-soft">{item.note}</span>}
    </span>
  )
}

/**
 * Seksjonen på verksiden. Uten skriverett er den ren lesing — og forsvinner
 * helt når lista er tom, slik at et verk uten slagverk ikke får en tom boks.
 */
export function WorkPercussionSection({
  workId,
  items,
  allParts,
  canEdit,
}: {
  workId: string
  items: WorkPercussionRow[]
  allParts: PartOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const partOptions = percussionPartOptions(allParts)

  if (items.length === 0 && !canEdit) return null

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      await removeWorkPercussion({ data: { id, workId } })
      toast('Instrumentet er fjernet')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rise" style={{ animationDelay: '170ms' }}>
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="kicker">Slagverksinstrumenter</h2>
        <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
        {items.length > 0 && (
          <span className="shrink-0 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint">
            {items.length} {items.length === 1 ? 'instrument' : 'instrumenter'}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-soft">
          Ingen instrumenter registrert. Lista følger stykket, så den skrives én gang og gjelder neste gang
          det settes opp.
        </p>
      ) : (
        <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="px-4 py-3.5 sm:px-5">
                <PercussionItemForm
                  partOptions={partOptions}
                  initial={item}
                  submitLabel="Lagre"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (value) => {
                    await updateWorkPercussion({ data: { id: item.id, workId, ...value } })
                    toast('Instrumentet er oppdatert')
                    setEditingId(null)
                    await router.invalidate()
                  }}
                />
              </li>
            ) : (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <PercussionItem item={item} />
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => setEditingId(item.id)}
                      className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
                    >
                      Rediger
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => remove(item.id)}
                      className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    >
                      Fjern
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canEdit && items.length < MAX_PERCUSSION_ITEMS_PER_WORK && editingId === null && (
        <div className="mt-3 rounded-xl border border-dashed border-line-strong px-4 py-3.5">
          <PercussionItemForm
            partOptions={partOptions}
            initial={null}
            submitLabel="Legg til"
            onSubmit={async (value) => {
              await addWorkPercussion({ data: { workId, ...value } })
              toast('Instrumentet er lagt til')
              await router.invalidate()
            }}
          />
        </div>
      )}

      <InstrumentSuggestions />
    </section>
  )
}

function PercussionItemForm({
  partOptions,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  partOptions: PartOption[]
  initial: WorkPercussionRow | null
  submitLabel: string
  onSubmit: (value: { instrument: string; note: string | null; partId: string | null }) => Promise<void>
  onCancel?: () => void
}) {
  const [instrument, setInstrument] = useState(initial?.instrument ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [partId, setPartId] = useState(initial?.partId ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!instrument.trim()) {
      toast('Instrumentet må ha et navn', 'error')
      return
    }
    setSaving(true)
    try {
      await onSubmit({ instrument: instrument.trim(), note: note.trim() || null, partId: partId || null })
      if (!initial) {
        setInstrument('')
        setNote('')
        setPartId('')
      }
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Instrument" className="min-w-44 flex-1">
        <input
          className="field-input"
          list={DATALIST_ID}
          value={instrument}
          maxLength={PERCUSSION_INSTRUMENT_MAX}
          placeholder="Pauker"
          onChange={(e) => setInstrument(e.target.value)}
        />
      </Field>
      <Field label="Notat" className="min-w-48 flex-[2]" hint="«deles med perc 2», «må lånes»">
        <input
          className="field-input"
          value={note}
          maxLength={PERCUSSION_ITEM_NOTE_MAX}
          placeholder="må lånes"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Field label="Stemme" className="w-40">
        <select className="field-input" value={partId} onChange={(e) => setPartId(e.target.value)}>
          <option value="">Ikke satt</option>
          {partOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameNo}
            </option>
          ))}
        </select>
      </Field>
      <div className="mb-px flex gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Avbryt
          </Button>
        )}
        <Button variant={initial ? 'primary' : 'secondary'} loading={saving} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * Det samlede behovet for ett prosjekt: hvert instrument én gang, med verkene
 * det trengs i. Ren lesing — instrumentlistene redigeres på verket, ikke her,
 * fordi de gjelder stykket og ikke konserten.
 */
export function PercussionNeedsList({ needs }: { needs: PercussionNeed[] }) {
  if (needs.length === 0) return null
  return (
    <ul className="space-y-2">
      {needs.map((need) => (
        <li key={need.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[0.92rem] font-semibold text-ink">{need.instrument}</span>
          <span className="min-w-0 text-[0.82rem] leading-snug text-ink-soft">
            {need.uses
              .map((use) => (use.note ? `${use.workTitle} (${use.note})` : use.workTitle))
              .join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  )
}
