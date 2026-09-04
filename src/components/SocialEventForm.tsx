import { useState } from 'react'
import {
  SOCIAL_CAPACITY_MAX,
  SOCIAL_DESCRIPTION_MAX,
  SOCIAL_LOCATION_MAX,
  SOCIAL_TITLE_MAX,
  type SocialEventDraft,
} from '../lib/social'
import { Button, Field } from './ui'

/**
 * Skjemaet for et sosialt arrangement (#31), delt av `/kalender/sosialt/ny` og
 * redigeringsruta — samme felt, samme rekkefølge og samme hjelpetekster begge
 * steder.
 *
 * **Dato og klokkeslett sendes som veggklokke**, ikke som et tidspunkt
 * komponenten har regnet om selv. `new Date('2026-12-12T19:00')` ville blitt
 * tolket i NETTLESERENS tidssone, og et medlem som melder inn julebordet fra en
 * ferie i Thailand hadde lagt det inn seks timer feil. Serveren gjør om til UTC
 * med `wallClockToUtc` (`src/lib/wallclock.ts`) — samme regning som
 * iCal-parseren bruker på feeden.
 *
 * Valideringen bor ikke her: `sanitizeSocialInput` på serveren er sannheten, og
 * feilmeldingene derfra vises som de er. `required`/`min`/`max` i feltene tar
 * bare det enkle tilfellet i nettleseren først.
 */

/**
 * Skjemaet sender ALLTID strenger — det er det `<input>` gir fra seg, og det
 * er det serverfunksjonens validator tar imot. `SocialEventDraft` tillater i
 * tillegg et tall i `capacity`, siden `sanitizeSocialInput` skal tåle begge.
 */
export type SocialFormValues = Omit<SocialEventDraft, 'capacity'> & { capacity: string }

export function SocialEventForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<SocialFormValues>
  submitLabel: string
  onSubmit: (values: SocialFormValues) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [startTime, setStartTime] = useState(initial?.startTime ?? '19:00')
  const [deadlineDate, setDeadlineDate] = useState(initial?.deadlineDate ?? '')
  const [capacity, setCapacity] = useState(initial?.capacity == null ? '' : String(initial.capacity))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit({ title, location, startDate, startTime, deadlineDate, capacity, description })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="sheet space-y-5 px-5 py-6 sm:px-7">
      <Field label="Hva skjer?">
        <input
          className="field-input"
          value={title}
          maxLength={SOCIAL_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pub etter øving"
          required
          autoFocus
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dato">
          <input
            type="date"
            className="field-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Klokkeslett">
          <input
            type="time"
            className="field-input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label="Sted" hint="Valgfritt — men det er som regel det første folk lurer på.">
        <input
          className="field-input"
          value={location ?? ''}
          maxLength={SOCIAL_LOCATION_MAX}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Henrik Ø, Bryggen"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Påmeldingsfrist" hint="Valgfritt. Fristen gjelder ut hele dagen.">
          <input
            type="date"
            className="field-input"
            value={deadlineDate ?? ''}
            max={startDate || undefined}
            onChange={(e) => setDeadlineDate(e.target.value)}
          />
        </Field>
        <Field label="Maks antall" hint="Valgfritt. Fullt gir venteliste, ikke stengt dør.">
          <input
            type="number"
            inputMode="numeric"
            className="field-input"
            value={capacity ?? ''}
            min={1}
            max={SOCIAL_CAPACITY_MAX}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Ingen grense"
          />
        </Field>
      </div>

      <Field label="Praktisk info" hint="Pris, mat, transport, aldersgrense — det folk må vite før de svarer.">
        <textarea
          className="field-input min-h-[7rem] resize-y"
          value={description ?? ''}
          maxLength={SOCIAL_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Vi tar et bord fra 21. Alle betaler for seg."
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Avbryt
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!title.trim() || !startDate || !startTime}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
