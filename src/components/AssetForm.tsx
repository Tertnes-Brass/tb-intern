import { useState } from 'react'
import {
  ASSET_CATEGORIES,
  ASSET_NAME_MAX,
  ASSET_NOTES_MAX,
  ASSET_OWNER_MAX,
  ASSET_SHORT_MAX,
  type AssetInput,
  OWNER_KINDS,
  OWNER_KIND_LABELS,
  type OwnerKind,
} from '../lib/utstyr'
import { Button, Field } from './ui'
import { toastError } from './toast'

/**
 * Skjemaet for én gjenstand — delt av «Nytt utstyr» på oversikten og
 * redigeringen på detaljsiden, slik at de to aldri kan tilby ulike felt.
 *
 * Komponenten validerer ikke selv: `sanitizeAssetInput` på serveren er den ene
 * sannheten om hva som er gyldig (den kalles på både opprettelse og
 * redigering), og feilmeldingen derfra er allerede norsk og kan vises rått.
 * `required` på navnefeltet er en høflighet fra nettleseren, ikke en regel.
 */

/**
 * Skjemaverdiene er RENE strenger, aldri `null`: et kontrollert React-felt kan
 * ikke ha `null` som verdi uten å bli ukontrollert. Oversettelsen tom streng →
 * `null` gjøres av `sanitizeAssetInput` på serveren, ett sted.
 */
export type AssetFormValues = { [K in keyof Required<AssetInput>]: string }

export const EMPTY_ASSET: AssetFormValues = {
  name: '',
  category: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  ownerKind: 'band',
  ownerUserId: '',
  ownerName: '',
  loanedFrom: '',
  loanFrom: '',
  loanUntil: '',
  notes: '',
}

export function AssetForm({
  initial = EMPTY_ASSET,
  memberOptions,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: AssetFormValues
  memberOptions: Array<{ id: string; name: string }>
  submitLabel: string
  onSubmit: (values: AssetFormValues) => Promise<void>
  onCancel?: () => void
}) {
  const [values, setValues] = useState<AssetFormValues>(initial)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const ownerKind = values.ownerKind as OwnerKind

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
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
      <Field label="Navn" hint="Det du ville sagt i telefonen: «den store skarptromma»">
        <input
          className="field-input"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          maxLength={ASSET_NAME_MAX}
          required
          autoFocus
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kategori" hint="Velg fra lista, eller skriv din egen">
          <input
            className="field-input"
            list="utstyr-kategorier"
            value={values.category}
            onChange={(e) => set('category', e.target.value)}
            maxLength={60}
          />
          <datalist id="utstyr-kategorier">
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Produsent">
          <input
            className="field-input"
            value={values.manufacturer}
            onChange={(e) => set('manufacturer', e.target.value)}
            maxLength={ASSET_SHORT_MAX}
          />
        </Field>
        <Field label="Modell" hint="Om den finnes">
          <input
            className="field-input"
            value={values.model}
            onChange={(e) => set('model', e.target.value)}
            maxLength={ASSET_SHORT_MAX}
          />
        </Field>
        <Field label="Serienummer" hint="Om det finnes">
          <input
            className="field-input font-mono"
            value={values.serialNumber}
            onChange={(e) => set('serialNumber', e.target.value)}
            maxLength={ASSET_SHORT_MAX}
          />
        </Field>
      </div>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="sr-only">Eier</legend>
        <Field label="Eier">
          <select
            className="field-input"
            value={values.ownerKind}
            onChange={(e) => set('ownerKind', e.target.value)}
          >
            {OWNER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {OWNER_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>

        {ownerKind === 'member' && (
          <Field label="Hvilket medlem?" hint="Navnet hentes fra medlemslista, så det alltid er oppdatert">
            <select
              className="field-input"
              value={values.ownerUserId}
              onChange={(e) => set('ownerUserId', e.target.value)}
            >
              <option value="">Velg medlem …</option>
              {memberOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {ownerKind === 'external' && (
          <Field label="Navn på eier" hint="En privatperson eller et korps utenfor Tertnes Brass">
            <input
              className="field-input"
              value={values.ownerName}
              onChange={(e) => set('ownerName', e.target.value)}
              maxLength={ASSET_OWNER_MAX}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-1 text-[0.8rem] font-medium text-ink-soft">Lånt inn</legend>
        <p className="-mt-1 text-xs text-ink-faint">
          Fyll ut bare hvis gjenstanden er lånt av noen andre. Står feltet tomt, er den ikke lånt.
        </p>
        <Field label="Lånt av">
          <input
            className="field-input"
            value={values.loanedFrom}
            onChange={(e) => set('loanedFrom', e.target.value)}
            maxLength={ASSET_OWNER_MAX}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fra dato">
            <input
              className="field-input"
              type="date"
              value={values.loanFrom}
              onChange={(e) => set('loanFrom', e.target.value)}
            />
          </Field>
          <Field label="Til dato">
            <input
              className="field-input"
              type="date"
              value={values.loanUntil}
              onChange={(e) => set('loanUntil', e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notat" className="border-t border-line pt-5">
        <textarea
          className="field-input min-h-28"
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          maxLength={ASSET_NOTES_MAX}
          placeholder="Skader, tilbehør, hvor den står, hva som må gjøres …"
        />
      </Field>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            Avbryt
          </Button>
        )}
        <Button type="submit" variant="primary" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
